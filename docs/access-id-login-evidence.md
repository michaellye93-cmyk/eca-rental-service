# Single Access ID login — implementation and verification

Date: 2026-09-15. Supabase: `fjgbkfbdmrnnmfxjbelf` (RentalDatabase).

## Requested behavior

The user explicitly replaced the separate Finance password login with the existing main Admin Access ID. The main screen now validates that credential on the server, creates a real Supabase session for the exact existing account, and opens Admin. Finance uses that same session and protected Admin role. Existing staff credentials retain staff access. There is no separate Finance role or sign-in form.

The Access ID is the sole credential: anyone who knows it can sign in as its account. This consequence was explained before implementation. The system does not claim password or multi-factor strength.

## Implementation

- `services/accessIdAuth.ts`, `components/LoginView.tsx`, `App.tsx`: asynchronous main login, specific invalid-ID/throttle/unavailable messages, session establishment, protected profile lookup, and stale-auth-response guards. Removed the former client-only Admin shortcuts and fixed-password fallback. Driver NRIC handling and operational calculations are unchanged.
- `components/finance/FinanceView.tsx`: one-session Finance access. Same-user background refresh revalidates permissions without discarding pending imports/forms. Sign-out, changed users, anonymous sessions, and denied access clear Finance-private state. Generation checks prevent stale responses or deferred callbacks from restoring it.
- `supabase/functions/access-id-login`: bounded request input, server-only SHA-256 credential mapping, exact Auth/profile UUID and role checks, disabled/deleted/anonymous denial. Generates and verifies a one-time Auth token without sending email or changing passwords, checking user identity before and after session creation. Responses contain only the session tokens and use `Cache-Control: no-store`; credentials/tokens are not logged.
- `20260915095239_access_id_login_rate_limit.sql`: private RLS limiter with no client table or function privileges. A service-only wrapper enforces atomic per-minute caller and account budgets. Caller budget is consumed before credential recognition. Missing platform caller metadata uses a restrictive shared fallback. Only a hashed address is stored, and old limiter rows are removed after one day on subsequent attempts.
- Server configuration uses `ACCESS_ID_ACCOUNTS`; no service key, credential hashes, or Access ID literals were added to application bundles. The temporary local secret file was removed after CLI configuration.

The hosted adapter uses the client-address header described by [Supabase's maintainer](https://github.com/orgs/supabase/discussions/7884). Live verification sent both normal and forged `X-Forwarded-For` requests: both were invalid-credential HTTP 401 responses and incremented one shared caller bucket, confirming that the supplied header did not select an arbitrary bucket on this deployment. Additional forged platform-IP headers received HTTP 403 at the gateway before the function. This is observed deployment behavior; changing the hosting/proxy path requires rechecking this assumption.

## Deployment and checks

- The saved project-specific Supabase token authenticated successfully. The read-only MCP configuration was retained. The CLI isolated workdir and explicit project reference were used; migration dry run listed exactly the single new limiter migration before application. Live history and service-only execution privileges were verified.
- `access-id-login` is ACTIVE with JWT gateway verification enabled. Existing Finance authorization and role grants were retained.
- `npm test`: **94 passed, 0 failed**. Includes configured-account-only sessions, role/identity checks, disabled accounts, provider failures, throttled guesses, independent callers, atomic SQL limits and denied client limiter access.
- TypeScript passed. Production builds passed; the pre-existing Finance chunk size warning remains.
- Browser regression first reproduced preview loss on background auth refresh, then passed after the fix. The complete isolated workflow verifies invalid ID rejection, one Admin login, no password form, session reload, both background auth events, imports, bank review/matching, independent P&L checks, close/reopen, sign-out clearing and staff restriction.
- Live backend requests verified the exact existing Admin and staff UUIDs. `finance_access` returned true for Admin and false for staff. Each test session was revoked with local scope; other sessions were retained.
- Independent Astra reviews found no remaining blocker in the credential/session boundary, rate limiter, or Finance auth lifecycle.

Final production deployment **`dpl_9CcdQXF3BHKJt5muL3w3BVmE6bcG`** is READY and aliased to [the live ECA dashboard](https://eca-rental-service.vercel.app).

The complete isolated browser workflow passed against that deployed interface. A separate real-backend Chrome smoke test signed in through the main Access ID form, verified the exact existing Admin identity, opened Finance directly with no password/second login, reloaded and reopened Finance successfully, and found no page errors. The rendered Finance page was visually inspected. Only that test session was revoked afterward.

Opening Finance created the expected empty August Draft month. No raw-payment refresh, imports, financial edits or month closure occurred. Final live counts: **2 profiles, 83 drivers, 1,909 payments, 1 empty Finance month, 0 Finance imports, 0 bank imports**. Screenshot: `.local-tools/finance-ui/live-single-login.png`.

Reproduction: `scripts/verify-access-id-live.mjs` requires explicit `ACCESS_LOGIN_TEST_ID`, `ACCESS_LOGIN_TEST_USER_ID` and `FINANCE_PLAYWRIGHT_MODULE` environment variables. It authenticates against production, permits only login and Finance read/access requests, and revokes its own session with local scope. It never logs credentials or tokens. `scripts/verify-finance-ui.mjs` performs all financial workflow writes solely against isolated fixtures.

## Preservation

No operational records, passwords, profile roles, or financial imports were modified by verification. The main login and Finance session handling intentionally changed as requested. Existing driver/payment/invoice/analytics/termination calculations and operational bank reconciliation code were preserved. Before the final browser smoke check, counts remained 2 profiles, 83 drivers, 1,909 payments, and zero Finance or bank imports.

The bank import structure remains available for Admin review; bank-specific extraction accuracy is unverified because no real statement sample was supplied.
