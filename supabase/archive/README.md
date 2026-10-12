# Archive

Code that no longer runs, kept for reference. Nothing here is deployed or tested.

- `functions/reconcile-statement/`: the old bank-reconciliation Edge Function, replaced on 27 Sep 2026 by the Reconcile
  tab (Finance) and `finance-extract-bank-statement`. It read every driver and payment with the service-role key and had
  no caller check, so the deployed copy must be deleted in the Supabase dashboard (Edge Functions → reconcile-statement
  → Delete). Its tests are in `tests/`.

## `migrations/` (moved 12 Oct 2026)

Old SQL files moved out of `supabase/migrations/` unchanged. Nothing runs SQL files automatically (the owner runs each
new file by hand in the SQL Editor), but their non-standard names (`20260518_…`, `…_1.sql`) would be ordered wrongly by
the Supabase CLI, and none of them describes anything the app still uses.

- `20260518000000_1_update_reconcile_rpc.sql`, `20260518_reconcile_bank_statement.sql`, the `20260521…` rewrites
  (`update_reconcile_bank_statement`, `smarter_reconciliation`, `reconcile_match_payments`(`_refined`),
  `audit_system_transactions`, `fix_reconciliation_logic`, `strict_reconciliation`, `stricter_matching`, `fix_delisted`,
  `allow_delisted`, `debug_matching`), `20260527000000_bank_recon_cash_deposit.sql` and
  `20260612000000_upgrade_bank_reconciliation.sql`: each only redefines `public.reconcile_bank_statement(jsonb)`, the
  database side of the retired Bank Recon screen.
- `20260521000000_1.sql` … `20260521000003_1.sql`: empty files.
- `20260521000012_test_query.sql`: the debug function `public.test_get_drivers()`.
- `20260526000001_create_fleet_snapshots.sql`: the `fleet_snapshots` table, never read or written by the app.
- `20260728_create_invoices.sql`: a byte-identical copy of `20260728000000_create_invoices.sql` (which stays in
  `supabase/migrations/` as the record of how the `invoices` table was made).

The objects these files created (`reconcile_bank_statement`, `test_get_drivers`, `fleet_snapshots`, and `invoices`) are
dropped by `supabase/migrations/20261012220000_cleanup.sql`.
