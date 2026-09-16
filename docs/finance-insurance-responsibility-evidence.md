# Insurance responsibility and annual renewals

## Approved behavior

- Recognize the Excel `RESPONSIBILITY` header in the section insurance importer and the initial Finance workbook.
- Normalize case and surrounding whitespace. Accept `ECA PAID` / `OWNER PAID` and their canonical stored forms `ECA_PAID` / `OWNER_PAID`.
- Per user clarification, OWNER PAID contributes zero insurance cost to ECA P&L. ECA PAID uses the existing coverage-based monthly premium allocation. Stored premium, dates and provenance remain intact.
- Per user clarification, record responsibility for a future renewal when the new policy is entered. No automatic future-responsibility switch is inferred from the current policy.
- Admin can correct an existing policy with **Save changes**, or use **Add renewal** to create a separate policy with a new premium, responsibility and coverage end date. Renewal carries forward the vehicle and starts the day after prior coverage ends; the premium, responsibility, payment date and coverage end require new input as applicable. The prior policy is retained.

## Changes

- New responsibility type and shared normalization helper; both import previews pass the canonical field through to posting.
- A present but blank/unsupported responsibility value blocks approval. Older workbooks that omit the column remain compatible; they do not invent a payer or overwrite an already recorded responsibility.
- Insurance form and master table expose responsibility. The preview table shows it before approval. Unclassified legacy records display **Not specified**; manual saves require a selection.
- OWNER PAID policies allocate RM0 to ECA. Existing policies and frozen snapshots without responsibility preserve their prior calculation behavior.
- Bank matching excludes owner-paid policies as ECA debit matches. Changing an already matched policy to OWNER PAID invalidates that match and requires review before month close.
- Additive migration `20260915122156_finance_insurance_responsibility.sql` adds a nullable legacy-compatible column constrained to the two canonical values. Existing guarded save/import functions carry the field through updates; the bank match functions apply the responsibility rule. No permissions are broadened.

## Verification — 15 September 2026

- Test-first failures reproduced missing import normalization, missing server persistence, incorrect owner-paid allocation and inappropriate owner-policy bank matching. All pass after the scoped changes.
- **112 tests passed**, including normalization in both import paths, invalid/blank values, legacy compatibility, server authorization and constraints, atomic failed uploads, natural-key updates, closed-snapshot preservation, renewal allocation and bank-match invalidation.
- TypeScript and production build passed. Existing large-bundle build advisory remains.
- Browser workflow passed with actual migrations in isolated PostgreSQL: OWNER PAID Excel upload and preview, zero current allocation, a separate ECA PAID annual renewal, correction of its premium, and preservation of the earlier policy ID/premium/coverage. Desktop and mobile screenshots were inspected.
- Existing Smart Drive 89-row revalidation, expense uploads, bank review, month close/reopen, vehicle deletion, Admin/staff separation and P&L regression checks still pass. The full fixture P&L remains RM248.76 after the owner-paid policy and future renewal.
- Before replacing database functions, hashes verified that all four original function bodies matched the live database. This avoids overwriting unrelated live changes.

## Deployment verification

The migration dry run selected only `20260915122156_finance_insurance_responsibility.sql`; it was then applied to RentalDatabase (`fjgbkfbdmrnnmfxjbelf`). The canonical-value constraint, recorded migration, function search paths and protected grants were verified live.

Before/after data counts remain 78 Finance vehicles, 77 recurring costs, zero insurance policies and zero expenses. No real insurance or financial record was imported or edited in verification.

Security advisory results are unchanged, with no new findings. Existing unrelated warnings remain on legacy public functions and Auth password protection settings.

Production deployment `dpl_CjiASwmXF5oVKpEfvvwm9BZVRBsv` is READY and aliased to [the app](https://eca-rental-service.vercel.app). The full isolated SQL/browser workflow passed against the deployed JavaScript, including insurance import, responsibility, renewal and correction with preserved prior-year records. The real Admin read-only smoke check passed and confirmed both responsibility choices, insurance cost/coverage fields and the existing Finance navigation. Its test session was revoked independently of the user's browser session.

Post-deployment hashes confirm all four live function bodies match the tested migration exactly. No real insurance or financial records were changed during these checks.
