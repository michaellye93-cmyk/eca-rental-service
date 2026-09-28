# Collections support release

Branch `claude/collections-support`, built from `d4e43b9` (the live site). It follows the owner's brief "System changes to support Claude's daily collections run", approved on 2026-09-29, with these answers:

- day tags: warn and offer a one-click fix, never rewrite them automatically;
- plates: convert the ones already stored;
- promise, catch-up plan and "improving" rules as below;
- build every step except pay-by-link.

## What changes for you

- **Plates** are saved as `XAA1001` (capitals, no spaces), however they are typed. Search finds a plate with or without spaces. The database script converts the plates already stored.
- **Day tags**: a driver row shows an amber chip when its day tag is missing or differs from the day rent falls due. For weekly rent that is the weekday of the contract start; for monthly rent the tag is MONTHLY. Edit explains the problem and offers "Use SAT" (or whichever day is right). New drivers get the tag from the start date.
- **Who recorded or changed a payment**: each payment in the payment window and in the expanded row shows "Recorded by Staff · 29 Sept 2026, 2:05 pm". Every later edit is listed with the old and new values, and deleted payments are listed apart. It shows Admin or Staff because staff share one login. Payments recorded before the release show nothing, because who typed them was never stored.
- **Payment reference**: RM Payment and Edit payment have an optional Reference box, for the receipt or DuitNow reference. Before saving, the form warns about two cases:
  - this driver already has a payment of the same amount on the same date;
  - any driver already has a payment with the same reference.

  The payment is then saved only after "Save anyway".
- **Screening** is marked only with the red "mark screened" dot on a row. Opening Payment or Edit no longer marks the driver.
- **Search and filters** start empty every time the admin page opens, so an old search can no longer hide drivers.
- **WhatsApp group name**: a new field on the driver form, shown in the expanded row and in Contact details.
- **WhatsApp statement**: the green speech-bubble button on each row opens the statement in the agreed format, ready to paste. It lists:
  - the last 4 paid weeks;
  - every unpaid or part-paid week;
  - the balance and the next rent;
  - the bank-in line.

  It can be copied only once the bank-in line for the driver's category is set. An Admin sets it from the statement window, once for Sewa Beli and once for Sewa Biasa.
- **Promise to pay** (in the expanded row): staff and Admins log an amount, a date and a note. It shows as **Kept** once payments (cash and claims) dated from the day it was logged up to the promised date reach the amount, and as **Missed** once that date passes without that. Admins can remove one logged by mistake.
- **Catch-up plan** (in the expanded row, Admins): an extra amount each rent cycle on top of rent, a start date and an optional end date. The plan shows:
  - **On track** while rent that fell due before today and is still unpaid is no more than the balance at the start, less the extra for each rent due since then;
  - otherwise **Behind by RM …**;
  - the last six weekly checks;
  - the dates when paying rent plus the extra every cycle would bring the driver under the BAD line (MID) and to nothing owed (GOOD).

  A driver has one running plan at a time.
- **Money → Collections** opens with the **segment trend**: GOOD / MID / BAD drivers at the end of each of the last 12 weeks, and every driver who owes, **not improving first**. Improving means the balance fell over 28 days and did not rise over the last 7, the same 7-day figure the driver list shows.
- **Collections data view**: after signing in as Admin, open `https://eca-rental-service.vercel.app/admin/collections`. It is one read-only JSON block with every active driver and a summary:
  - identity, day tag and WhatsApp group;
  - rent and next due date;
  - status and the 7- and 28-day change;
  - the last 8 rent cycles and 60 days of payments;
  - the latest promise, the plan and the statement.

  It never includes NRIC, phone numbers, email or addresses. Nothing can be changed there.
- **Reconcile**: a bank credit whose reference or description contains a recorded payment reference, at the same amount, is suggested first.

## Not in this release

- **Pay-by-link** (DuitNow QR / FPX with the plate as reference) needs a payment-gateway merchant account, and you choosing the provider, before anything can be built.
- **Bank statement import** already exists: Money → Reconcile takes CSV, Excel and JSON files, or a PDF or photo, and lists unmatched credits and the "System unsolved" payments. This release only adds the reference match.

## Database script

Run it once, in the Supabase SQL Editor for RentalDatabase (Vercel → Storage → Open in Supabase), **before** publishing the new site. File: `supabase/migrations/20260929090000_collections_support.sql`. It is all-or-nothing, and running it twice changes nothing.

Effect on the current live site: none visible, except that plates are converted to capitals without spaces. The output prints how many plates were converted.

- The old spellings are kept in `finance_private.plate_conversion_backup`.
- Finance's vehicles still match, because Finance already ignores spaces and case.
- In an open Finance month, payments of drivers whose plate changed show a "vehicle attribution changed" warning after the next refresh. This was accepted on 2026-09-29.

It adds:

- the plate trigger;
- the payment change log and its trigger;
- `payments.reference` and `drivers.whatsapp_group`;
- the bank-in settings;
- the promises and catch-up plans tables.

Each is readable only by signed-in staff and Admins, and none reaches the driver portal. It does not touch `public.cars` (used by Eca Guardian).

Without the script, the new site still works: the new boxes say the database update has not been run, and saving a payment without a reference works as before.

Between running the script and publishing the new site, the old site's search finds converted plates only when they are typed without spaces (`XAA1001`, not `XAA 1001`).

The change log, promises and plans store only the role of whoever made the change (Admin or Staff), never a username or email: usernames can look like Access IDs, and these records are readable by all staff.

## Going live (owner)

1. Run the database script and keep its output.
2. Push the branch to `main`. Vercel deploys it; wait for READY.
3. Check, signed in as Admin:
   - the dashboard loads and plates show without spaces;
   - opening a payment window shows the Reference box;
   - the next real payment recorded shows "Recorded by …" under it;
   - `/admin/collections` shows the JSON.
4. Add the two bank-in lines from any driver's statement window (Admin), and check the account digits.
5. Give Claude Chat the updated operator guide (it lives outside the repository).

## Rolling back

- **Frontend**: promote the previous deployment (`d4e43b9`) in Vercel. The old site ignores everything the script added.
- **Plates**: run `supabase/rollback/20260929_collections_support_rollback.sql`. It stops the plate trigger and gives plates back their old spelling, unless a plate was changed again since. Everything typed into the new tables stays. The file lists optional statements that remove them too.
