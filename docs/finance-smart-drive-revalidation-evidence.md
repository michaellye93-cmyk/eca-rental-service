# Smart Drive preview revalidation fix

## Root cause and change

The Smart Drive selection handler passed the page's existing `input.vehicles` into the parser. A database change made after that state loaded was therefore absent from a later preview. The parser also returned row counts in fields named `matched_vehicles` and `unmatched_vehicles`.

Every selection, reselection, worksheet/column mapping change, reopened pending review and explicit Revalidate now reads the latest month and workspace metadata through the existing guarded Finance APIs before matching. Draft month reads include the current Finance Vehicle Master. Closed snapshots remain frozen and cannot accept new import previews.

The selected file and mapping may be retained in memory for **Review selected file**, but previous match results are never used to validate a reopened preview. **Revalidate** reruns the database read and parsing. Pending/failed validation hides old matching results and blocks approval. Completion, error and loading-state updates are guarded against stale requests, month changes, sign-out and unmount.

Smart Drive previews separately report matched/unmatched rows and distinct normalized matched/unmatched vehicle plates. Rows without a plate remain blocking errors and count as unmatched rows, without inventing a vehicle. Amounts, parsed rows, source provenance and normalization rules are unchanged.

The existing native file-input reset is retained and verified, so choosing the identical file again triggers selection.

## Verification

- Before the fix, the browser regression reproduced the reported failure with an 89-row workbook: adding a master record and selecting identical bytes still left 89 unmatched rows.
- After the fix, the same test progresses from 0/89 matched/unmatched rows to 60/29 after a database addition and reselection, then 89/0 on reopened review after another addition. It correctly shows 1/1 and 2/0 distinct matched/unmatched vehicles.
- Editing a master plate while the preview is open is reflected by Revalidate. A simulated database-read outage hides stale matching results and disables approval; retry recovers.
- The native input value is empty after review and the same-file tests create no posted imports.
- The parser regression covers repeated plates, case/whitespace normalization, missing plates and reparsing identical bytes against changed masters. It verifies unchanged rows, revenue and commission.
- TypeScript and production build pass. Full suite: **99 passed**.
- The full isolated browser workflow also passes: mapped Smart Drive posting, bank review, exact P&L totals, expense/master editing, copy, close/reopen, Admin/staff access and desktop/mobile layouts.
- Preservation check: 13 baseline operational, authorization, calculation, API and migration files are unchanged. Only the intended Smart Drive preview matching contract changes in the original parser/types.

No database migration, financial posting, source refresh or real Finance record edit is part of this fix. Workflow tests use an isolated PostgreSQL fixture.

## Deployment

Production deployment `dpl_3m2bfB2ciEiVcGcTUNVr5QP5kJHX` is READY and aliased to https://eca-rental-service.vercel.app.

The 89-row revalidation regression and full isolated Finance browser workflow passed against the deployed JavaScript. The real Admin read-only smoke test also passed, with its own test session revoked afterward. No real financial records were changed.
