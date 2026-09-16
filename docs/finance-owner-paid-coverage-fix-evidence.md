# OWNER PAID optional coverage-date fix

## Cause and change — 15 September 2026

The supplied ECA Management workbook contains a Coverage Start formula for XAE3003 that displays blank and has no cached Excel result. The workbook reader passed that formula object through to insurance parsing. String conversion produced `[object Object]`, which triggered `Enter valid coverage dates` even though a truly empty cell already worked.

- Insurance date parsing now reads formula results explicitly and treats an absent/blank result as a missing date. It does not evaluate formulas or invent coverage dates.
- Coverage validation branches by responsibility first using `validateOwnerPaid` and `validateEcaPaid`. OWNER PAID never receives ECA's required-date rule. Nonblank supplied dates retain date-validity checks.
- OWNER PAID RM0 remains zero P&L/cash cost with optional dates. Positive owner-paid premiums retain the existing Needs Review warning and zero ECA cost.
- Positive ECA-paid premiums still require valid start and end dates, including when an Excel formula has no saved result. Existing supplied dates, allocation and renewal behavior are preserved.
- The change is confined to insurance validation/parsing and its regression checks. No schema migration or production financial-data edit was needed.

## Verification

- Reproduced the exact `Enter valid coverage dates` error for XAE3003 using an XLSX formula with no cached value before changing production code.
- Both section and initial-workbook imports now pass blank-formula regression tests. Positive ECA policies with blank formula dates still fail required-date validation.
- **38 targeted tests passed** across insurance import/database, calculations and related importer tests. TypeScript and production build passed; existing bundle-size advisory remains.
- Read the user-supplied `ECA_Management_PnL_Raw_Data_Template.xlsx`: XAE3003 parses as OWNER_PAID, premium 0, null start/end/payment dates and no issues. All 12 owner-paid RM0 rows have zero coverage-date errors.
- Browser workflow verifies approval and posting of an owner-paid row with a blank Excel formula to isolated PostgreSQL. Stored coverage/payment dates are null and cash cost is zero. The same record can later be updated to an ECA-paid policy with required dates.
- Existing Smart Drive revalidation, bank review, renewals, month close/reopen, vehicle deletion/history and fixture P&L RM248.76 remain unchanged.

## Deployment

Production deployment `dpl_GaWSKjjGLHXph3Qn1oELM7koRyW8` is READY and aliased to [the dashboard](https://eca-rental-service.vercel.app).

The full isolated SQL/browser workflow and real Admin read-only smoke both passed against this deployed version. Test writes used an isolated database; no real financial records were imported, updated or deleted. No unresolved issue blocks this fix.
