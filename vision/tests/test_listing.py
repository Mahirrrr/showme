"""POST /api/listing/parse: listing link / text / screenshot -> item name."""
import asyncio

import pytest
from fastapi.testclient import TestClient

from vision.config import Settings
from vision.listing import (NOT_FOR_SALE, PREVIEW_UA, ListingRequest, Unreadable, clean_title, fetch_preview, parse_listing,
                            parse_meta, site_name, title_from_url)
from vision.main import create_app

FB = 'https://www.facebook.com/marketplace/item/27738242045771616/'
OG = ('<html><head><title>x</title><meta property="og:title" content="{t}">'
      '<meta property="og:description" content="Works great, comes with dock">'
      '<meta property="og:image" content="https://img.example/p.jpg"></head></html>')


class FakeNamer:
    def __init__(self, result=None, fail=False):
        self.result, self.fail, self.calls = result, fail, []

    async def name(self, **kw):
        self.calls.append(kw)
        if self.fail:
            raise RuntimeError('gemini down')
        return self.result


def page(title, url=FB):
    async def fetch(u):
        return {**parse_meta(OG.format(t=title)), 'final_url': url}
    return fetch


async def unreadable(u):
    raise Unreadable('blocked')


def run(body, namer=None, fetch=unreadable):
    return asyncio.run(parse_listing(ListingRequest(**body), namer, fetch=fetch))


# --- happy paths -------------------------------------------------------------

@pytest.mark.parametrize('title, want', [
    ('Nintendo switch 2 for Sale in Wichita, KS - OfferUp', 'Nintendo switch 2'),
    ('Nintendo Switch 2 Zelda Edition Console *PRESALE* | eBay', 'Nintendo Switch 2 Zelda Edition Console *PRESALE*'),
    ('iPhone 13 128GB - Facebook Marketplace', 'iPhone 13 128GB'),
    ('Nike Dunk Low SE Chocolate Croc Sz 9.5', 'Nike Dunk Low SE Chocolate Croc Sz 9.5'),
])
def test_clean_title_strips_site_noise(title, want):
    assert clean_title(title) == want


def test_link_uses_preview_tags_without_gemini():
    out = run({'url': FB}, fetch=page('PS5 Slim Disc - Facebook Marketplace'))
    assert out['item_name'] == 'PS5 Slim Disc'
    assert out['site'] == 'Facebook Marketplace'
    assert out['source'] == 'link'
    assert out['image_url'] == 'https://img.example/p.jpg'


def test_link_lets_gemini_shorten_title_and_category():
    namer = FakeNamer({'item_name': 'PlayStation 5 Slim', 'category': 'console'})
    out = run({'url': FB}, namer, fetch=page('PS5 slim w/ 2 controllers MUST GO'))
    assert (out['item_name'], out['category']) == ('PlayStation 5 Slim', 'console')
    assert 'PS5 slim w/ 2 controllers MUST GO' in namer.calls[0]['text']


def test_screenshot_goes_to_gemini():
    namer = FakeNamer({'item_name': 'iPhone 13 Pro 256GB', 'category': 'phone'})
    out = run({'image': 'data:image/png;base64,iVBORw0KGgo='}, namer)
    assert out['item_name'] == 'iPhone 13 Pro 256GB' and out['source'] == 'screenshot'


def test_pasted_text_falls_back_to_first_line_without_gemini():
    out = run({'text': 'MacBook Air M2 13in - OfferUp\n$650, barely used'})
    assert out['item_name'] == 'MacBook Air M2 13in' and out['source'] == 'text'


# --- failure paths -------------------------------------------------------------

def test_blocked_link_falls_back_to_url_words():
    url = 'https://dallas.craigslist.org/dal/vgm/d/dallas-nintendo-switch-oled/7941716035.html'
    out = run({'url': url})
    assert out['item_name'] == 'dallas nintendo switch oled'
    assert out['site'] == 'Craigslist' and out['source'] == 'link_url'


def test_known_blocked_site_skips_fetch():
    async def boom(u):
        raise AssertionError('should not fetch')
    out = run({'url': 'https://www.depop.com/products/jane-vintage-levis-501-jeans/'}, fetch=boom)
    assert out['item_name'] == 'jane vintage levis 501 jeans' and out['site'] == 'Depop'


