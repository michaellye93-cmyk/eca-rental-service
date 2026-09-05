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

## Pending access and release verification

- Authenticate Git Credential Manager with the repository owner's GitHub account, then verify push permission.
- Push the reviewed handover commit and verify its resulting production deployment and URL through GitHub's deployment status.
- To manage Vercel settings directly, switch Vercel to the owning `michaellye93-cmyk` account/team. The currently connected `ecatiktok002-1849` account does not list that project; this does not block the existing Git-triggered deployment flow.
- Keep Google AI Studio's GitHub connection until the first deployment from this workspace has been verified. Disconnecting that development integration should not include revoking the Gemini API key or disconnecting Vercel's GitHub integration.

## Future workflow

Edit and test in Codex, commit to the existing repository, then push `main`. Once verified, the existing Vercel Git integration handles the frontend deployment. Supabase database and Edge Function changes require their own deliberate deployment; Vercel does not apply them merely because their files are in this repository.
