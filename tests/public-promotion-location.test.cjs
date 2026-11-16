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

test('initial barber selector places social links and exact-location action before barber cards', () => {
  const socialIndex = booking.indexOf('REDES SOCIALES');
  const locationIndex = booking.indexOf('UBICACIÓN');
  const barberIndex = booking.indexOf('liveBarbers.map');
  const mapIndex = booking.indexOf('3.4437761,-76.4901789');

  assert.ok(socialIndex >= 0);
  assert.ok(locationIndex > socialIndex);
  assert.ok(barberIndex > locationIndex);
  assert.ok(mapIndex >= 0);
  assert.match(booking, /const LOCATION_MAP_URL = "https:\/\/www\.google\.com\/maps\?q=3\.4437761,-76\.4901789&z=19"/);
  assert.match(booking, /href=\{LOCATION_MAP_URL\}/);
  assert.match(booking, /!selectedBarber \? \([\s\S]*REDES SOCIALES[\s\S]*liveBarbers\.map/);
  assert.doesNotMatch(booking, /<iframe/);
  assert.doesNotMatch(booking, /Cra\. 23 #70 04/);
});

test('header tagline highlights the service promise without changing booking controls', () => {
  assert.match(page, /<span className="text-accent">Más que un corte<\/span>, calidad y atención de primera/);
  assert.match(page, /drop-shadow-\[0_2px_1px_rgba\(0,0,0,0\.95\)\]/);
});

test('visual additions do not introduce booking, Supabase or WhatsApp mutations', () => {
  const combined = `${page}\n${booking}`;
  assert.doesNotMatch(page, /supabase|\/api\/reserve|RESERVATION_WHATSAPP_NUMBER/);
  assert.equal((booking.match(/fetch\("\/api\/reserve"/g) ?? []).length, 1);
  assert.equal((booking.match(/const RESERVATION_WHATSAPP_NUMBER/g) ?? []).length, 1);
  assert.match(combined, /AGENDA TU CITA/);
});
