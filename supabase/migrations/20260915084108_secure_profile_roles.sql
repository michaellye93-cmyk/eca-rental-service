-- Approved production authorization hardening. No profile data/roles are changed.
-- Auth/profile identity was inspected and the existing sole Admin was user-confirmed.
alter table public.profiles enable row level security;
drop policy if exists "Enable all access for profiles" on public.profiles;
drop policy if exists "Public profiles are viewable by everyone" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
revoke all privileges on table public.profiles from public, anon, authenticated;
revoke all privileges (id, username, role, updated_at) on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username, updated_at) on public.profiles to authenticated;
create policy "Read own protected profile" on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy "Update own nonprivileged profile fields" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
-- Role/account provisioning remains through trusted database/service-role administration.
