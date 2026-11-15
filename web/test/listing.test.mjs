import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findUrl, isImageFile } from '../src/lib/listing.ts';

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

test('isImageFile takes photos and screenshots, including untyped iPhone HEIC', () => {
  assert.equal(isImageFile({ type: 'image/jpeg', name: 'IMG_0001.JPG' }), true);
  assert.equal(isImageFile({ type: 'image/png', name: 'Screenshot.png' }), true);
  assert.equal(isImageFile({ type: 'image/heic', name: 'IMG_0002.HEIC' }), true);
  assert.equal(isImageFile({ type: '', name: 'IMG_0003.HEIC' }), true);
  assert.equal(isImageFile({ type: '', name: 'notes.txt' }), false);
  assert.equal(isImageFile({ type: 'application/pdf', name: 'a.pdf' }), false);
  assert.equal(isImageFile({ type: '' }), false);
});
