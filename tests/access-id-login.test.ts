import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAccessIdLogin, parseAccounts, hashAccessId } from '../supabase/functions/access-id-login/handler.ts';

const userId = '00000000-0000-4000-8000-000000000001';
const request = (value: unknown) => new Request('https://test/login', { method: 'POST', body: JSON.stringify(value) });
async function setup() {
  const account = { access_id_sha256: await hashAccessId('fixture-access'), user_id: userId, role: 'admin' as const };
  let sessions = 0;
  const deps = {
    accounts: [account], callerBucket: 'client:'+'a'.repeat(64), consumeAttempt: async () => true,
    getAccount: async () => ({ id: userId, email: 'fixture@test.example', role: 'admin', is_anonymous: false, banned_until: null }),
    createSession: async () => { sessions++; return { user_id: userId, access_token: 'fixture-token', refresh_token: 'fixture-refresh' }; },
  };
  return { deps, sessions: () => sessions };
}

test('only a configured Access ID creates a session for its exact current account', async () => {
  const { deps, sessions } = await setup();
  for (const access_id of ['', 'wrong', 'admin', 'REMOVED_LEGACY_PASSWORD', userId]) {
    const response = await handleAccessIdLogin(request({ access_id, user_id: userId, role: 'admin' }), deps);
    assert.ok([400,401].includes(response.status));
  }
  assert.equal(sessions(), 0);
  const response = await handleAccessIdLogin(request({ access_id: ' fixture-access ' }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { access_token: 'fixture-token', refresh_token: 'fixture-refresh' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('rejects missing, disabled, anonymous and role-changed accounts before session creation', async () => {
  const { deps, sessions } = await setup();
  for (const account of [null, { id:userId,email:'x@y.test',role:'staff' }, { id:userId,email:'x@y.test',role:'admin',is_anonymous:true }, { id:userId,email:'x@y.test',role:'admin',banned_until:'2999-01-01' }, { id:userId,email:'x@y.test',role:'admin',deleted_at:'2026-01-01' }]) {
    const response = await handleAccessIdLogin(request({ access_id:'fixture-access' }), { ...deps, getAccount: async () => account });
    assert.equal(response.status, 401);
  }
  assert.equal(sessions(), 0);
});

test('staff credentials retain staff account identity and never select an Admin', async () => {
  const { deps } = await setup();
  const staffId = '00000000-0000-4000-8000-000000000002';
  let selected = '';
  const response = await handleAccessIdLogin(request({ access_id:'fixture-access', role:'admin',user_id:userId }), {
    ...deps, accounts:[{ ...deps.accounts[0], user_id:staffId,role:'staff' }],
    getAccount:async id=>({id,email:'staff@test.example',role:'staff'}),
    createSession:async account=>{selected=account.id;return {user_id:account.id,access_token:'staff-token',refresh_token:'staff-refresh'};},
  });
  assert.equal(response.status,200);assert.equal(selected,staffId);
});

test('fails closed on rate-limit or provider errors without leaking internal details', async () => {
  const { deps, sessions } = await setup();
  const limited = await handleAccessIdLogin(request({access_id:'fixture-access'}),{...deps,consumeAttempt:async()=>false});
  assert.equal(limited.status,429);assert.equal(sessions(),0);
  const failed = await handleAccessIdLogin(request({access_id:'fixture-access'}),{...deps,createSession:async()=>{throw new Error('server-key-private-detail');}});
  assert.equal(failed.status,503);assert.equal((await failed.text()).includes('server-key'),false);
  const mismatched = await handleAccessIdLogin(request({access_id:'fixture-access'}),{...deps,createSession:async()=>({user_id:'wrong-user',access_token:'private-token',refresh_token:'private-refresh'})});
  assert.equal(mismatched.status,503);assert.equal((await mismatched.text()).includes('private-token'),false);
});

test('rejects bad methods, oversized/invalid input and invalid account configuration', async () => {
  const { deps } = await setup();
  assert.equal((await handleAccessIdLogin(new Request('https://test/login'),deps)).status,405);
  assert.equal((await handleAccessIdLogin(request({access_id:'x'.repeat(2000)}),deps)).status,400);
  assert.equal((await handleAccessIdLogin(new Request('https://test/login',{method:'POST',body:'bad-json'}),deps)).status,400);
  assert.throws(()=>parseAccounts('[]'));
  assert.throws(()=>parseAccounts(JSON.stringify([deps.accounts[0],deps.accounts[0]])));
  assert.deepEqual(parseAccounts(JSON.stringify(deps.accounts)),deps.accounts);
});

test('throttles all guesses from the same caller before lookup while preserving other callers', async()=>{
  const {deps}=await setup();
  const limited={...deps,consumeAttempt:async(bucket:string)=>bucket!==deps.callerBucket};
  assert.equal((await handleAccessIdLogin(request({access_id:'wrong'}),limited)).status,429);
  assert.equal((await handleAccessIdLogin(request({access_id:'fixture-access'}),limited)).status,429);
  assert.equal((await handleAccessIdLogin(request({access_id:'fixture-access'}),{...limited,callerBucket:'client:'+'b'.repeat(64)})).status,200);
});
