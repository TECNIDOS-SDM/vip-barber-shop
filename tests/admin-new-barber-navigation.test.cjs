const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const dashboard = fs.readFileSync('components/admin/admin-dashboard.tsx', 'utf8');
const viewState = fs.readFileSync('lib/dashboard-view-state.ts', 'utf8');

test('new barber is an exclusive persisted admin view', () => {
  assert.match(dashboard, /"list" \| "perfil" \| "agenda" \| "servicios" \| "nuevo"/);
  assert.match(viewState, /"list" \| "perfil" \| "agenda" \| "servicios" \| "nuevo"/);
  assert.match(dashboard, /activeBarberView === "nuevo" \? \(/);
  assert.doesNotMatch(dashboard, /<CollapsibleSection[\s\S]*title="Nuevo barbero"/);

  const newView = dashboard.indexOf('activeBarberView === "nuevo" ? (');
  const listView = dashboard.indexOf('activeBarberView === "list" || !activeBarber ? (');
  const selectedBarberView = dashboard.indexOf('Barbero seleccionado', listView);
  assert.ok(newView > -1 && listView > newView && selectedBarberView > listView);
});

test('main list opens new barber and creation view can return without saving', () => {
  assert.match(dashboard, /function openNewBarberView\(\)[\s\S]*setActiveBarberView\("nuevo"\)/);
  assert.match(dashboard, /onClick=\{openNewBarberView\}[\s\S]*Nuevo barbero/);
  assert.match(dashboard, /function closeNewBarberView\(\)[\s\S]*setBarberForm\(emptyBarberForm\)[\s\S]*setActiveBarberView\("list"\)/);
  assert.match(dashboard, /onClick=\{closeNewBarberView\}[\s\S]*Regresar/);
});

test('successful creation returns to list while existing save logic remains reused', () => {
  assert.match(dashboard, /async function saveBarber\(\)/);
  assert.match(dashboard, /method: editingId \? "PATCH" : "POST"/);
  assert.match(dashboard, /if \(!editingId\) \{\s*setActiveBarberView\("list"\);\s*\}/);
  assert.match(dashboard, /onClick=\{\(\) => void saveBarber\(\)\}[\s\S]*Crear barbero/);
});

test('new view does not request a labor summary for the previously selected barber', () => {
  assert.match(
    dashboard,
    /activeBarberView === "list" \|\| activeBarberView === "nuevo"/
  );
});
