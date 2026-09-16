import test from 'node:test';
import assert from 'node:assert/strict';
import { database,migrate } from './finance-db-fixture.ts';

test('login throttling is atomic and callable only by the trusted server role', async () => {
  const db=await database();
  try {
    await migrate(db,'20260915084108_secure_profile_roles.sql');
    await migrate(db,'20260915084110_finance_foundation.sql');
    await migrate(db,'20260915095239_access_id_login_rate_limit.sql');
    for(const role of ['anon','authenticated']) {
      await db.exec(`reset role;set role ${role}`);
      await assert.rejects(db.query("select public.access_id_login_attempt('client:'||repeat('a',64))"),/permission denied/i);
      await assert.rejects(db.query('select * from finance_private.access_login_limits'),/permission denied/i);
    }
    await db.exec('reset role;set role service_role;begin');
    const results=await Promise.all(Array.from({length:31},()=>db.query<{allowed:boolean}>("select public.access_id_login_attempt('client:'||repeat('a',64)) allowed")));
    assert.equal(results.filter(x=>x.rows[0].allowed).length,30);
    assert.equal((await db.query<{allowed:boolean}>("select public.access_id_login_attempt('client:'||repeat('b',64)) allowed")).rows[0].allowed,true);
    assert.equal((await db.query<{allowed:boolean}>("select public.access_id_login_attempt('account:00000000-0000-4000-8000-000000000001') allowed")).rows[0].allowed,true);
    await db.exec('commit;reset role');
    assert.equal((await db.query("select attempts from finance_private.access_login_limits where bucket='client:'||repeat('a',64)")).rows[0].attempts,31);
  } finally {await db.close();}
});
