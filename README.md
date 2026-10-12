# ECA Rental Service

The admin and driver app for ECA's e-hailing car rentals (Sewa Biasa and Sewa Beli). Office staff manage drivers,
payments, collections, the fleet's road tax / insurance / inspection dates, rental agreements and the monthly
Finance books; each driver has their own phone page (English, Bahasa Malaysia, 中文) showing what they owe, when to
pay and their payment history.

React 19 + Vite single-page app on Vercel, with Supabase (Postgres, Auth, Edge Functions) behind it. How the parts fit
together: [`docs/architecture.md`](docs/architecture.md). Rules for working on the project: [`CLAUDE.md`](CLAUDE.md).

## Run locally

Use Node.js 24 or newer.

```sh
npm ci
npm run dev        # http://127.0.0.1:3000
```

Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. These are the public
browser values; server secrets never go in `VITE_*` variables or in this repository.

A local run against the live database reads and writes **real records**. Use read-only checks unless the change has
been approved and you are working with test data.

## Checks

```sh
npm run lint       # TypeScript (tsc --noEmit)
npm test           # node --test; fully local: in-memory database (PGlite), mocked AI calls
npm run build      # production build into dist/
```

Run all three before calling a change done.

## Deploying

- **Frontend:** push `main` to GitHub; Vercel builds and publishes it. Never upload with the Vercel CLI.
- **Database:** SQL files in `supabase/migrations/` are run **by hand** by the owner in the Supabase SQL Editor, before
  the frontend that needs them. Nothing applies them automatically.
- **Edge Functions** (`supabase/functions/`: `access-id-login`, `finance-extract-bank-statement`) are deployed
  separately in Supabase; their secrets live only in Supabase (see `supabase/functions/.env.example`).

## Docs

- [`docs/architecture.md`](docs/architecture.md): the current map (sections, data, rent engine, tables, security).
- `docs/*-release.md` and `docs/*-evidence.md`: notes from past releases and checks.
- [`supabase/archive/README.md`](supabase/archive/README.md): retired SQL files and Edge Functions.

## Retired: the old reconcile-statement function

The old Bank Recon screen and its `reconcile-statement` Edge Function were replaced by Finance → Reconcile and
`finance-extract-bank-statement`. The source is kept in `supabase/archive/functions/reconcile-statement/` for reference
only. **Its deployed copy must be deleted in the Supabase dashboard** (Edge Functions → reconcile-statement → Delete):
it read every driver and payment with the service-role key and had no caller check. Its database function
`reconcile_bank_statement` is dropped by `supabase/migrations/20261012220000_cleanup.sql`.
