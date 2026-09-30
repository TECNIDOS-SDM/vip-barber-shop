const { test } = require('node:test');
const assert = require('node:assert/strict');
const { confirmedFixture, clickSend, renderCard } = require('./helpers/whatsapp-confirmation.cjs');

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
    assert.equal(state.opened, false);
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

test('Enviar opens the same link repeatedly without any reservation request', () => {
  const fixture = confirmedFixture();
  const navigations = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const popup = { opener: {}, location: { replace: url => navigations.push(url) } };
    clickSend(fixture, (url, target) => {
      assert.equal(url, 'about:blank');
      assert.equal(target, '_blank');
      return popup;
    });
    assert.equal(popup.opener, null);
  }
  assert.deepEqual(navigations, Array(3).fill(fixture.state.url));
  assert.equal(fixture.state.requests, 0);
  assert.equal(fixture.state.opened, true);
});

test('blocked popup preserves confirmation and allows retry without network', () => {
  const fixture = confirmedFixture();
  const original = fixture.state.url;
  clickSend(fixture, () => null);
  assert.equal(fixture.state.url, original);
  assert.equal(fixture.state.opened, false);
  assert.equal(fixture.state.error, 'No fue posible abrir WhatsApp. Intenta nuevamente.');
  assert.match(renderCard(fixture.state), /role="alert"/);
  clickSend(fixture, () => ({ location: { replace() {} } }));
  assert.equal(fixture.state.error, null);
  assert.equal(fixture.state.opened, true);
  assert.equal(fixture.state.requests, 0);
});

test('actual confirmation JSX shows exact copy and hides home until Enviar', () => {
  const fixture = confirmedFixture();
  const html = renderCard(fixture.state);
  assert.match(html, /src="\/vip-barbertop-logo\.jpeg"/);
  assert.match(html, /alt="Logo VIP BarberTop"/);
  assert.match(html, /D\u00e9janos un mensaje a nuestro wp para confirmar tu reserva/);
  assert.match(html, />Enviar<\/button>/);
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Volver al inicio/);
  assert.match(renderCard({ ...fixture.state, opened: true }), /Volver al inicio/);
});

test('success banner keeps its behavior and only shows Reservado', () => {
  const source = require('node:fs').readFileSync('components/booking/booking-shell.tsx', 'utf8');
  assert.match(source, /toast\.success\("Reservado"\)/);
  assert.doesNotMatch(source, /toast\.success\(\s*`Reserva confirmada para el dia/);
});
