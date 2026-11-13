const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

const users = {
  admin: { id: '00000000-0000-4000-8000-000000000001' },
  barber: { id: '00000000-0000-4000-8000-000000000002' }
};
let currentUser = users.admin;
const cookieValues = new Map();
const locks = new Map();

function load(file, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unmocked dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}

const adminClient = {
  from(table) {
    assert.equal(table, 'user_session_locks');
    let userId = null;
    let hash = null;
    const query = {
      select() { return this; },
      eq(column, value) {
        if (column === 'user_id') userId = value;
        if (column === 'session_key_hash') hash = value;
        return this;
      },
      async maybeSingle() {
        const row = locks.get(userId);
        return { data: row ? { ...row } : null, error: null };
      },
      async upsert(row) {
        locks.set(row.user_id, { session_key_hash: row.session_key_hash });
        return { error: null };
      },
      delete() { return this; },
      then(resolve) {
        if (locks.get(userId)?.session_key_hash === hash) locks.delete(userId);
        return Promise.resolve({ error: null }).then(resolve);
      }
    };
    return query;
  }
};

const activeSession = load('lib/active-session.ts', {
  'server-only': {},
  'next/headers': {
    cookies: async () => ({ get: name => ({ value: cookieValues.get(name) }) })
  },
  'node:crypto': crypto,
  '@/lib/supabase/admin': { getSupabaseAdminClient: () => adminClient },
  '@/lib/supabase/server': {
    getSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: currentUser } }) }
    })
  }
});

function reset() {
  locks.clear();
  cookieValues.clear();
  currentUser = users.admin;
}

async function activate(context, user) {
  currentUser = user;
  const result = await activeSession.activateActiveSession(context);
  assert.equal(result.ok, true);
  cookieValues.set(activeSession.getActiveSessionCookieName(context), result.sessionKey);
  return result.sessionKey;
}

async function isActive(context, user, key) {
  currentUser = user;
  cookieValues.set(activeSession.getActiveSessionCookieName(context), key);
  return activeSession.requireActiveSession(context);
}

test('the newest login is the only authorized session for the same account', async () => {
  reset();
  const first = await activate('admin', users.admin);
  const second = await activate('admin', users.admin);

  assert.equal((await isActive('admin', users.admin, first)).ok, false);
  assert.equal((await isActive('admin', users.admin, second)).ok, true);
});

test('separate accounts remain independently authorized', async () => {
  reset();
  const adminKey = await activate('admin', users.admin);
  const barberKey = await activate('barber', users.barber);

  assert.equal((await isActive('admin', users.admin, adminKey)).ok, true);
  assert.equal((await isActive('barber', users.barber, barberKey)).ok, true);
});

test('logout from a replaced session cannot delete the newer lock', async () => {
  reset();
  const first = await activate('admin', users.admin);
  const second = await activate('admin', users.admin);

  currentUser = users.admin;
  cookieValues.set(activeSession.getActiveSessionCookieName('admin'), first);
  assert.equal((await activeSession.clearActiveSession('admin')).ok, true);
  assert.equal((await isActive('admin', users.admin, second)).ok, true);
});

test('simultaneous activations leave exactly one valid session key', async () => {
  reset();
  currentUser = users.admin;
  const [first, second] = await Promise.all([
    activeSession.activateActiveSession('admin'),
    activeSession.activateActiveSession('admin')
  ]);

  const results = [
    await isActive('admin', users.admin, first.sessionKey),
    await isActive('admin', users.admin, second.sessionKey)
  ];
  assert.equal(results.filter(result => result.ok).length, 1);
});

test('missing, altered and expired cookies never authorize a session', async () => {
  reset();
  const key = await activate('barber', users.barber);
  assert.equal((await isActive('barber', users.barber, '')).ok, false);
  assert.equal((await isActive('barber', users.barber, `${key}altered`)).ok, false);
  locks.clear();
  assert.equal((await isActive('barber', users.barber, key)).ok, false);
});

test('secure session implementation keeps raw keys out of browser writes and database storage', () => {
  const login = fs.readFileSync('components/admin/admin-login-form.tsx', 'utf8');
  const logout = fs.readFileSync('components/shared/sign-out-button.tsx', 'utf8');
  const source = fs.readFileSync('lib/active-session.ts', 'utf8');

  assert.doesNotMatch(login, /from\("user_session_locks"/);
  assert.doesNotMatch(logout, /from\("user_session_locks"/);
  assert.match(source, /httpOnly: true/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /hashActiveSessionKey/);
});

test('the session hardening migration stores only hashes and removes browser-role grants', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/20261113120000_harden_single_active_sessions.sql',
    'utf8'
  );

  assert.match(migration, /^begin;/m);
  assert.match(migration, /extensions\.digest\(session_key, 'sha256'\)/);
  assert.match(migration, /set\s+session_key_hash =/);
  assert.match(migration, /session_key = null/);
  assert.match(migration, /revoke all on table public\.user_session_locks from authenticated/);
  assert.match(migration, /revoke all on table public\.user_session_locks from anon/);
  assert.match(migration, /grant select, insert, update, delete on table public\.user_session_locks to service_role/);
  assert.match(migration, /^commit;/m);
  assert.doesNotMatch(migration, /grant .*authenticated/i);
});

test('all protected admin and barber entry points use the central session guards', () => {
  const files = [
    'app/admin-vip/page.tsx',
    'app/gestion-equipo/page.tsx',
    'app/api/admin-dashboard/route.ts',
    'app/api/admin-schedule/route.ts',
    'app/api/barbers/route.ts',
    'app/api/barber-dashboard/route.ts',
    'app/api/barber/labor-attendance/route.ts',
    'app/api/barber/labor-notifications/route.ts',
    'app/api/barber/labor-schedule/route.ts',
    'app/api/barber/weekly-work-schedule/route.ts'
  ];

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /requireActiveSession|requireAdministrator|requireBarber/, file);
  }
});

test('replaced sessions are checked promptly without adding a sensitive realtime channel', () => {
  const guard = fs.readFileSync('components/shared/active-session-guard.tsx', 'utf8');

  assert.match(guard, /verificationInFlightRef/);
  assert.match(guard, /document\.visibilityState !== "visible"/);
  assert.match(guard, /window\.setInterval\(\(\) => void verifySession\(\), 5_000\)/);
  assert.match(guard, /window\.addEventListener\("online", onOnline\)/);
  assert.match(guard, /void verifySession\(\);/);
  assert.doesNotMatch(guard, /\.channel\(/);
});
