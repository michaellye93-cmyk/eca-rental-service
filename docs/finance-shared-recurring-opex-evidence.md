# Shared / Corporate Opex recurring import fix

## Approved result

Implemented the requested Frequency-based Shared Opex validation on 15 September 2026.

- Preferred amount header: `Amount (RM)`. Also accepts Amount, Expense Amount and Monthly Amount, with the official header taking precedence. Existing Cost/Total aliases remain compatible.
- Monthly Recurring requires a valid Start Month, non-negative cent-precision amount and approved category. End Month and Expense Date are optional. Month parsing accepts Aug-2026, ISO month/date and Excel date cells.
- Recurring rows apply inclusively when Start Month <= selected Finance month and End Month is absent or >= selected month. Valid out-of-period rows are excluded from posting and totals, with their count shown in the preview.
- Missing dates stay null through preview, database posting and subsequent amount edits. No expense/payment date is invented.
- One-off expenses retain their date requirement in the selected month. Workbooks without a Frequency column retain the existing one-off behavior; invalid or blank values in a supplied Frequency column require correction.
- Source, Notes, Description and Payee are retained. Shared Opex stays a corporate expense and is not allocated to vehicles.
- Workbook aliases map to existing categories: Internet / Unifi → Internet; Utilities - Electric and Indah Water → Utilities; EPF / KWSP → KWSP; SOCSO / PERKESO → PERKESO; Software → General Software. Unknown categories remain explicit blocking review items.

## Database and preservation

Migration `20260915132423_finance_shared_recurring_opex.sql` adds recurrence/source fields and allows null billing dates only for valid recurring Corporate Opex. The database independently enforces frequency, start/end month boundaries and existing expense categories. One-off dates remain mandatory.

Same-content Corporate Opex workbooks can be posted in different Finance months; duplicate files and expense rows remain blocked within the month. Other import types retain their global duplicate-file protection. Previous-month copy carries recurrence metadata, excludes expired recurring costs and preserves existing one-off date clamping. Duplicate recurring copies are rejected.

Existing guarded RPC permissions and closed snapshots are preserved. No public RPC contract or P&L arithmetic was replaced; approved recurring rows become expense records for the selected month through the existing Admin review/post workflow.

## Verification

- Reproduced the requested example's missing amount/date errors before implementation.
- **129 tests passed**, including new parser and database coverage for month boundaries, optional dates, amount aliases/priority, metadata, approved categories, malformed values, one-off compatibility, atomic rollback, duplicate protection, Admin/staff access, later-month import, save correction and previous-month copying with frozen history.
- TypeScript passed. Local and Vercel production builds passed; the existing bundle-size advisory remains.
- Full browser workflow passed locally. The recurring scenario imports August-only RM2800 with no date, displays excluded-month counts, saves an amount correction without introducing a date, verifies the P&L change, and uses the same workbook to post only the RM500 September row. Desktop/mobile output was inspected.
- Existing Smart Drive 89-row revalidation, insurance blank-formula fix, Admin login, bank review, month close/reopen, vehicle deletion/history and baseline fixture P&L RM248.76 remain intact before the new recurring fixture is added.
- The real user workbook's Office Rental row validates with amount 2800, start/end 2026-08-01 and null Expense Date. Nine rows have approved categories and total RM15298.90, independently recomputed from Excel cell values. Row 13, Company Loan / Financing, remains blocked for approved-category classification; it is not silently treated as an operating cost.

## Live migration verification

Dry run selected only the new migration, then it was applied to RentalDatabase (`fjgbkfbdmrnnmfxjbelf`). Live columns, constraint, migration record and both duplicate indexes match the tested schema. Direct authenticated expense updates and anonymous function execution remain denied.

Live function body hashes match the tested migration:

| Function | Normalized body MD5 |
| --- | --- |
| save_record | f75a08f8e0888a313c8f17fcc1cd9ca2 |
| post_section_workbook | 229b2dc1c79ce82639304124069df747 |
| preview_previous_shared_costs | fb15197cbab5c71bc8dfedb7e7df337d |
| copy_previous_shared_costs | cdb2cb6bd0ffe99b63b65813ea9d8cb6 |

Live counts remain zero Finance expenses and zero closed months. No actual financial records were imported, changed or deleted during verification. Security advisors are unchanged; existing unrelated legacy-function/Auth warnings remain. See [database advisory remediation](https://supabase.com/docs/guides/database/database-linter) and [password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Deployment

Deployment `dpl_H8QVw6Jmw8Tca4pgYAiJKyrP1H9a` is READY and aliased to [the dashboard](https://eca-rental-service.vercel.app). Both post-deployment checks passed: the deployed JavaScript with isolated PostgreSQL for write workflows, and a real Admin read-only login/navigation smoke. Production financial writes were not used for testing. The only outstanding workbook issue is the unapproved Company Loan / Financing category noted above.
