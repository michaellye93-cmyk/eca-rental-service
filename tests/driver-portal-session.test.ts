import test from 'node:test';
import assert from 'node:assert/strict';
import { driverPortalSession, type PortalRpc } from '../services/driverPortalSession.ts';

const RECORD = {
  driver: { id: 'd1', name: 'Fixture Driver', car_plate: 'XAA1001', contract_start_date: '2026-08-01', rental_cycle: 'WEEKLY',
    contract_duration_weeks: 10, rental_rate: 100, category: 'SEWABELI', is_delisted: false },
  payments: [{ id: 'p1', date: '2026-08-01', amount: 100, service_claim: 0, payment_method: 'BANK TRANSFER' }],
  payment_instructions: null,
};
const TOKEN = 'a'.repeat(64);

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}
function fakeRpc(handlers: Record<string, (args: any) => { data?: unknown; error?: { message: string; code?: string } }>) {
  const calls: [string, any][] = [];
  const rpc: PortalRpc = async (name, args) => {
    calls.push([name, args]);
    const handler = handlers[name];
    if (!handler) return { data: null, error: { message: `Could not find the function public.${name}`, code: 'PGRST202' } };
    const { data = null, error = null } = handler(args);
    return { data, error };
  };
  return { rpc, calls };
}

test('"keep me signed in" stores only the token, never the NRIC, and returns the driver', async () => {
  const storage = memoryStorage();
  const { rpc, calls } = fakeRpc({ driver_portal_login_remember: () => ({ data: { ...RECORD, session: { token: TOKEN, expires_at: '2026-09-01T00:00:00Z' } } }) });
  const result = await driverPortalSession(rpc, storage).signIn('900101-01-1234', true);
  assert.equal(result?.driver.carPlate, 'XAA1001');
  assert.equal(result?.driver.totalAmountPaid, 100);
  assert.deepEqual(calls, [['driver_portal_login_remember', { p_nric: '900101-01-1234' }]]);
  assert.deepEqual([...storage.data.values()], [JSON.stringify({ token: TOKEN, expiresAt: '2026-09-01T00:00:00Z' })]);
  assert.doesNotMatch([...storage.data.values()].join(), /900101/);
});

test('without the box ticked, the normal sign-in is used and nothing is stored', async () => {
  const storage = memoryStorage();
  const { rpc, calls } = fakeRpc({ driver_portal_login: () => ({ data: RECORD }) });
  assert.ok(await driverPortalSession(rpc, storage).signIn('900101011234', false));
  assert.deepEqual(calls.map(c => c[0]), ['driver_portal_login']);
  assert.equal(storage.data.size, 0);
});

test('before the SQL is run, "keep me signed in" falls back to the normal sign-in', async () => {
  const storage = memoryStorage();
  const { rpc, calls } = fakeRpc({ driver_portal_login: () => ({ data: RECORD }) });
  assert.ok(await driverPortalSession(rpc, storage).signIn('900101011234', true));
  assert.deepEqual(calls.map(c => c[0]), ['driver_portal_login_remember', 'driver_portal_login']);
  assert.equal(storage.data.size, 0);
});

test('an unknown NRIC returns null; too many tries and other failures throw a code the page can translate', async () => {
  const none = fakeRpc({ driver_portal_login: () => ({ data: null }) });
  assert.equal(await driverPortalSession(none.rpc, memoryStorage()).signIn('1', false), null);
  const limited = fakeRpc({ driver_portal_login: () => ({ error: { message: 'Too many attempts. Please wait a minute and try again.' } }) });
  await assert.rejects(driverPortalSession(limited.rpc, memoryStorage()).signIn('1', false), /rate_limited/);
  const down = fakeRpc({ driver_portal_login: () => ({ error: { message: 'network' } }) });
  await assert.rejects(driverPortalSession(down.rpc, memoryStorage()).signIn('1', false), /unavailable/);
});

test('a remembered phone reopens with the token; an expired or unknown token is forgotten', async () => {
  const storage = memoryStorage();
  storage.setItem('eca.driverSession', JSON.stringify({ token: TOKEN, expiresAt: '2999-01-01T00:00:00Z' }));
  const ok = fakeRpc({ driver_portal_resume: () => ({ data: { ...RECORD, session: { expires_at: '2999-01-01T00:00:00Z' } } }) });
  assert.equal((await driverPortalSession(ok.rpc, storage).resume())?.driver.name, 'Fixture Driver');
  assert.deepEqual(ok.calls, [['driver_portal_resume', { p_token: TOKEN }]]);
  const gone = fakeRpc({ driver_portal_resume: () => ({ data: null }) });
  assert.equal(await driverPortalSession(gone.rpc, storage).resume(), null);
  assert.equal(storage.data.size, 0);
});

test('no stored token or a past expiry means no call; a network failure keeps the token for next time', async () => {
  const empty = fakeRpc({});
  assert.equal(await driverPortalSession(empty.rpc, memoryStorage()).resume(), null);
  assert.equal(empty.calls.length, 0);
  const expired = memoryStorage();
  expired.setItem('eca.driverSession', JSON.stringify({ token: TOKEN, expiresAt: '2000-01-01T00:00:00Z' }));
  assert.equal(await driverPortalSession(empty.rpc, expired).resume(), null);
  assert.equal(expired.data.size, 0);
  const kept = memoryStorage();
  kept.setItem('eca.driverSession', JSON.stringify({ token: TOKEN, expiresAt: '2999-01-01T00:00:00Z' }));
  const down = fakeRpc({ driver_portal_resume: () => ({ error: { message: 'Failed to fetch' } }) });
  assert.equal(await driverPortalSession(down.rpc, kept).resume(), null);
  assert.equal(kept.data.size, 1);
});

test('signing out forgets the token on the server and on the phone, even if the server call fails', async () => {
  const storage = memoryStorage();
  storage.setItem('eca.driverSession', JSON.stringify({ token: TOKEN, expiresAt: '2999-01-01T00:00:00Z' }));
  const { rpc, calls } = fakeRpc({ driver_portal_forget: () => ({ error: { message: 'Failed to fetch' } }) });
  await driverPortalSession(rpc, storage).signOut();
  assert.deepEqual(calls, [['driver_portal_forget', { p_token: TOKEN }]]);
  assert.equal(storage.data.size, 0);
});

test('a browser that blocks storage still signs in, just without remembering', async () => {
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  const { rpc } = fakeRpc({ driver_portal_login_remember: () => ({ data: { ...RECORD, session: { token: TOKEN, expires_at: '2999-01-01T00:00:00Z' } } }) });
  const session = driverPortalSession(rpc, blocked);
  assert.ok(await session.signIn('900101011234', true));
  assert.equal(await session.resume(), null);
  await session.signOut();
});
