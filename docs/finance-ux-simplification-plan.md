# Finance UX simplification

Source: the user's `ECA_Finance_UX_Simplification_Sectioned_Data_Upload_Work_Instruction.md`, supplied 2026-09-15 with a request to apply `design-taste-frontend-v1`.

## Design

Finance becomes an owner-facing Management P&L workspace. Overview is the default, followed by Month Close, Vehicles, Expenses and Settings. Audit Details and Reconciliation Tools are secondary destinations. One global month selection keeps the report, preparation and records aligned.

Use Geist, tabular financial numbers, cool neutral surfaces, a muted emerald accent, restrained borders and clear spacing. The brief's simple monthly workflow governs density and motion: transitions support navigation and feedback, with reduced-motion support. Display only real report values. Empty months explain which action starts preparation.

Monthly source sections show readiness, amounts, last update and the next action. Forms use business labels and contextual sources. Vehicle identifiers remain internal. Technical codes, source IDs and allocation details remain in audit/drill-down screens.

## Implementation boundaries

- Presentation: Finance components and a scoped stylesheet. Preserve the outer operational dashboard and single-login authorization lifecycle.
- Supporting actions: additive, narrowly authorized APIs for section imports, durable optional-section review and explicitly reviewed copying of prior shared costs. Preserve the original engine, original imports, schema tables, formulas, frozen inputs and lifecycle validation.
- Imports use preview and approval, atomic transactions, duplicate detection, server validation and audit. An optional section can be confirmed empty only when it has no records. Subsequent edits invalidate its review.
- Existing Smart Drive replacement/mapping, workshop import, initial bootstrap and bank review continue to work in their new locations.

## Verification

1. Targeted parser/database checks for new section actions, rollback, duplicate protection, current Admin access, closed-month protection and stale review/copy handling.
2. Browser checks on desktop and mobile: default Overview, five destinations, secondary audit/bank tools, readable labels, empty/loading/error states and no page overflow.
3. Complete monthly workflow against isolated SQL fixtures, including existing P&L totals, approved imports, contextual costs, optional confirmations, close/reopen, auth refresh and staff restriction.
4. TypeScript, production build and regression suite. Review all new privileged SQL before deployment.
5. Apply only the reviewed new migration with an explicit RentalDatabase target; deploy the app and verify the live read-only UI. Real financial records are not imported, refreshed, edited or closed during verification.

## Acceptance

All twelve acceptance criteria in the uploaded brief are the delivery checklist. Preserve existing operational E-hailing calculations, inputs and navigation outside Finance. Report any actual limitations with the final evidence.
