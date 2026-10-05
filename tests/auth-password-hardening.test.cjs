const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function load(file) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports;
}

const policy = load('lib/auth-password.ts');
const route = fs.readFileSync('app/api/barbers/route.ts', 'utf8');
const dashboard = fs.readFileSync('components/admin/admin-dashboard.tsx', 'utf8');

test('password policy rejects absent, empty, short and incomplete values', () => {
  for (const password of [undefined, null, '', '   ']) {
    assert.equal(
      policy.getBarberPasswordError(password, { required: true }),
      policy.BARBER_PASSWORD_REQUIRED_MESSAGE
    );
  }

  for (const password of ['Short1', 'alllowercase1', 'ALLUPPERCASE1', 'NoNumbers']) {
    assert.equal(
      policy.getBarberPasswordError(password, { required: true }),
      policy.BARBER_PASSWORD_POLICY_MESSAGE
    );
  }
});

test('password policy accepts an explicit strong password and permits an omitted optional update', () => {
  assert.equal(policy.getBarberPasswordError('Temporary9A', { required: true }), null);
  assert.equal(policy.getBarberPasswordError('', { required: false }), null);
});

test('active creation flow has no fixed password fallback', () => {
  assert.doesNotMatch(route, /12345678|password\s*:\s*accessPassword\s*\|\|/);
  assert.doesNotMatch(dashboard, /access_password:\s*["']12345678["']/);
  assert.match(dashboard, /access_password:\s*["']["']/);
});

test('admin form and backend both use the shared policy without exposing passwords', () => {
  assert.match(dashboard, /getBarberPasswordError/);
  assert.match(route, /getBarberPasswordError/);
  assert.equal((dashboard.match(/type="password"/g) || []).length, 2);
  assert.doesNotMatch(route, /console\.(log|info|warn|error)[\s\S]*accessPassword/);
  assert.doesNotMatch(route, /NextResponse\.json\([\s\S]{0,200}accessPassword/);
});

test('POST validates the password before inserting the barber', () => {
  const validationIndex = route.indexOf('const passwordError = getBarberPasswordError');
  const insertIndex = route.indexOf('const insertResult =');
  assert.ok(validationIndex >= 0);
  assert.ok(insertIndex > validationIndex);
});