def test_slow_fetch_is_cut_off(monkeypatch):
    monkeypatch.setattr('vision.listing.FETCH_SECONDS', 0.05)

    async def slow(u):
        await asyncio.sleep(5)
    out = run({'url': FB}, fetch=slow)
    assert out['reason'] == 'unreadable_link'


def test_blocked_link_without_words_asks_for_screenshot():
    out = run({'url': FB})
    assert out['item_name'] is None and out['reason'] == 'unreadable_link'
    assert out['site'] == 'Facebook Marketplace'


def test_login_wall_title_is_not_a_name():
    assert parse_meta('<title>Facebook</title>')['title'] == ''
    assert parse_meta('<title>Log in or sign up to view</title>')['title'] == ''


def test_gemini_failure_still_returns_cleaned_title():
    out = run({'url': FB}, FakeNamer(fail=True), fetch=page('Xbox Series X - Facebook Marketplace'))
    assert out['item_name'] == 'Xbox Series X'


def test_unreadable_screenshot():
    out = run({'image': 'data:image/png;base64,iVBORw0KGgo='}, FakeNamer(None))
    assert out['item_name'] is None and out['reason'] == 'unreadable_image'


# --- edges -------------------------------------------------------------------

@pytest.mark.parametrize('url, want', [
    ('https://poshmark.com/listing/Nike-Dunk-Low-SE-Chocolate-Croc-Sz-95-6acd5c235551aa59aa91a436', 'Nike Dunk Low SE Chocolate Croc Sz 95'),
    ('https://www.etsy.com/listing/123456789/vintage-brass-desk-lamp', 'vintage brass desk lamp'),
    ('https://www.ebay.com/itm/206546523356', ''),
    ('https://www.facebook.com/marketplace/item/27738242045771616/', ''),
])
def test_title_from_url(url, want):
    assert title_from_url(url) == want


@pytest.mark.parametrize('url, want', [
    ('https://m.facebook.com/marketplace/item/1', 'Facebook Marketplace'),
    ('https://www.ebay.com/itm/1', 'eBay'),
    ('https://dallas.craigslist.org/x', 'Craigslist'),
    ('https://shop.unknown-store.io/p/1', 'shop.unknown-store.io'),
])
def test_site_name(url, want):
    assert site_name(url) == want


@pytest.mark.parametrize('body', [
    {}, {'url': FB, 'text': 'x'}, {'url': 'ftp://x/y'}, {'url': 'javascript:alert(1)'},
    {'image': 'https://x/y.png'}, {'text': 'x' * 4001},
])
def test_request_validation(body):
    with pytest.raises(ValueError):
        ListingRequest(**body)


def test_unicode_and_entities_in_tags():
    meta = parse_meta('<meta property="og:title" content="Caf&eacute; racer helmet 🏍️ | eBay">')
    assert clean_title(meta['title']) == 'Café racer helmet 🏍️'


# --- fetch: redirects, private hosts, user agent ---------------------------------

async def allow(url):
    if 'internal' in url:
        raise Unreadable('host is not public')


def test_fetch_sends_preview_ua_and_follows_redirect():
    seen = []

    def get(url, ua):
        seen.append((url, ua))
        if url.endswith('/share/abc'):
            return 302, '/marketplace/item/9/', ''
        return 200, None, OG.format(t='Steam Deck OLED')

    out = asyncio.run(fetch_preview('https://www.facebook.com/share/abc', get, check_host=allow))
    assert out['title'] == 'Steam Deck OLED'
    assert out['final_url'] == 'https://www.facebook.com/marketplace/item/9/'
    assert seen[0][1] == PREVIEW_UA


def test_fetch_tries_second_user_agent():
    out = asyncio.run(fetch_preview(FB, lambda url, ua: (403, None, '') if ua == PREVIEW_UA else (200, None, OG.format(t='Kindle')),
                                    check_host=allow))
    assert out['title'] == 'Kindle'


