# Cash & Efficiency release

Branch `claude/cash-efficiency`. Owner-approved on 2026-09-27 (Cash & Efficiency Review F1, F3-F8, F10-F18). F9 (Monday note) and bill due days were deferred by the review.

## What changes for you

- **Cash line** under the top bar on every admin screen: cash in bank, what is left after the next 30 days of bills, overdue rent and its weekly change, and a status (Short, Tight, Watch or Covered) with one plain sentence. Staff never see it.
- **Money tab** replaces Analytics, Bank Recon and Finance: Cash, Collections, P&L, Vehicles, Month close, Expenses, Reconcile.
- **Money → Cash**: type bank balances in the first row of the "Cash in bank" table; see the next three months and the bills coming up.
- **Reconcile**: suggested matches (ported from Bank Recon), a System unsolved list and a printable report.
- **Drivers**: late alerts show the amount owed; the list opens with cash at risk first; Termination review is a third view; phone numbers with WhatsApp buttons; screening is shared between staff.
- **Driver portal**: drivers sign in on the server and see only their own record: status, amount owed, next payment, how to pay (you write this text in Drivers → Contact details), recent payments.
- **Security**: nothing is downloaded before sign-in; the lock-down script closes the driver and payment tables to the public.

## Database scripts, in order

Run each in the Supabase SQL Editor for RentalDatabase (Vercel → Storage → Open in Supabase). Each file is all-or-nothing.

| When | File | Effect on the current live site |
|---|---|---|
| Before previewing (optional) | `supabase/migrations/20260927090000_cash_position_and_outlook.sql` | None. Adds the bank balance table and the cash outlook functions. |
| Before previewing (optional) | `supabase/migrations/20260927090100_driver_portal_phone_screening.sql` | None visible. Adds the driver sign-in function, the phone column, shared screening and the portal text. Closes `test_get_drivers()`, `reconcile_bank_statement()` and `fleet_snapshots`, which nothing uses and which let anyone read records. |
| Only after the new site is live | `supabase/migrations/20260927090200_close_public_access.sql` | Closes the driver and payment tables to anyone not signed in as staff or admin. The old site's driver login would stop working, so never run it before the new site is live. Keep the "Dropping policy" lines it prints. |

Without the first two scripts, the preview still works, but it shows "unavailable" for the cash line, the Cash page, driver sign-in, saving phone numbers and shared screening.

## Preview

The preview uses the live database. Anything you save in it (a payment, a balance, a phone number) is saved for real.

## Going live (owner)

1. Run the first two scripts, if not done for the preview.
2. Push the branch to `main`. Vercel deploys it; wait for READY.
3. Run `20260927090200_close_public_access.sql`.
4. Check: signed out, the login page loads and a driver can sign in with their NRIC; signed in, the dashboard and Money load.
5. Later, optional: delete the `reconcile-statement` Edge Function in Supabase (Bank Recon is gone), and drop the `invoices` table once nothing outside the app uses it.

## Rolling back

- **Frontend**: promote the previous deployment in Vercel.
- **After step 3**: the old site reads everything before sign-in, so it needs the tables open again. Run `supabase/rollback/20260927_reopen_public_access.sql` (kept outside the migrations folder on purpose).
