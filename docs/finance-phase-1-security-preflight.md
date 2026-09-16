# Finance Phase 1 — security preflight and live verification

Verified 2026-09-15 against Supabase project `fjgbkfbdmrnnmfxjbelf` (RentalDatabase).

## Current status

The three approved migrations are now applied in production. Profile hardening and all 11 private Finance tables were verified after deployment. Existing record counts remain: 2 profiles, 83 drivers and 1,909 payments. No operational records were changed or real Finance imports posted.

The user approved profile-role hardening and confirmed the existing Admin account; the other account is staff. The later approved Access ID-only login creates a real Supabase session for the exact existing account, retaining protected Admin authorization. See `access-id-login-evidence.md` for that addition.

## Resolved connection issue

The project MCP connection was configured with `read_only=true` and referenced the project-specific `RENTALDATABASE_SUPABASE_ACCESS_TOKEN` environment variable. That token was already available and valid. The initial conclusion that new Supabase authorization was required was incorrect.

The token was used securely through the CLI without printing it. The CLI's previous default link pointed to a different database, so deployment used an isolated `.local-tools/finance-deploy` workspace with explicit `--project-ref fjgbkfbdmrnnmfxjbelf`. A dry run listed exactly the three Finance migrations before application. The read-only MCP configuration was retained.

## Before and after

Before migration, PUBLIC had an unrestricted ALL policy on `profiles`, and both anonymous and authenticated clients could write role values. The migration removed the known permissive policies and table/column write grants. Authenticated users can read their own profile and update their own username and updated_at, while clients cannot assign roles.

Live verification after deployment:

- Anonymous profile UPDATE: denied by privileges.
- Authenticated `profiles.role` UPDATE: denied by privileges.
- Authenticated own username UPDATE: granted, subject to own-profile RLS.
- Finance schema: 11 tables, RLS enabled on every table, zero PUBLIC/anon/authenticated table grants.
- Public Finance RPCs: anonymous EXECUTE denied; authenticated execution passes through the protected Admin/session checks.
- Anonymous HTTP access to Finance access/month RPCs: HTTP 401.
- Anonymous call to the deployed bank extraction endpoint: HTTP 403, `Admin access required`.
- Migration history contains all three exact local versions, with existing migration history preserved.

Isolated PostgreSQL tests additionally verify real-session requirements, staff denial, expired/missing sessions, self-promotion denial, direct Finance writes, frozen month inputs and stale revisions. Browser fixture tests verify the rendered workflow. Live Access ID login verified the exact existing Admin/staff identities and Finance access true/false; only the test sessions were revoked.

## Advisors

After adding the private login limiter, the 12 `RLS Enabled No Policy` informational findings are expected: private tables have no client grants and are accessed through narrow authorized functions. Granting client table access would defeat this boundary. [Advisor description](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Pre-existing findings remain outside this Finance change: mutable search paths on `cleanup_all_ghost_invoices_manual` and `reconcile_bank_statement`, public execution of operational reconciliation, and disabled leaked-password protection. [Function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [public function execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

See `finance-phase-1-evidence.md` for application deployment and verification details.
