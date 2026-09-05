# ECA Rental Service — Codex clone

The original React / TypeScript / Vite application, preserved for development in Codex. Existing components, Tailwind styling, logo, Inter font, dashboards, business calculations, Supabase database and Edge Function architecture are retained.

**Current choice: keep Gemini and the existing Gemini API key.** OpenAI support is prepared as an optional later switch. No hosted function, production secret, schema or deployment was changed during this work.

## Run locally

Use Node.js 24 or newer.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. This workspace's ignored `.env.local` is configured for the existing RentalDatabase Supabase project. For another checkout, copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. `VITE_AI_PROVIDER` defaults to `gemini` and controls provider wording only.

This is connected to the **existing database**: payment, driver, invoice and deletion controls affect real records. Preview verification should use navigation and read operations only.

## Current Gemini configuration

The browser calls the existing hosted `reconcile-statement` Edge Function, which already uses the existing Gemini key. There is no need to copy that secret into this workspace or into Vercel frontend variables.

For a future deployment of the local Edge Function source, preserve these server secrets:

- `AI_PROVIDER=gemini` (also the default when unset).
- `GEMINI_API_KEY`: the existing Gemini API key.
- `GEMINI_MODEL`: optional; defaults to the original source's `gemini-3.1-pro-preview`.

The visible legacy wording says Gemini 3.0 Flash, matching the original interface; the original server source uses Gemini 3.1 Pro Preview. This pre-existing discrepancy is preserved for clone fidelity.

Hosted Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Never put server secrets into variables prefixed with `VITE_` or frontend source files. `supabase/functions/.env.example` documents server settings without real secrets.

The unused Google browser SDK and Vite's secret injection were removed. Gemini continues through the server-side REST API.

## Optional OpenAI switch later

1. Set `OPENAI_API_KEY` in Supabase Edge Function secrets.
2. Set `OPENAI_MODEL` if desired (default `gpt-6-astra`; the account must have access to a model supporting PDF/image input and strict structured outputs).
3. Deploy `supabase/functions/reconcile-statement/index.ts` together with `gemini.ts` and `openai.ts`, and set the server's `AI_PROVIDER=openai`.
4. Set frontend `VITE_AI_PROVIDER=openai` and rebuild to update the displayed provider name.
5. Test with a synthetic statement before using real documents.

The provider choice is explicit. It never automatically falls back to a different provider. Returning `AI_PROVIDER` and `VITE_AI_PROVIDER` to `gemini` switches back to the original provider without changing the matching code.

OpenAI extraction supports PDF / PNG / JPEG / WebP files up to 2 MB, uses `store: false`, and rejects incomplete output, refusals, invalid dates and inconsistent credit amounts before matching. JSON uploads retain their existing local processing flow. The original matching passes and response fields are unchanged for both providers.

**Editing the repository does not update the hosted function.** The live app and this local clone continue calling the current hosted Gemini function until a separately coordinated release. No schema change is needed. Do not replay old migrations or reset the existing database for this provider switch.

## Verification

```sh
npm test
npm run lint
npm run build
```

Tests use synthetic statements and mocked external services; they do not send real documents to AI services or write to Supabase. The Deno Edge Function also passes `deno check`. See `docs/clone-verification.md` for completed checks and remaining limits.

`docs/frontend-baseline-sha256.json` records the original frontend file hashes. Frontend changes are limited to optional provider wording and a TypeScript-only label annotation. The compiled CSS remains identical.

## GitHub and Vercel workflow

This workspace tracks `main` in `https://github.com/michaellye93-cmyk/eca-rental-service.git`, preserving the repository's existing history. For future changes, run the checks above, review the diff, commit, and push:

```sh
git status
git diff
git add <reviewed-files>
git commit -m "Describe the change"
git push origin main
```

The production flow is Codex → GitHub `main` → the existing Vercel project under `michaellye93-cmyk`'s projects. GitHub's deployment history confirms successful Vercel Production deployments for the latest three `main` commits. The first push from this workstation still requires GitHub authentication and deployment verification. Supabase Edge Functions are a separate release; pushing frontend code does not deploy them.

`vercel.json` preserves the Vite build and SPA fallback. Configure the two public Supabase variables and optional provider label in Vercel. AI credentials belong only in Supabase Edge Function secrets. No Vercel deployment has been performed.

## Existing limitations carried over

- The Access UID handler grants admin access without validating credentials. The NRIC flow looks up already-loaded driver data in the browser. These are existing authentication weaknesses, not secure access controls; address them before releasing this clone publicly.
- Production write workflows and live AI extraction were not exercised during clone verification.
- The retained dependency set has npm audit findings (8 at verification time). Dependencies were not broadly upgraded during the visual clone.
- Older plans under `docs/superpowers` describe a broader internal rebuild. This clone follows the current instruction to retain the architecture; it does not claim to implement that older roadmap.

API references: [Gemini generation](https://ai.google.dev/api/generate-content), [OpenAI file inputs](https://developers.openai.com/api/docs/guides/file-inputs), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Supabase secrets](https://supabase.com/docs/guides/functions/secrets).