def test_fetch_refuses_redirect_to_private_host():
    with pytest.raises(Unreadable):
        asyncio.run(fetch_preview('https://www.ebay.com/itm/1', lambda url, ua: (302, 'http://internal.local/admin', ''),
                                  check_host=allow))


def test_fetch_stops_redirect_loops():
    with pytest.raises(Unreadable):
        asyncio.run(fetch_preview(FB, lambda url, ua: (302, url, ''), check_host=allow))


def test_fetch_login_wall_is_unreadable():
    with pytest.raises(Unreadable):
        asyncio.run(fetch_preview(FB, lambda url, ua: (200, None, '<title>Facebook</title>'), check_host=allow))


def test_real_host_check_blocks_localhost():
    with pytest.raises(Unreadable):
        asyncio.run(fetch_preview('http://127.0.0.1:8000/api/health'))


# --- route -------------------------------------------------------------------

def test_route_end_to_end_in_mock_mode():
    app = create_app(Settings(mock=True, agent_key='k'), fetch=page('Nintendo Switch OLED - Facebook Marketplace'))
    with TestClient(app) as c:
        r = c.post('/api/listing/parse', json={'url': FB})
        assert r.status_code == 200
        assert r.json()['item_name'] == 'Nintendo Switch OLED'
        assert c.post('/api/listing/parse', json={'url': 'file:///etc/passwd'}).status_code == 422


# --- readable pages that sell nothing ------------------------------------------

def test_lost_pet_post_is_not_for_sale_not_the_raw_title():
    """A Spanish lost-dog post must not become the item name (it did before)."""
    out = run({'url': FB}, FakeNamer(NOT_FOR_SALE),
              fetch=page('Perro perdido si alguien lo conoce escríbame por favor'))
    assert out['item_name'] is None and out['reason'] == 'not_for_sale'
    assert out['site'] == 'Facebook Marketplace'


@pytest.mark.parametrize('body', [{'image': 'data:image/png;base64,iVBORw0KGgo='}, {'text': 'Busco PS5 barata'}])
def test_not_for_sale_screenshot_and_text(body):
    out = run(body, FakeNamer(NOT_FOR_SALE))
    assert out['item_name'] is None and out['reason'] == 'not_for_sale'


def test_gemini_down_still_falls_back_to_title():
    out = run({'url': FB}, FakeNamer(fail=True), fetch=page('PlayStation 5 Slim'))
    assert out['item_name'] == 'PlayStation 5 Slim'


# --- photos of the item, not only listing screenshots ------------------------

class _FakeModels:
    def __init__(self):
        self.contents = None

    async def generate_content(self, *, model, contents, config):
        self.contents = contents

        class R:
            text = '{"kind": "item", "item_name": "Nintendo Switch OLED", "category": "console"}'
        return R()


class _FakeClient:
    def __init__(self):
        self.aio = type('Aio', (), {})()
        self.aio.models = _FakeModels()


def test_image_prompt_accepts_a_photo_of_the_item():
    from vision.listing import GeminiNamer
    client = _FakeClient()
    out = asyncio.run(GeminiNamer(client, 'm').name(image='data:image/jpeg;base64,/9j/4AAQ'))
    prompt = client.aio.models.contents[1]
    assert 'photo of the item' in prompt and 'screenshot' in prompt
    assert out == {'item_name': 'Nintendo Switch OLED', 'category': 'console'}


def test_heic_photo_is_accepted():
    from vision.listing import GeminiNamer
    client = _FakeClient()
    asyncio.run(GeminiNamer(client, 'm').name(image='data:image/heic;base64,AAAA'))
    assert client.aio.models.contents[0].inline_data.mime_type == 'image/heic'


def test_photo_gets_longer_than_a_title(monkeypatch):
    monkeypatch.setattr('vision.listing.NAME_SECONDS', 0.05)

    class Slow:
        async def name(self, **kw):
            await asyncio.sleep(0.2)
            return {'item_name': 'Canon EOS R6', 'category': 'other'}
    out = run({'image': 'data:image/jpeg;base64,/9j/4AAQ'}, Slow())
    assert out['item_name'] == 'Canon EOS R6'
