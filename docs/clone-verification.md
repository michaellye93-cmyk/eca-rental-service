# Clone verification — 2026-09-05

Current delivery: original ECA application running locally in Codex, connected to the existing RentalDatabase project. Gemini remains active using the current hosted function and existing key. OpenAI is prepared but not enabled.

## Verified

- Production reference inspected at https://eca-rental-service.vercel.app/ using the supplied Access UID.
- Local preview runs at http://127.0.0.1:3000/.
- Login and active-fleet screenshots manually compared with production at the browser's existing desktop size: matching layout, logo, typography, cards, colors and spacing.
- Both dashboards showed 48 active vehicles and matching status totals at inspection time.
- Local Analytics, Delisted / Returned, Driver List, bank-reconciliation month selector/upload state, NRIC driver dashboard, and logout flows opened successfully with existing data.
- Original application entry point, login, driver dashboard, expanded details, analytics, calculations, domain types, constants, logo, HTML and CSS files are byte-identical to their recorded baseline hashes.
- AdminDashboard changes only a TypeScript annotation (`label: string`), which has no runtime effect.
- BankReconciliation uses optional `VITE_AI_PROVIDER` wording; the default renders the original Gemini labels.
- Before/after production builds emitted the same CSS asset: `index-DChOTqRv.css` (76.83 kB), and the same vendor bundle.
- All original normalization, matching passes and final response construction after `let deposits` retain SHA-256 `EF8B082D0C88D704D9DE104B0BB246FF51DE0A01105A85C4719AB4ABB67A7228`.
- `npm test`: 27 passing tests for Gemini/OpenAI adapters, default provider selection, unsupported provider handling, input/output validation, handler integration, JSON compatibility and CORS.
- `npm run lint`: passes.
- `npm run build`: passes.
- Deno `check --no-config --no-lock supabase/functions/reconcile-statement/index.ts`: passes, including both adapters.
- Frontend production bundle checked for AI API endpoint and server-secret names; none found.

## Limits and release status

- Screenshots were manually compared; this is not an automated pixel-difference suite across all responsive sizes and dialogs.
- AI tests use synthetic documents and mocked network responses. No live Gemini/OpenAI document extraction was invoked during this work.
- No production rows, schema, policies, storage, Edge Functions, secrets or deployments were changed. Write workflows were not tested on real records.
- The existing Access UID bypass and browser-side NRIC lookup remain as in the original source. They are known release blockers for a secure public application.
- Eight npm audit findings remain in the original retained dependency set. No broad dependency upgrade was included.
- At the original clone checkpoint, no Git repository or remote had been created and no Vercel release had been performed. The subsequent GitHub handover is tracked in `production-handover.md`.

For current configuration and the optional future provider switch, see `README.md`.
