const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const modal = fs.readFileSync('components/booking/promotion-modal.tsx', 'utf8');
const page = fs.readFileSync('app/page.tsx', 'utf8');

test('promotion is mounted as an overlay and never inserted into the booking layout', () => {
  assert.match(page, /<PromotionModal \/>/);
  assert.match(page, /<main[^>]*>\s*<PromotionModal \/>/);
  assert.doesNotMatch(page, /promocion-miercoles-2x1\.png/);
  assert.match(modal, /fixed inset-0 z-\[100\]/);
  assert.match(modal, /src="\/promocion-miercoles-2x1\.png"/);
});

test('promotion opens on every full mount and closes only in local component state', () => {
  assert.match(modal, /useState\(true\)/);
  assert.match(modal, /onClick=\{\(\) => setIsOpen\(false\)\}/);
  assert.match(modal, /if \(!isOpen\) return null/);
  assert.doesNotMatch(modal, /localStorage|sessionStorage|document\.cookie|supabase/i);
});

test('modal blocks the page, locks scrolling and exposes an accessible close control', () => {
  assert.match(modal, /document\.body\.style\.overflow = "hidden"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /aria-label="Cerrar promoción"/);
  assert.match(modal, /h-11 w-11/);
  assert.match(modal, /max-h-\[calc\(100dvh-2rem\)\]/);
  assert.match(modal, /object-contain/);
});
