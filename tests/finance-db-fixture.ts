import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
export const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
export const STAFF_ID = '00000000-0000-4000-8000-000000000002';
export const SESSION_ID = '00000000-0000-4000-8000-000000000003';
export async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema public,auth to anon,authenticated,service_role;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create table auth.users(id uuid primary key,email text,is_anonymous boolean default false,banned_until timestamptz,deleted_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
    create table public.profiles(id uuid primary key references auth.users(id),username text,role text check(role in ('admin','staff')),updated_at timestamptz);
    create table public.drivers(id uuid primary key,name text,car_plate text);
    create table public.payments(id uuid primary key,driver_id uuid,date date,amount numeric,service_claim numeric,payment_method text);
    alter table public.profiles enable row level security;
    grant all on public.profiles,public.drivers,public.payments to anon,authenticated,service_role;
    create policy "Enable all access for profiles" on public.profiles for all using(true) with check(true);
    create policy "Public profiles are viewable by everyone" on public.profiles for select using(true);
    create policy "Users can update own profile" on public.profiles for update using(auth.uid()=id);
    insert into auth.users(id,email) values('${ADMIN_ID}','fixture-admin@example.test'),('${STAFF_ID}','fixture-staff@example.test');
    insert into auth.sessions(id,user_id) values('${SESSION_ID}','${ADMIN_ID}');
    insert into public.profiles values('${ADMIN_ID}','fixture-admin','admin',now()),('${STAFF_ID}','fixture-staff','staff',now());
  `);
  return db;
}
export async function migrate(db: PGlite, name: string) {
  await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
}
export async function asUser(db: PGlite, id: string = ADMIN_ID, session = SESSION_ID) {
  await db.exec(`reset role; set role authenticated;`);
  await db.query(`select set_config('request.jwt.claims',$1,false)`,[JSON.stringify({sub:id,role:'authenticated',session_id:session,is_anonymous:false,exp:Math.floor(Date.now()/1000)+3600})]);
}
