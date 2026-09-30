const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { confirmedFixture, clickSend, renderCard } = require('./helpers/whatsapp-confirmation.cjs');

const bookingSource = fs.readFileSync('components/booking/booking-shell.tsx', 'utf8');

const suffix = ' el d\u00eda martes 29 de septiembre a las 2:40 PM.\n\nMuchas gracias \ud83d\udc88';
for (const [names, expected] of [
  [[], ''],
  [['Mascarilla'], ' con Mascarilla'],
  [['Mascarilla', 'Lavado', 'Cejas'], ' con Mascarilla, Lavado y Cejas']
]) {
  test(`confirmed message with ${names.length} additions uses exact destination, text and encoding`, () => {
    const { state } = confirmedFixture(names);
    const url = new URL(state.url);
    const message = `Hola soy Davison, agend\u00e9 una cita con Rodrigo Miranda para Corte${expected}${suffix}`;
    assert.equal(url.origin + url.pathname, 'https://api.whatsapp.com/send');
    assert.equal(url.searchParams.get('phone'), '573024400088');
    assert.equal(url.searchParams.get('text'), message);
    assert.equal(url.search, `?phone=573024400088&text=${encodeURIComponent(message)}`);
    assert.match(state.url, /Muchas%20gracias%20%F0%9F%92%88$/);
    assert.doesNotMatch(state.url, /%EF%BF%BD|%25F0%259F%2592%2588/);
    assert.equal(state.requests, 0);
  });
}

test('accented names and separators round-trip without leaking extra fields', () => {
  const { state } = confirmedFixture(['Ba\u00f1o & cuidado'], {
    clienteNombre: 'Jos\u00e9 Pe\u00f1a', clienteWhatsapp: '0000000000',
    selectedBarber: { nombre: 'Camilo Delgado', id: 'PRIVATE-ID' },
    selectedService: { nombre: 'Corte', precio: 987654 }
  });
  const message = new URL(state.url).searchParams.get('text');
  assert.match(message, /Jos\u00e9 Pe\u00f1a/);
  assert.match(message, /Ba\u00f1o & cuidado/);
  assert.doesNotMatch(message, /0000000000|PRIVATE-ID|987654/);
});

test('Enviar opens the link, closes the final view and makes no reservation request', () => {
  const fixture = confirmedFixture();
  const navigations = [];
  const confirmedUrl = fixture.state.url;
  const popup = { opener: {}, location: { replace: url => navigations.push(url) } };
  clickSend(fixture, (url, target) => {
    assert.equal(url, 'about:blank');
    assert.equal(target, '_blank');
    return popup;
  });
  assert.equal(popup.opener, null);
  assert.deepEqual(navigations, [confirmedUrl]);
  assert.equal(fixture.state.requests, 0);
  assert.equal(fixture.state.url, null);
});

test('blocked popup preserves confirmation and allows retry without network', () => {
  const fixture = confirmedFixture();
  const original = fixture.state.url;
  clickSend(fixture, () => null);
  assert.equal(fixture.state.url, original);
  assert.equal(fixture.state.error, 'No fue posible abrir WhatsApp. Intenta nuevamente.');
  assert.match(renderCard(fixture.state), /role="alert"/);
  clickSend(fixture, () => ({ location: { replace() {} } }));
  assert.equal(fixture.state.error, null);
  assert.equal(fixture.state.url, null);
  assert.equal(fixture.state.requests, 0);
});

test('actual confirmation JSX is an exclusive final view with only Enviar', () => {
  const fixture = confirmedFixture();
  const html = renderCard(fixture.state);
  assert.match(html, /aria-label="Logo WhatsApp"/);
  assert.match(html, /data-testid="whatsapp-logo"/);
  assert.match(html, /h-14 w-14/);
  assert.match(html, /h-8 w-8/);
  assert.doesNotMatch(html, /vip-barbertop-logo\.jpeg|Logo VIP BarberTop/);
  assert.match(html, /D\u00e9janos un mensaje a nuestro wp para confirmar tu reserva/);
  assert.match(html, />Enviar<\/button>/);
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Volver al inicio/);
  assert.doesNotMatch(html, /REDES SOCIALES|Ubicación|Google Maps|AGENDA TU CITA/);
  assert.match(bookingSource, /return confirmedWhatsAppUrl \? \(/);
  assert.doesNotMatch(bookingSource, /scrollIntoView|requestAnimationFrame\(\(\) => \{\s+scrollToWhatsAppConfirmation/);
});

test('success banner keeps its behavior and only shows Reservado', () => {
  assert.match(bookingSource, /toast\.success\("Reservado", \{ duration: 4000 \}\)/);
  assert.doesNotMatch(bookingSource, /toast\.success\("Reservado", \{ duration: Infinity \}\)/);
  assert.doesNotMatch(bookingSource, /toast\.success\(\s*`Reserva confirmada para el dia/);
  assert.match(bookingSource, /Confirme su reserva para el día\{" "\}/);
  assert.doesNotMatch(bookingSource, />\s*Reserva confirmada para el dia\{" "\}/);
});
