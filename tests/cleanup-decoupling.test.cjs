const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

function load(file, dependencies = {}) {
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

const read = file => fs.readFileSync(file, 'utf8');
const queries = read('lib/queries.ts');
const publicRoute = read('app/api/public-booking/route.ts');
const adminRoute = read('app/api/admin-dashboard/route.ts');
const barberRoute = read('app/api/barber-dashboard/route.ts');
const reserveRoute = read('app/api/reserve/route.ts');
const cleanupRoute = read('app/api/admin/reservation-cleanup/route.ts');
const cleanupImplementation = read('lib/reservation-cleanup.ts');

test('public, admin and barber reads never invoke reservation cleanup', () => {
  for (const source of [queries, publicRoute, adminRoute, barberRoute]) {
    assert.doesNotMatch(source, /cleanupExpiredReservations|reservation-cleanup/);
  }

  assert.match(publicRoute, /export async function GET/);
  assert.match(adminRoute, /export async function GET/);
  assert.match(barberRoute, /export async function GET/);
});

test('creating a reservation no longer triggers maintenance implicitly', () => {
  assert.match(reserveRoute, /export async function POST/);
  assert.doesNotMatch(reserveRoute, /cleanupExpiredReservations|reservation-cleanup/);
  assert.match(reserveRoute, /\.rpc\("crear_turnos_agenda_seguros"/);
});

test('cleanup is exposed only by an explicit admin-only POST endpoint', () => {
  assert.match(cleanupRoute, /export async function POST\(request: Request\)/);
  assert.doesNotMatch(cleanupRoute, /export async function GET/);
  assert.match(cleanupRoute, /await requireAdministrator\(request\)/);
  assert.match(cleanupRoute, /if \("error" in access\) \{[\s\S]*?return access\.error;/);

  const authorizationIndex = cleanupRoute.indexOf('await requireAdministrator(request)');
  const cleanupIndex = cleanupRoute.indexOf('await cleanupExpiredReservations()');
  assert.ok(authorizationIndex >= 0 && authorizationIndex < cleanupIndex);
  assert.equal((cleanupRoute.match(/cleanupExpiredReservations\(\)/g) ?? []).length, 1);
  assert.match(cleanupRoute, /"Cache-Control": "no-store"/);
});

test('the shared guard preserves 401 for anon and 403 for non-admin users', () => {
  const guard = read('lib/admin-labor-access.ts');
  assert.match(guard, /if \(!user\) \{[\s\S]*?status: 401/);
  assert.match(guard, /if \(role !== "administrador"\) \{[\s\S]*?status: 403/);
  assert.match(guard, /return \{ supabase: adminSupabase as any, userId: user\.id \}/);
});

test('only an authorized administrator reaches cleanup', async () => {
  for (const [actor, expectedStatus] of [
    ['admin', 200],
    ['barber', 403],
    ['generic', 403],
    ['anon', 401]
  ]) {
    let cleanupCalls = 0;
    const route = load('app/api/admin/reservation-cleanup/route.ts', {
      'next/server': {
        NextResponse: { json: (body, init) => Response.json(body, init) }
      },
      '@/lib/admin-labor-access': {
        requireAdministrator: async () => actor === 'admin'
          ? { supabase: {}, userId: 'admin-id' }
          : {
              error: Response.json(
                { error: 'No autorizado.' },
                { status: actor === 'anon' ? 401 : 403 }
              )
            }
      },
      '@/lib/reservation-cleanup': {
        cleanupExpiredReservations: async () => {
          cleanupCalls += 1;
          return { ran: true, deleted: 0, error: null };
        }
      }
    });

    const response = await route.POST(new Request('http://localhost/api/admin/reservation-cleanup', {
      method: 'POST'
    }));
    assert.equal(response.status, expectedStatus);
    assert.equal(cleanupCalls, actor === 'admin' ? 1 : 0);
  }
});

test('cleanup criteria and mutation implementation remain unchanged', () => {
  assert.match(cleanupImplementation, /\.lt\("fecha", weekStartIso\)/);
  assert.match(cleanupImplementation, /\.in\("estado", \["confirmada", "cancelada"\]\)/);
  assert.match(cleanupImplementation, /\.in\("estado", \["cita_fijada", "bloqueado"\]\)/);
  assert.match(cleanupImplementation, /getNextRecurringDate/);
  assert.match(cleanupImplementation, /\.update\(\{ fecha: nextDate \}\)/);
});
