# Finance UX simplification — delivery evidence

Date: 15 September 2026. User brief: `ECA_Finance_UX_Simplification_Sectioned_Data_Upload_Work_Instruction.md`; design skill: `design-taste-frontend-v1`.

## Delivered

- Finance opens to a read-only Management P&L Overview: six summary figures, four business units, ranked vehicle contributions and vehicle cost drill-down.
- Five destinations: Overview, Month Close, Vehicles, Expenses and Settings. One reporting-month selector applies throughout.
- Month Close has separate E-Hailing refresh, Smart Drive, Workshop, Other Vehicle Costs and Shared/Corporate Opex sections. Each shows actual data status, totals and relevant update/review times.
- Excel files are previewed before approval. Smart Drive and Workshop retain worksheet/column mapping; Smart Drive replacement preserves prior imports. Separate master, recurring-cost and insurance imports supplement the original initial-workbook import.
- Contextual expense entry/editing, stable vehicle selection, monthly-cost editing/End Cost, insurance editing and monthly allocation display are available in the corresponding screens.
- Optional sections support persisted reviewed/none acknowledgements. Changes invalidate the acknowledgement. Copying selected prior shared costs uses a reviewed, stale-checked preview and duplicate protection.
- Warnings use business language. Source controls, E-Hailing/Smart Drive/expense rows, import history and provenance remain under Audit Details. Existing bank review is under More → Reconciliation Tools.
- Ready/Closed months disable ordinary changes; explicit return/reopen retains the existing lifecycle. The main Access ID login provides Finance access for the existing Admin.

## Verification

`npm test`: **98 passed**, including existing calculations, Auth/roles, raw-ledger ingestion, frozen snapshots, import validation, source reconciliation and bank matching. New isolated PostgreSQL tests cover atomic section imports, rollback, duplicate protection, current Admin access, closed-month denial, review invalidation, frozen previous-month costs, date clamping and stale-copy rejection.

`npm run lint`: passed. Production Vite build: passed. The existing large-chunk warning remains; Finance is lazy-loaded and the workbook library accounts for most of its bundle.

`scripts/verify-finance-ui.mjs`: passed using the real migrations in an isolated PGlite database and mocked Auth transport, both locally and against the deployed JavaScript. Verified:

- invalid Access ID denial, single Admin login, session reload/auth refresh, sign-out clearing and staff restriction;
- missing required-column rejection followed by successful mapped Smart Drive approval;
- bank expense/exclusion/match review and exact P&L of RM310, then RM300 after the source correction;
- optional-section confirmations and Ready/Close/Reopen;
- existing expense, vehicle and insurance edits without duplicate records;
- End Cost preserving the recurring record ID and start month;
- Other Vehicle Costs upload at RM19.99 and copied prior Shared Opex of RM31.25, resulting in RM248.76 management profit;
- source audit, vehicle breakdown, desktop and 390-pixel mobile layouts with no document overflow;
- no JavaScript errors or unexpected Finance RPC failures.

`scripts/verify-access-id-live.mjs`: passed against the real Admin account. Confirmed the exact account identity, direct Finance access, session reload, Overview, all five Month Close sections, Settings and mobile Audit navigation. The test revoked only its own session. No real financial imports, refreshes, edits, confirmations, copies or month closures were performed.

## Preservation and migration

SHA-256 comparison against the turn baseline: **15 files compared, 0 changed**. This covers the outer App/Admin/Login components, Access ID helper, existing Finance API/calculation/import/bank services and types, original Finance/role/bank migrations, and operational reconciliation Edge Function files. Mobile shell wrapping is CSS scoped to when Finance is present.

Migration `20260915104015_finance_section_workflows.sql` was generated using the CLI, tested locally, independently reviewed and applied to RentalDatabase with an explicit project reference. The dry run selected exactly this one migration. No seed, role or vault updates were applied.

Live catalog checks confirm three new private tables have RLS enabled and no direct anon/authenticated table privileges. Five public wrappers use invoker security and a fixed search path; anon cannot execute them. Internal fingerprint execution is revoked from both client roles. Guarded private implementations require the existing current Admin/session checks.

Before/after business counts are unchanged: 2 profiles, 83 drivers, 1,909 payments, one Finance month, zero Finance imports and zero Finance expenses. New section uploads, reviews and copies remain empty.

Security advisor comparison: no new warnings. The three new private RLS tables add expected informational notices because access is through guarded functions. Existing operational function/search-path and Auth password-protection warnings are outside this UI change and remain unchanged.

## Scope limitations

Financial workflow verification used synthetic fixtures. Real monthly workbooks were not posted during this UI task. Bank-specific PDF extraction remains unvalidated because the user explicitly requested structure only and skipped the sample statement. No new bank extraction behavior was introduced here.

## Production

Application: https://eca-rental-service.vercel.app

Final deployment: `dpl_3eyZAbBKgS5j3tSkBzg1SLGgXn68`, READY and aliased to the application URL. Both the full isolated browser workflow and real Admin read-only smoke test passed against this final deployment.

Immutable deployment: https://eca-rental-service-c6wrczkt4-michaellye93-cmyks-projects.vercel.app
