# ECA Rental Service: how the app fits together

A current map (12 Oct 2026). Rules for working on the project are in `CLAUDE.md`; this file only says where things are.

## The app

One React 19 + Vite single-page app (`index.tsx` → `App.tsx`), served by Vercel, talking straight to one Supabase
project (Postgres + Auth + Edge Functions). There is no other server. Two kinds of people use it:

- **Office (admin and staff)** sign in with an Access ID (`components/LoginView.tsx`, `services/accessIdAuth.ts`,
  Edge Function `access-id-login`) and get the admin screens (`components/AdminDashboard.tsx`).
- **Drivers** sign in on their phone with their NRIC and get their own page (`components/DriverDashboard.tsx`).

## Where data loads

- `App.tsx` owns sign-in and the main data load: every `drivers` and `payments` row (paged by `services/pagedRead.ts`),
  joined into `Driver` objects with their payment history. Saving a driver or payment goes back through `App.tsx`.
- Each section loads its own extra data when it opens (lazy-loaded screens, see `React.lazy` in `AdminDashboard.tsx`).
- Every money figure on screen (balance, overdue, next due date, invoices, collections) is calculated in the browser
  from drivers + payments. Nothing pre-computed is stored for drivers.

## The one rent engine

`buildRentSchedule` in `utils.ts` is the only place rent due dates and payment allocation are worked out. It is used by
`calculateDriverMetrics`, `generateDriverInvoices`, `getNextDueDate` and `latestInvoices`, so the office screens, the
driver's phone page, collections and Finance all agree. `terminationReport.ts` is a deliberate separate snapshot that
follows the same rules. Do not add another schedule or allocation copy.

## Sections

| Section | Screens | Logic / data access | Main tables |
| --- | --- | --- | --- |
| Drivers | `AdminDashboard.tsx`, `ExpandedDriverDetails.tsx`, `DriverDeposits.tsx`, `CollectionsPanels.tsx`, `CollectionsDataPage.tsx` | `App.tsx`, `utils.ts`, `services/collections*.ts`, `services/depositsApi.ts`, `services/driverChanges.ts`, `services/paymentLog.ts` | `drivers`, `payments`, `driver_deposits`, `payment_changes`, `driver_changes`, `payment_promises`, `catch_up_plans`, `collection_settings`, `driver_screenings` |
| Fleet | `components/fleet/` | `services/fleet/` | `cars` (road tax, insurance, inspection dates), `car_details` |
| Agreements | `components/agreements/` | `services/agreements/` (`defaults.ts` holds the clause drafts) | `agreement_settings` (company details, payment accounts, saved templates), `driver_agreements` (text copy for the driver page) |
| Finance (Money, admin only) | `components/finance/`, `components/money/` | `services/finance/` | everything in the `finance_private` schema, reached only through `public.finance_*` functions |
| Driver phone page | `DriverDashboard.tsx`, `LanguageSwitch.tsx`, `InstallTip.tsx` | `services/driverPortal.ts`, `services/driverPortalSession.ts`, `services/portalText.ts` (EN / BM / 中文) | read through the `driver_portal_*` functions only |

Notes:

- **Drivers.** The Add / Edit Driver form is the one master input for a driver. One driver record per contract: a
  returning driver gets a new record, and the database allows one active driver per NRIC.
- **Agreements.** The PDF is made in the browser (jsPDF, A4) and never stored. It reads the driver, Fleet's
  `car_details` and `driver_deposits`; only signing-day details are typed. A text copy goes to `driver_agreements`
  so the driver can see and download it on their phone. The Grab and "other EHO" authorization letters live here too.
- **Finance.** Monthly P&L, cash, collections, vehicles, records, month close and Reconcile (matching bank statements
  to payments). Bank statement files are read by the Edge Function `finance-extract-bank-statement` (Gemini); only
  the extracted lines are kept.
- **Driver phone page.** Installable (PWA: `public/manifest.webmanifest`). `public/sw.js` keeps only the app shell so
  the installed app opens offline; it never stores Supabase requests or driver figures (those live in memory only).
  "Keep me signed in" stores a 30-day token, never the NRIC.

## Database

- Live project: RentalDatabase (see `CLAUDE.md` for the id). Never the leftover "General Database".
- `public` schema: the operational tables above, plus `profiles` (each office login's role: `admin` or `staff`).
- `finance_private` schema: all Finance data (months, vehicles, expenses, income, bank statements, reconcile drafts,
  imports, audit). The browser has no direct access to it.
- `supabase/baseline/core-tables.sql` is a reconstruction of the four oldest tables (`profiles`, `drivers`,
  `payments`, `cars`), for reference only.

## SQL files are run by hand

- New SQL goes in `supabase/migrations/` with a full `YYYYMMDDHHMMSS_name.sql` timestamp. Nothing applies these
  automatically: the owner runs each new file in the Supabase SQL Editor, before the frontend that needs it is pushed.
- Files are written to be all-or-nothing (`begin` … `commit`) and safe to run twice where possible.
- `tests/migration-chain.test.ts` replays the chain in an in-memory database (PGlite); each file also has its own
  `tests/*-database.test.ts`.
- `supabase/rollback/` holds undo files; `supabase/archive/` holds retired SQL and Edge Functions (see its README).

## Deploying

- **Frontend:** push `main` to GitHub; Vercel builds it (`npm run build`, output `dist/`, every path rewritten to
  `index.html`, see `vercel.json`). Never upload with the Vercel CLI.
- **Database:** the owner runs the SQL file by hand (above), first.
- **Edge Functions** (`supabase/functions/`): deployed separately in Supabase; pushing `main` does not deploy them.
  Server secrets (`ACCESS_ID_ACCOUNTS`, `GEMINI_API_KEY`, optional `GEMINI_MODEL`) live only in Supabase.
- Browser settings: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (public values) in Vercel and `.env.local`.

## Security model

- **Office sign-in.** `access-id-login` checks a hashed Access ID against `ACCESS_ID_ACCOUNTS`, rate-limits attempts
  and returns a normal Supabase session. The role comes from `profiles.role`; the app refuses a login without
  `admin` or `staff`.
- **Staff vs admin.** Both may read and change drivers, payments, cars and the collections tables (row policies
  "Staff and admins manage …" for signed-in users with a valid role). Only admins see Money/Finance and the
  termination report in the app, and the database enforces it: the browser calls thin `public.finance_*` functions,
  which call `security definer` functions in `finance_private` that check `finance_private.require_admin()` first.
- **Signed-out visitors** cannot read any table. The only things they can call are the driver portal functions.
- **Driver portal.** `driver_portal_login(nric)`, `driver_portal_login_remember`, `driver_portal_resume(token)` and
  `driver_portal_forget(token)` return only that driver's own contract, payments and latest agreement copy, with
  attempt limits; tokens are stored hashed and expire after 30 days.
- Changes to drivers and payments are logged (`driver_changes`, `payment_changes`) with who made them.

## Checks

`npm run lint` (tsc), `npm test` (node --test; local only, in-memory database, mocked AI calls), `npm run build`.
