# Finance Phase 1 — implementation evidence and activation handover

Date: 2026-09-15. Branch: `codex/finance-phase-1`.

## Delivered in the workspace

- Admin → Finance module using one main Access ID login and the existing protected Admin account. The server creates a real Supabase session; there is no separate Finance sign-in or password form.
- Complete raw-payment snapshots, separate cash/service claims, vehicle and business Management P&L, source controls and visible data-quality issues.
- Smart Drive detailed Excel preview, column mapping, explicit approval and replacement; one-time vehicle/cost/insurance bootstrap; workshop import and in-app cost maintenance.
- Draft → Ready for review → Closed lifecycle, frozen inputs, explicit audited reopening and stale-revision protection.
- Optional bank CSV/XLSX/JSON import and a PDF/image extraction endpoint structure. Admin reviews every transaction as an expense, a match to an existing Finance source, or an exclusion with a reason. Matching does not duplicate revenue or expense. Original file hashes, transaction fingerprints and row audit prevent accidental re-import.
- Changed bank matches block readiness/closure until reviewed. Bank-created expense financial fields remain locked; existing match/exclusion decisions can be corrected in Draft with an audit reason.

The user's later clarification governs delivery: build the system, use supplied workbooks to verify import formats, and do not automatically post real imports or close August. No real bank statement sample was required.

## Verification

| Check | Evidence |
| --- | --- |
| Full automated regression suite | `npm test`: 94 passed, 0 failed |
| TypeScript | `npm run lint -- --pretty false`: passed |
| Production bundle | `npm run build`: passed; Finance bundle size warning noted below |
| Database security and migrations | Actual three SQL migrations executed in isolated PGlite PostgreSQL; anonymous/staff denial, self-promotion denial, live-session checks and private table grants verified |
| Ledger completeness | More than 1,200 raw payments loaded and independently totalled; moved source IDs protected across months |
| Lifecycle | Closed snapshots unchanged after operational/master mutations; explicit reopen, stale-revision checks, duplicate import atomicity |
| Finance calculations | Cash/claims, recurring boundaries, coverage fractions, rounding balance, unmatched rows and bank-source changes |
| Browser workflow | Chrome with real Finance RPC SQL against isolated PostgreSQL: invalid ID denial, single Admin login, session reload, staff restriction, payment refresh, Excel approval, debit expense/match/exclusion, correction of a stale match, close/reopen and sign-out clearing |
| Browser numerical check | E-hailing contribution RM80 + Daily contribution RM350 − Corporate Opex RM120 = RM310. Increasing the existing workshop expense by RM10 gives RM300; bank match adds no duplicate expense |
| Source file validation | Both supplied workbooks parsed read-only; prepared master/cost records accepted by isolated database after retaining their original unclassified cost label |

Reproduce the browser test with a local Vite server on `127.0.0.1:4173`, set `FINANCE_PLAYWRIGHT_MODULE` to the installed Playwright `index.mjs`, then run `node scripts/verify-finance-ui.mjs`. The test intercepts all Supabase calls; it performs no production writes. Screenshot: `.local-tools/finance-ui/finance-draft.png` (synthetic fixture values).

## Supplied data observations

These are validation findings, not an approved August reconciliation.

- Read-only live August ledger control: 232 rows; cash **RM [removed]**; service claims **RM [removed]**; settled revenue **RM [removed]**. Date range August 1–31. No missing driver joins in that aggregate inspection.
- `ECA_Management_PnL_Raw_Data_Template.xlsx`: 77 vehicles and 77 monthly costs. Costs start **September 2026** and retain `Owner Payout / Loan - To Classify`; none was silently backdated or reclassified. No insurance worksheet was present.
- `Sales_Report_August_2026.xlsx`: 89 detailed rows; gross revenue **RM [removed]**; commission **RM [removed]**. After applying the supplied Finance master, six rows for **XAF3004** remain unmatched and visible for Admin review.
- The original files were not modified. No actual imports were approved in production, and August remains unclosed by this task.

## Production activation — completed

Supabase project: `fjgbkfbdmrnnmfxjbelf` (RentalDatabase).

The existing project-specific access token was available in `RENTALDATABASE_SUPABASE_ACCESS_TOKEN`. It authenticated successfully. The initial migration rejection came from the connection configured as read-only; a new token/login was not required. The token was never printed. The read-only MCP configuration was retained, and the approved migrations were applied through the CLI.

The CLI's saved default link pointed to another project. An isolated `.local-tools/finance-deploy` workspace therefore contained only the four already-applied historical migrations and these three new migrations. Both dry run and application explicitly targeted RentalDatabase. The dry run listed exactly:

1. `20260915084108_secure_profile_roles.sql`
2. `20260915084110_finance_foundation.sql`
3. `20260915085705_finance_bank_statements.sql`

All three versions are now recorded in live migration history. Post-deployment SQL verified 11 private Finance tables with RLS enabled and zero direct client table grants. Client role updates and anonymous Finance RPC execution are denied. Existing records remain 2 profiles, 83 drivers and 1,909 payments. Finance months, vehicles and imports remain empty; no real reconciliation data was posted.

The `finance-extract-bank-statement` Edge Function is ACTIVE with JWT verification enabled. The existing server-side `GEMINI_API_KEY` is configured. Anonymous access returns HTTP 403 before extraction. Existing operational `reconcile-statement` code was not redeployed by this task. Real bank-specific extraction/provider accuracy remains unverified because the user intentionally omitted a bank sample.

Vercel CLI authorization confirms `michaellye93-cmyk` and access to **michaellye93-cmyks-projects → eca-rental-service**. Preview build/configuration verification passed. Production deployment **dpl_AtxrbfYJKEcSMaL3fkuCXFq1XJCj** is READY and aliased to:

**https://eca-rental-service.vercel.app**

The initial production URL returned HTTP 200 and passed the complete browser fixture workflow. The subsequent Access ID update supersedes the original separate Finance password gate; see `access-id-login-evidence.md` for its final deployment and live verification.

## Monthly use

1. Enter the existing Admin Access ID on the main login screen, then choose Finance. No second login is required.
2. Import the initial Finance master workbook once; review and complete classifications, effective dates and insurance in Finance.
3. Select the report month, refresh raw payments, upload Smart Drive Excel, inspect mapping/totals/flags and approve.
4. Add monthly workshop, vehicle and corporate expenses. Optionally upload bank transactions and review each match, expense or exclusion.
5. Resolve blocking issues, review remaining warnings, mark Ready and close. Reopen with a reason before subsequent changes to that month.

## Preservation and limitations

- Existing rental/payment/invoice/analytics/termination calculations and operational Bank Reconciliation implementation remain unchanged. Navigation adds Finance; the main Admin/Staff login now verifies the Access ID on the server and creates a real session, as requested.
- Existing permissive operational `payments`/`drivers` access remains unresolved outside scope. Profile-role hardening is now live and verified.
- Finance loads separately. ExcelJS makes the Finance chunk about 1 MB minified (about 290 KB gzip); Vite reports a size warning, while the build succeeds.
- Existing unrelated dependency audit findings remain; no broad dependency or operational refactor was applied.
- Bank format support was verified with fixtures. A real statement was intentionally omitted, so bank-specific extraction accuracy is unverified.
- The user must review and approve real imports. Bank-specific extraction accuracy remains unverified without a real sample.
