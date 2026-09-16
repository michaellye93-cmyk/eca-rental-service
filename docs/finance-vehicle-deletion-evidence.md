# Finance Vehicle Master deletion

## Delivered behavior

Admin selects an existing vehicle under Finance → Settings → Vehicle Master, then chooses **Delete vehicle** and confirms the exact plate. Cancel retains the record and form selection. Successful deletion clears the form and removes the vehicle from the current Vehicle Master table and selector, including after reload. Existing plate editing remains disabled.

Deletion is recorded with `deleted_at`; it does not erase the master or linked Finance data. Historical revenue, expenses, insurance, recurring costs, import provenance and closed snapshots remain intact. Monthly costs continue until Admin ends them under Monthly Vehicle Costs; the confirmation explains this. Deleted vehicles still contribute to reports in months with financial activity, and no longer create empty report rows in months without activity.

## Implementation and safeguards

- Additive migration: `20260915120802_finance_delete_vehicle.sql`.
- The guarded delete RPC requires a valid current Admin session, a Draft selected month and the expected month revision. The existing transaction lock serializes deletion with other Finance changes.
- Records are retained, deletion is audited with the actor and original vehicle, and open-month revisions are invalidated. Closed snapshots are untouched.
- A table trigger blocks changes to an already deleted master, including stale form saves and attempts to restore it through a Vehicle Master Excel upload. A failed upload rolls back every row and metadata change in that upload.
- Anonymous callers cannot execute the RPC. Client roles have no direct UPDATE or DELETE access to the vehicle table. The public wrapper uses invoker security and the private implementation checks Admin authorization.
- Changed areas: Finance vehicle form and Settings list, delete API, vehicle type, report inclusion of deleted vehicles, scoped button styling, migration and verification scripts.

## Verification — 15 September 2026

- New isolated PostgreSQL tests first reproduced the missing delete endpoint, then passed after implementation. An additional regression caught and corrected empty report rows caused by expired insurance on deleted vehicles.
- Four deletion tests cover preserved source links and amounts, frozen/reopened reports, Admin/staff/anonymous/invalid-session access, stale revision, missing/repeated deletion, Ready/Closed denial, deleted-master write protection, atomic workbook rejection and months without activity.
- Full test suite: **103 passed**. TypeScript and production build passed; the build retains the existing large-bundle advisory.
- Browser workflow using the actual SQL migrations in isolated PostgreSQL passed: confirm/cancel/delete/reload, selected plate remains non-editable, retained financial records and vehicle drilldown, desktop/mobile display and no page errors or unexpected RPC errors. Final fixture P&L remains **RM248.76**, with vehicle contribution **RM50.01**.
- The same workflow also verifies Smart Drive's 89-row revalidation regression, section uploads, bank matching, costs, shared-cost copy, close/reopen and Admin/staff access.
- Desktop and mobile delete-dialog screenshots were inspected in `.local-tools/finance-ui/`.
- Eleven baseline operational/authentication/bank/migration files remain byte-identical. Existing financial formulas and operational vehicle/payment records are preserved.

## Database deployment

The dry run selected only the new deletion migration. It was applied to RentalDatabase (`fjgbkfbdmrnnmfxjbelf`) and the resulting function security, trigger, grants and recorded migration were verified.

Before/after counts were unchanged: 78 Finance vehicles, 77 recurring costs, zero insurance/expenses, one Finance month, 83 operational drivers, 1,909 payments and two profiles. There were zero deleted vehicles after migration; no actual user vehicle was deleted during verification.

Security advisor results are unchanged: private Finance tables retain the expected RLS/no-direct-policy INFO findings. Existing unrelated warnings concern two public functions' mutable search paths, public `reconcile_bank_statement` execution grants and disabled leaked-password protection. This migration introduces no new advisor findings.

## Production UI verification

Deployment `dpl_6vt7n9M9K3GqYLDvxCFXCBJQ3vUC` is READY and aliased to [the production app](https://eca-rental-service.vercel.app). The first upload encountered a transient network error before creating a deployment; the verified retry succeeded.

The full isolated SQL/browser workflow passed against the deployed JavaScript, including deletion and the prior Smart Drive regression. The real Admin read-only browser check passed: existing Access ID identity, reload, Finance sections, live delete confirmation and cancellation, mobile navigation and no page errors. Its test session was revoked independently without affecting the user's browser session.

Final live database check: 78 retained Finance vehicle records, zero deleted vehicles, 77 recurring costs and zero delete audit events. No real vehicle or financial record was changed during verification.
