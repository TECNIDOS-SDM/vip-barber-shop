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

test('public page moves directly from header to booking flow without promotion', () => {
  const headerIndex = page.indexOf('title="VIP BARBER TOP"');
  const bookingIndex = page.indexOf('<BookingShell');

  assert.ok(headerIndex >= 0);
  assert.ok(bookingIndex > headerIndex);
  assert.doesNotMatch(page, /promocion-miercoles-2x1\.png/);
  assert.doesNotMatch(page, /Promoción miércoles 2x1 en corte básico/);
  assert.match(page, /<\/section>\s*<section id="reservas" className="mt-4 scroll-mt-6">/);
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
