# Finance Insurance — premium and responsibility update

## Implemented behavior

Implemented the user-approved `Finance_Insurance_Import_Premium_Responsibility_Work_Instruction.md` on 15 September 2026.

- Both insurance import paths recognize `Premium (RM)` and the Premium, Insurance Premium, Cash Amount (RM), and Cash Amount aliases. The official header takes precedence. Responsibility accepts normalized case/spacing and the tolerated `RESPONSIBLITY` header spelling.
- When Cost Type is supplied, only Insurance rows enter the insurance preview. Supplier / Payee, Reference and Source remain attached to imported policies.
- Positive ECA-paid policies require valid coverage dates and allocate their premium using the existing coverage formula. Finance cash outflow uses Coverage Start automatically; there is no separate Payment Date input.
- ECA-paid RM0 records represent future renewal responsibility. Owner-paid RM0 records represent no ECA cost. Either may be saved without coverage dates, with no missing-premium/date warnings. Explicit invalid dates, invalid amounts and reversed dates still require correction.
- Owner-paid positive premiums are retained as Needs Review with the specified warning, and contribute zero ECA P&L or cash cost. Admin can correct them in Settings.
- Preview shows six measures: records, valid ECA premium total, valid ECA-paid policies, future ECA renewals, owner-paid/no-cost records and review items. Review totals count each problematic record once.
- Admin can update an undated RM0 placeholder to a paid policy using the same record ID. Add renewal retains the previous year's policy as a separate record. Re-importing undated rows matches nullable coverage keys safely; ambiguous matches fail.
- New imports require responsibility classification rather than guessing a payer. Historical closed snapshots retain calculation version 1; current reports use version 2 and the strict new responsibility rules.

## Changed areas

- Shared insurance normalization, validation, status, cash-outflow and Excel parsing helpers.
- Insurance import previews, Settings form/master table and coverage allocation.
- Migration `20260915124812_finance_insurance_premium_rules.sql`: optional zero-policy dates, optional source metadata, positive ECA coverage constraint, derived payment-date trigger, guarded save/import updates and calculation version 2 for new inputs.
- Targeted importer/database tests and deployed browser workflow checks.

## Verification

- Full suite: **120 passed, 0 failed**. This includes the insurance matrix, aliases, date/amount validation, canonical-header precedence, payment-date derivation, zero-cost saves/updates, nullable-key import updates, metadata, ECA-only totals, atomic rollback, staff denial and closed-snapshot preservation.
- TypeScript check (`npm run lint`) and production build passed. The existing bundle-size advisory remains.
- Independent representative allocation: the official positive ECA policy produces the expected August allocation of RM140.14. Version-1 historical totals remain unchanged.
- Full browser workflow passed against the deployed JavaScript with Supabase requests routed to isolated PostgreSQL running the actual migrations. It covered six preview metrics, zero-premium/blank-date records, owner-positive review, updating an undated placeholder to a paid policy and automatic cash date. Desktop/mobile output was inspected.
- Existing Smart Drive 89-row revalidation, Admin/staff separation, expense imports/edits, bank review, month close/reopen, vehicle deletion/history and P&L checks still pass. The complete fixture P&L remains RM248.76.
- Real production Admin read-only smoke passed: existing Access ID login, reload, Finance navigation, revised Premium (RM) field, no separate Payment Date input, mobile navigation and no page errors. Only the test's own login session was revoked.

## Deployment

The dry run selected only the new migration. It was applied to RentalDatabase (`fjgbkfbdmrnnmfxjbelf`). Live verification confirmed nullable coverage columns, optional metadata columns, the positive-ECA coverage constraint, payment-date trigger and migration history entry.

Live function hashes match the tested migration:

| Private function | MD5 of normalized function body |
| --- | --- |
| save_record | ef86ebea52cc01f8e2116dc1919ecbbc |
| post_section_workbook | 46c4ae12f16d60c574de48574f85cc18 |
| base_input | 36fbda2851c0f900678efe7b184e6d11 |

Anonymous save/import execution remains denied. Direct insurance-table updates remain denied to anonymous/authenticated clients. Trigger-helper execution remains denied to both client roles. Existing guarded Admin RPC access is preserved.

Production deployment **dpl_EATMwbZ1qMwy6yXXvgqss1BGYcPZ** is READY and aliased to [the app](https://eca-rental-service.vercel.app). Both browser checks above passed after this deployment.

Before and after migration and browser verification, live counts remain 78 Finance vehicles, 77 recurring costs, zero insurance policies, zero expenses and zero closed months. No real financial records were imported or edited during verification.

## Preservation and limitations

Closed inputs and historical calculation behavior are preserved. Existing Smart Drive, vehicle disposal, bank-review and unrelated finance calculations retain their behavior. The intentional changes are the approved insurance premium/responsibility/date rules above.

Security advisors show no new findings. Existing unrelated warnings remain for legacy public-function search paths/execution and Auth leaked-password protection; see [database advisory remediation](https://supabase.com/docs/guides/database/database-linter) and [password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Private Finance tables continue to use guarded functions with direct row access denied.

Production writes were verified in the isolated database/browser workflow; the real production smoke was read-only. No unresolved issue blocks this update.
