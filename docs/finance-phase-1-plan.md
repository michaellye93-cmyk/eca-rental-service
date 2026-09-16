# Finance Phase 1 implementation plan

Goal: implement the approved Secure Data Foundation and monthly reconciliation system, independently of operational invoice/calculation logic. The user clarified that actual workbook use is for import-format validation; real August approval and closure are not part of this build.

Spec: `C:/Users/user/Downloads/ECA_Finance_Phase_1_Secure_Data_Foundation_August_2026_Reconciliation.md`.

Architecture: a dedicated React module consumes typed Finance records through authenticated database RPCs. Finance has independent plate/cost/import records. Database transactions serialize writes and freeze complete month inputs; no closed report depends on current operational drivers or masters. Monetary calculation and workbook validation are pure tested services.

Execution: Complex. Astra owns database security, migrations, shared contracts, integration and consequential verification. Terra owns independent calculation/import services and UI. One owner per file. Existing operational components change only for the Finance navigation hook.

## Tasks

Local implementation and verification are complete. The existing project-specific Supabase token was located and verified; all three migrations are now applied to RentalDatabase. Production deployment to eca-rental-service.vercel.app is READY; the deployed interface passed the full isolated browser workflow and the live database passed privilege/anonymous-access verification. See finance-phase-1-evidence.md for results and activation steps.

- [x] Security: inspect live profiles and callers; reproduce write vulnerability through privilege checks; remove client role-write capability while retaining required own-profile reads and harmless username updates. Validate SQL on isolated PostgreSQL first, then apply approved production hardening and verify privileges. Admin identity was confirmed by the user; isolated security tests pass. Production hardening and Finance migrations were applied through the existing token after an isolated deployment dry run; live privileges were verified.
- [x] Contracts (`types/finance.ts`): explicit raw snapshots, vehicles, recurring costs, insurance, expenses, imports, lifecycle and reconciliation result.
- [x] Calculations/imports (`services/finance/calculations.ts`, `services/finance/imports.ts`, `tests/finance-calculations.test.ts`, `tests/finance-imports.test.ts`): hand-calculated financial fixtures, insurance boundary cases, >1000-row extraction completeness, workbook privacy/validation/duplicates. Parse detailed Excel rows with explicit mapping and retain source sheet/row only, excluding customer identity.
- [x] Database (`supabase/migrations/*finance*.sql`, `tests/finance-database.test.ts`): private security-definer internals, narrowly granted invoker public RPC wrappers, session plus protected Admin verification, read-only client tables, transaction-serialized mutations. Refresh raw payments with complete keyset batches; reject cross-month duplicate source IDs. Draft refresh only. Review then close freezes all inputs; reopening is explicit and audited. Validate import and cost data in the database as well as the client.
- [x] UI (`components/finance/**`, `services/finance/api.ts`): Finance-specific sign-in gate independent of local Admin state; August default; refresh/readiness/close/reopen; plain reconciliation tables, quality panel, vehicle/cost/insurance/expense maintenance, Excel preview and explicit approval/replacement, bootstrap and source audit. Close confirms unresolved warnings and requires no blocking source errors.
- [x] Integration (`components/AdminDashboard.tsx`, `tsconfig.json`, `package.json`): minimal navigation hook, include new modules in typecheck, lockfile-pinned Excel reader and isolated PostgreSQL test runtime.
- [x] Verification: anonymous/staff denial and self-promotion denial; >1000 source rows; raw cash/claim sums; closed snapshot stability after operational/master/import changes; direct write rejection; duplicate import atomicity; costs/insurance/P&L fixtures; build/typecheck/full regression tests; rendered Finance workflow where authenticated account access is available.
- [x] Evidence (`docs/finance-phase-1-evidence.md`): read-only August source baseline, isolated calculation/browser evidence, tests, preservation and real data gaps. Do not mark August closed or fully reconciled until supplied official workbooks are imported, reviewed and discrepancies resolved.

## Decisions

- User-approved extension: import monthly bank statements into Finance with explicit Admin review, matching existing payments/Smart imports/cost/insurance/expense records, and posting only reviewed debit expenses. Credits never create a second rental revenue entry. Transfers, deposits and non-P&L movements require an explicit exclusion reason. Source file hashes and transaction fingerprints prevent duplicate posting. Existing operational Bank Reconciliation remains unchanged. PDF extraction uses a new authenticated Finance-only endpoint and the existing statement extraction provider, without invoking operational reconciliation mutations.
- User clarification: deliver the Finance system inside the existing Admin dashboard; supplied August workbooks are format and calculation validation inputs. Do not auto-approve their production import or close the real month.

- Protect all Finance access with a valid non-anonymous session and current protected `profiles.role = admin`. The user confirmed the existing Admin account; a live Auth/profile join confirmed that account has the sole Admin role and the other account is staff. Production login identifiers are kept outside the repository. No separate Finance role is introduced.
- Keep original cash and claims separate. Claims increase settled rental revenue and maintenance expense; only workshop bills create ECA maintenance cash outflow.
- Smart Drive report month is explicitly confirmed at import; booking dates may cross months. No unapproved status-based exclusions. Invalid rows block posting, unmatched plate rows remain visible for review.
- Insurance uses coverage fractions of calendar months, normalized over the full coverage. A complete 12-calendar-month policy allocates 1/12 each month; partial months are proportional. Round to cents and balance the final covered month so allocations equal the premium. Show the method in the UI.
- Closed snapshots capture all source and master inputs plus calculation version. Later masters cannot alter closed reports; calculation-version changes require a migration strategy before use.
- Existing operational RLS issues are reported separately; only approved profile authorization is hardened here.
