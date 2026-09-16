import test from 'node:test';
import assert from 'node:assert/strict';
import {database,migrate,asUser,STAFF_ID} from './finance-db-fixture.ts';
test('anonymous and staff clients cannot assign Admin; own profile remains readable and username editable',async()=>{
  const db=await database();
  try {
    await migrate(db,'20260915084108_secure_profile_roles.sql');
    await db.exec('set role anon');
    await assert.rejects(db.query(`update public.profiles set role='admin'`),/permission denied/);
    await asUser(db,STAFF_ID);
    await assert.rejects(db.query(`update public.profiles set role='admin' where id=$1`,[STAFF_ID]),/permission denied/);
    await assert.rejects(db.query(`delete from public.profiles`),/permission denied/);
    await assert.rejects(db.query(`insert into public.profiles(id,role) values('00000000-0000-4000-8000-000000000009','admin')`),/permission denied/);
    const rows=await db.query<{role:string}>(`select role from public.profiles`);
    assert.deepEqual(rows.rows,[{role:'staff'}]);
    await db.query(`update public.profiles set username='staff display name' where id=$1`,[STAFF_ID]);
    assert.equal((await db.query<{username:string}>('select username from public.profiles')).rows[0].username,'staff display name');
  } finally {await db.close();}
});
