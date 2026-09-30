const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'app/page.tsx'), 'utf8');
const booking = fs.readFileSync(
  path.join(root, 'components/booking/booking-shell.tsx'),
  'utf8'
);

test('public page renders the supplied promotion between header and booking flow', () => {
  const headerIndex = page.indexOf('title="VIP BARBER TOP"');
  const promotionIndex = page.indexOf('src="/promocion-miercoles-2x1.png"');
  const bookingIndex = page.indexOf('<BookingShell');

  assert.ok(headerIndex >= 0);
  assert.ok(promotionIndex > headerIndex);
  assert.ok(bookingIndex > promotionIndex);
  assert.match(page, /width=\{1170\}/);
  assert.match(page, /height=\{1169\}/);
  assert.match(page, /object-contain/);
  assert.match(page, /h-48 overflow-hidden rounded-\[1\.5rem\] sm:hidden/);
  assert.match(page, /hidden sm:block lg:hidden/);
  assert.match(page, /aspect-\[5\.4\/1\]/);
  assert.match(page, /@vip_barbertop/);
});

test('location panel follows social links and embeds the exact coordinates', () => {
  const socialIndex = booking.indexOf('REDES SOCIALES');
  const locationIndex = booking.indexOf('Ubicación');
  const mapIndex = booking.indexOf('3.4437761,-76.4901789');

  assert.ok(socialIndex >= 0);
  assert.ok(locationIndex > socialIndex);
  assert.ok(mapIndex > locationIndex);
  assert.match(booking, /output=embed/);
  assert.match(booking, /loading="lazy"/);
  assert.match(booking, /allowFullScreen/);
  assert.match(booking, /lg:grid-cols-\[0\.75fr_1\.25fr\]/);
  assert.match(booking, /lg:h-32/);
  assert.doesNotMatch(booking, /Cra\. 23 #70 04/);
});

test('visual additions do not introduce booking, Supabase or WhatsApp mutations', () => {
  const combined = `${page}\n${booking}`;
  assert.doesNotMatch(page, /supabase|\/api\/reserve|RESERVATION_WHATSAPP_NUMBER/);
  assert.equal((booking.match(/fetch\("\/api\/reserve"/g) ?? []).length, 1);
  assert.equal((booking.match(/const RESERVATION_WHATSAPP_NUMBER/g) ?? []).length, 1);
  assert.match(combined, /AGENDA TU CITA/);
});
