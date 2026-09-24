# CLAUDE.md — ECA Rental Service

Claude owns this project end to end. Finish approved work with minimal process, keep the owner informed in plain language, and protect production.

## 1. Models and delegation
- **Working model:** Opus 5.5 (`"model": "opus"` in the user's `~/.claude/settings.json`). **Advisor:** Fable 5.1 (`"advisorModel": "fable"`), consulted for consequential decisions, not routine edits.
- Never claim a model or settings change without evidence from the runtime or the settings file.
- Handle small, tightly coupled or already-understood work directly. Delegate to a subagent only for one substantial, bounded task per milestone, with clear paths, contracts, file ownership and acceptance checks. The lead keeps architecture, ambiguous business rules and consequential decisions. No relay chains, nested delegation or automatic parallel teams.

## 2. Resume and bound scope
- Start by reading memory and checking the branch, `git status` and recent commits. Reuse valid findings instead of re-deriving them.
- Complete only the named feature, milestone or bug batch. No unrelated refactoring or unsolicited polish. Flag out-of-scope issues as separate tasks.
- Preserve existing workflows, formulas, data sources, permissions and history unless the owner explicitly changes them. Resolve conflicting requirements before editing affected behaviour.

## 3. Project map
- React 19 + Vite SPA. `App.tsx` owns data loading and auth; admin screens live in `components/`; the Finance module lives in `components/finance/` and `services/finance/`.
- **Rent rules have one home:** `buildRentSchedule` in `utils.ts`, used by `calculateDriverMetrics`, `generateDriverInvoices`, `getNextDueDate`, `latestInvoices` and `buildWeeklyFinancials`. Never add another schedule or payment-allocation copy. The termination report (`terminationReport.ts`) is a deliberate independent snapshot that must follow the same rules.
- Agreed rent rule: with no contract end date, rent keeps accruing past the recorded contract length until an end date or delist.
- Supabase: SQL in `supabase/migrations/`, Edge Functions in `supabase/functions/`.

## 4. Commands and verification
- `npm run dev` (port 3000) · `npm run lint` (tsc) · `npm test` (node --test) · `npm run build`.
- `npm test` is fully local (in-memory PGlite database, mocked AI calls) and never touches production.
- `npm run lint` does **not** type-check React components until `@types/react` is installed; verify screen changes with a production build plus a render or browser check.
- Write the failing test first for behaviour changes and bug fixes (test-driven development). Never weaken or delete tests to get green; report failures with exit status and the relevant excerpt.
- Run lint, tests and build on the final candidate before calling work done. Rerun only checks invalidated by later changes.

## 5. Deployment and data safety
- **The GitHub repository is public.** Never commit secrets or real business data (plates, amounts, customer details). Finance working notes stay git-ignored.
- **Frontend:** deploys only by pushing `main` (Vercel Git integration). Never upload with the Vercel CLI from this folder: that bypasses GitHub and caused production to drift from the repository on 2026-09-20.
- **Database:** live project is RentalDatabase `fjgbkfbdmrnnmfxjbelf`, which the owner reaches through Vercel → Storage → Open in Supabase. Claude prepares SQL; the owner runs it in the SQL Editor. Apply database changes before the frontend that depends on them. Never target the leftover "General Database" (`gsuvwamrgencwrhtzqyo`).
- Never ask for, accept or type passwords, access tokens, API keys or the owner's Access ID; the owner signs in themselves.
- Get explicit approval before: pushing to `main`, production deployments or migrations, destructive clean-up, live financial postings, and any business-rule change. Use isolated test data and preserve unrelated work.

## 6. Repairs and review
- Treat manual-test findings as one scoped bug batch; check for shared causes before separate patches.
- After two failed attempts on the same hypothesis without new evidence, pause that defect and report the smallest next experiment. Continue safe independent work meanwhile.
- Small changes: confirm from the diff and verification output. Complex, high-risk or money-affecting changes: get a focused independent review (a review subagent or `/code-review`). Never call self-review independent.

## 7. Confirm and stop
Stop at the approved milestone or checkpoint. End with a short plain-language summary (about 150 words): **Outcome · Changes · Verification · Limitations / decisions needed.** Never invent checks, costs, savings or deployment status.
