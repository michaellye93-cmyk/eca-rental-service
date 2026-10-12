# Archive

Code that no longer runs, kept for reference. Nothing here is deployed or tested.

- `functions/reconcile-statement/`: the old bank-reconciliation Edge Function, replaced on 27 Sep 2026 by the Reconcile
  tab (Finance) and `finance-extract-bank-statement`. It read every driver and payment with the service-role key and had
  no caller check, so the deployed copy must be deleted in the Supabase dashboard (Edge Functions → reconcile-statement
  → Delete). Its tests are in `tests/`.
