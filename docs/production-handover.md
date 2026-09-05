# Production handover

## Verified on 2026-09-05

- GitHub repository: https://github.com/michaellye93-cmyk/eca-rental-service
- Branch: `main`, tracking `origin/main`.
- Original history was fetched and preserved. The pre-handover remote commit is `efcfcc1f3ed3e2c2e43effc042f0b24143f8c15b`.
- Supabase project name: **RentalDatabase**, verified through Supabase Management API project metadata.
- Supabase project ID: `fjgbkfbdmrnnmfxjbelf`.
- Supabase URL: https://fjgbkfbdmrnnmfxjbelf.supabase.co
- Project status at verification: `ACTIVE_HEALTHY`; region `ap-southeast-1`.
- Local `.env.local` uses the same Supabase URL. It and all real credentials are excluded from Git.
- The live production frontend's JavaScript also contains that exact Supabase URL.
- GitHub's deployments API confirms Vercel Production deployment `5687068548` successfully deployed the current `main` commit `efcfcc1f3ed3e2c2e43effc042f0b24143f8c15b`. The preceding two `main` commits also have successful Production deployments created by `vercel[bot]`.
- That deployment belongs to `michaellye93-cmyk`'s projects: https://eca-rental-service-m4zfeor38-michaellye93-cmyks-projects.vercel.app
- Gemini remains the default; the existing hosted Gemini function and secrets are unchanged.
- Before the handover commit, all 27 tests, frontend type checking and production build passed. A direct comparison against the live production CSS was byte-identical after removing one extra unused `.visible` utility from the local output.

## Completed release verification

- Git Credential Manager is authenticated as `michaellye93-cmyk`; the push to `main` succeeded.
- Handover commit `888f133a7116b69d518201c7f3bca86896fa2e77` was automatically deployed by Vercel. GitHub Production deployment `6277276940` reports `success`.
- Production URL: https://eca-rental-service.vercel.app/
- The production login page loads successfully. Its JavaScript asset `/assets/index-BXcEqylA.js` is byte-identical to the tested local build (SHA-256 `6C0C13489F848B350E096660F859C35359A5183F785F35CD7B7794C6B8AF4A75`).
- The deployed bundle retains the RentalDatabase URL and Gemini labels. Hosted Supabase functions and secrets were not changed by this release; OpenAI extraction is available in source but has not been activated or tested against a real OpenAI API key.
- To manage Vercel settings directly, switch Vercel to the owning `michaellye93-cmyk` account/team. The currently connected `ecatiktok002-1849` account does not list that project; this does not block the existing Git-triggered deployment flow.
- The first deployment from this workspace is verified, so Google AI Studio's GitHub development connection can now be disconnected. Keep the Gemini API key and Vercel's GitHub integration. No integration was revoked during this handover.

## Future workflow

Edit and test in Codex, commit to the existing repository, then push `main`. The existing Vercel Git integration automatically handles the frontend deployment. Supabase database and Edge Function changes require their own deliberate deployment; Vercel does not apply them merely because their files are in this repository.
