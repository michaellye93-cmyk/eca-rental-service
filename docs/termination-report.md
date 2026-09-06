# Recommended for Termination report

The admin Analytics tab now starts with a read-only management report using the latest 56 Kuala Lumpur calendar dates. The remainder of Analytics is unchanged. It reads drivers and their complete payment ledger on entry and Refresh Report; it never inserts, updates, deletes, delists, sends notices or calls an AI provider.

## Evidence and calculations

- The observation window includes the report date. The comparison balance is reconstructed at the end of the previous day before the window (56 days before the report date).
- Weekly periods are eight consecutive seven-day blocks ending on the report date. FULL means cash >= rental due; PARTIAL means positive cash < due; ZERO means due with no cash. Weeks with no rental due are excluded from failure counts.
- The latest open block is displayed but excluded from the completed-week repetition test. Weekly accounts need at least four completed rental periods and 28 elapsed days before any recommendation.
- Monthly accounts have actual billing-cycle rows, no weekly failure counts. At least two cycles must each have 14 days of exposure, and at least one must be completed. Open monthly periods are clearly marked.
- Cash is payments.amount. Service claims reduce principal but never count as cash coverage, positive cash days or meaningful payments.
- Balances match calculateActiveBalance: rental starts at commencement, stops before contract_end_date, and is reduced by all available dated payments and service claims using FIFO. Future-dated payments are excluded. No penalty projection is included.
- The current application accrues beyond contractDuration when no end date is set. This report preserves that balance for reconciliation but withholds a recommendation if such accrual exists. Active accounts whose recorded contract already ended are likewise withheld.
- Historical balances and invoice allocations are reconstructions using current contract fields; contract edits are not versioned. Same-day allocation order uses payment ID, with cash before that transaction's service credit.
- Lateness is the cash-amount-weighted, nonnegative difference between cash date and inferred invoice due date, for cash received inside the observation window. No unallocated advance or service credit enters that average. The oldest unpaid invoice is separately shown.
- Meaningful payment aggregates same-day positive cash and requires one weekly rental. For monthly accounts only, the threshold is monthly rent × 12 / 52, rounded up to cents. Latest payment/meaningful payment can precede the window but are contextual indicators, not a replacement observation period.

## Recommendation rules — combined conditions, no score

All thresholds are deterministic and covered by tests. There is no numerical score, model call or weighted ranking.

Eligibility gates reject inactive accounts, invalid/negative/duplicate-ID ledger data, unsupported contract data, ended agreements, post-duration accrual and insufficient observation. An account must have positive outstanding and rent due in the window.

Recovery takes precedence:

1. Cash coverage >= 98% in the eight-week window excludes the account, regardless of historic debt.
2. Alternatively, the latest 28 days must cover all rent due, reduce outstanding by more than the stability tolerance, and show consistency (at least three rental weeks, with >= 75% fully paid; monthly: a fully cash-covered cycle starting in those 28 days).

An account then needs one of these combined evidence paths:

- **Low cash with deterioration/persistence:** repeated failures, cash coverage < 70%, and either materially increased outstanding or stable/increasing substantial arrears with an extended cash gap. At least one corroborating fact must hold: extended cash gap, old unpaid invoice, materially late cash, or substantial arrears.
- **Sustained underpayment:** very frequent failures, cash coverage < 90%, materially increased outstanding, substantial arrears, and at least one of old invoices, materially late cash or an extended cash gap.

Threshold definitions:

| Fact | Weekly | Monthly |
| --- | --- | --- |
| Repeated failures | At least 3 and at least half of completed rental periods | At least 2 sufficiently observed underpaid billing cycles |
| Very frequent failures | At least 4 and at least 75% of completed rental periods | At least 2 sufficiently observed underpaid billing cycles |
| Material outstanding increase | >= half a rental cycle, minimum RM1 | Same |
| Approximately stable | Within 2% of a rental cycle, minimum RM1 | Same |
| Extended cash gap | >= 21 days | >= 30 days |
| Old unpaid invoice | >= 21 days | >= 30 days |
| Materially late recent cash | Weighted average >= 14 days | Weighted average >= 30 days |
| Substantial arrears | >= 2 weekly rentals | >= 1 monthly rental |

Recommendations are ordered lexicographically by failed-period proportion, cash shortfall, outstanding increase, cash gap, oldest unpaid invoice age, then outstanding amount. This compares visible facts and does not generate a composite score. No names, tags, demographics or prior behavioural labels influence selection or order.

## Management review and operation

Each card includes the required verification checklist for missing receipts, external arrangements, downtime and contractual notice/default procedures. The report cannot establish that any such event did not occur. Final action belongs to management.

The SELECT-only loader uses stable-ID pagination (1,000 rows/page, active-driver ID batches). It publishes a report only after all pages succeed. An error hides prior recommendations until a full refresh succeeds. A 30-second timeout prevents indefinite loading. Records are read through the existing Supabase client and existing permissions, without new database functions or business rules.

Print Report opens the browser's print workflow and includes the evidence for every card, including collapsed cards, using styles scoped to this report. No printing occurs automatically.

## Validation

Automated tests cover observation dates, cash versus credits, FIFO lateness, catch-up payments, recovery, monthly periods, recent commencement, post-duration and ended contracts, invalid/future payments, deterministic ordering, full pagination and failed reads. Production acceptance checks reconcile every active account's current and comparison balances with the actual application function, and reconcile observation-period cash/credits with the ledger. Financial extracts and per-account test results remain local and Git-ignored; no customer data is committed to this repository.
