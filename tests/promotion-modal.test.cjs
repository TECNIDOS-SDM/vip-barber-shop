const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const modal = fs.readFileSync('components/booking/promotion-modal.tsx', 'utf8');
const page = fs.readFileSync('app/page.tsx', 'utf8');
const promotionDaySource = fs.readFileSync('lib/promotion-day.ts', 'utf8');
const promotionDayModule = { exports: {} };
const compiledPromotionDay = ts.transpileModule(promotionDaySource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

new Function('module', 'exports', compiledPromotionDay)(
  promotionDayModule,
  promotionDayModule.exports,
);

const { shouldShowWednesdayPromotion } = promotionDayModule.exports;

test('promotion is mounted as an overlay and never inserted into the booking layout', () => {
  assert.match(page, /<PromotionModal \/>/);
  assert.match(page, /<main[^>]*>\s*<PromotionModal \/>/);
  assert.doesNotMatch(page, /promocion-miercoles-2x1\.png/);
  assert.match(modal, /fixed inset-0 z-\[100\]/);
  assert.match(modal, /src="\/promocion-miercoles-2x1\.png"/);
});

test('promotion opens on every full mount and closes only in local component state', () => {
  assert.match(modal, /useState\(\(\) => shouldShowWednesdayPromotion\(\)\)/);
  assert.match(modal, /onClick=\{\(\) => setIsOpen\(false\)\}/);
  assert.match(modal, /if \(!isOpen\) return null/);
  assert.doesNotMatch(modal, /localStorage|sessionStorage|document\.cookie|supabase/i);
});

test('promotion is visible only on Wednesdays in Colombia', () => {
  assert.equal(shouldShowWednesdayPromotion(new Date('2026-09-30T12:00:00Z')), true);
  assert.equal(shouldShowWednesdayPromotion(new Date('2026-09-29T12:00:00Z')), false);
  assert.equal(shouldShowWednesdayPromotion(new Date('2026-10-01T12:00:00Z')), false);
});

test('promotion uses Colombia calendar day around UTC midnight', () => {
  assert.equal(shouldShowWednesdayPromotion(new Date('2026-09-30T03:30:00Z')), false);
  assert.equal(shouldShowWednesdayPromotion(new Date('2026-10-01T03:30:00Z')), true);
});

test('modal blocks the page, locks scrolling and exposes an accessible close control', () => {
  assert.match(modal, /document\.body\.style\.overflow = "hidden"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /aria-label="Cerrar promoción"/);
  assert.match(modal, /h-11 w-11/);
  assert.match(modal, /max-h-\[calc\(100dvh-2rem\)\]/);
  assert.match(modal, /object-contain/);
});
