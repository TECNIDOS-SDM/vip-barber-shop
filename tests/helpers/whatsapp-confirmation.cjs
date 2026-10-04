const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync('components/booking/booking-shell.tsx', 'utf8');
const ast = ts.createSourceFile('booking-shell.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = [];
function visit(node) {
  nodes.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);
const findFunction = name => nodes.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 }
}).outputText;
function loadDateModule(file) {
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), {
    module, exports: module.exports,
    require: name => name === '@/lib/constants' ? loadDateModule('lib/constants.ts') : require(name)
  });
  return module.exports;
}
const dates = loadDateModule('lib/date.ts');
const currency = loadDateModule('lib/currency.ts');
const confirm = findFunction('confirmReservation');
const successStatements = confirm.body.statements.find(ts.isTryStatement).tryBlock.statements;
const first = successStatements.findIndex(node => node.getText(ast).startsWith('const additionalNames ='));
const last = successStatements.findIndex(node => node.getText(ast) === 'resetBookingFlow();');
if (first < 0 || last <= first) throw new Error('Post-success message block not found');
// Execute only the post-success block: never invoke the booking function or API.
const messageCode = successStatements.slice(first, last).map(node => node.getText(ast)).join('\n');
const number = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === 'RESERVATION_WHATSAPP_NUMBER').initializer.text;
const openCode = findFunction('openReservationWhatsApp').getText(ast);
const card = nodes.find(node => ts.isConditionalExpression(node) && node.condition.getText(ast) === 'confirmedWhatsAppUrl');

function confirmedFixture(additionalNames = [], overrides = {}) {
  const state = { url: null, error: null, requests: 0 };
  const denyNetwork = () => { state.requests++; throw new Error('Network forbidden in isolated test'); };
  const context = {
    ...dates,
    ...currency,
    RESERVATION_WHATSAPP_NUMBER: number,
    clienteNombre: 'Davison',
    selectedBarber: { nombre: 'Rodrigo Miranda' },
    selectedService: { nombre: 'Corte' },
    selectedAdditionalServices: additionalNames.map(nombre => ({ nombre })),
    reservationTotal: 20000,
    selectedDate: '2026-09-29', selectedHour: '14:40',
    ...overrides,
    setConfirmedWhatsAppUrl: url => { state.url = url; },
    setWhatsAppError: error => { state.error = error; },
    fetch: denyNetwork,
    XMLHttpRequest: denyNetwork
  };
  vm.runInNewContext(compile(messageCode), context);
  return { state, context };
}

function clickSend(fixture, open) {
  vm.runInNewContext(compile(`${openCode}\nopenReservationWhatsApp();`), {
    ...fixture.context,
    confirmedWhatsAppUrl: fixture.state.url,
    window: { open }
  });
}

function renderCard(state) {
  const module = { exports: {} };
  vm.runInNewContext(compile(`module.exports = ${card.whenTrue.getText(ast)};`), {
    module, exports: module.exports, require,
    WhatsAppGoldIcon: props => require('react').createElement('svg', { ...props, 'data-testid': 'whatsapp-logo' }),
    whatsAppError: state.error,
    openReservationWhatsApp() {}, setConfirmedWhatsAppUrl() {}
  });
  return require('react-dom/server').renderToStaticMarkup(module.exports);
}

module.exports = { confirmedFixture, clickSend, renderCard };
