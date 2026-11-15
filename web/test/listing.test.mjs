import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findUrl } from '../src/lib/listing.ts';

test('findUrl pulls the link out of share-sheet text', () => {
  assert.equal(findUrl('Check out this listing! https://www.facebook.com/marketplace/item/123/ via Marketplace'),
    'https://www.facebook.com/marketplace/item/123/');
  assert.equal(findUrl('https://ebay.us/m/abc123.'), 'https://ebay.us/m/abc123');
  assert.equal(findUrl('(https://offerup.com/item/detail/x)'), 'https://offerup.com/item/detail/x');
});

test('findUrl rejects non-links and other schemes', () => {
  for (const s of ['', '   ', 'iphone 13', 'javascript:alert(1)', 'ftp://x/y', 'www.ebay.com/itm/1']) {
    assert.equal(findUrl(s), null, s);
  }
});

test('findUrl keeps unicode paths valid', () => {
  assert.equal(findUrl('https://www.etsy.com/listing/1/café-lamp'), 'https://www.etsy.com/listing/1/caf%C3%A9-lamp');
});
