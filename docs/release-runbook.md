# Flow Release Runbook (Local-First)

## Policy
- Local-first development and QA is mandatory.
- Production deploys are allowed only in the daily release window: **2:00 PM to 3:00 PM MST**.
- Canonical release entrypoint: `npm run release:prod`.
- Emergency override exists but still requires deep QA.
- Do **not** run `vercel deploy --prod` directly.

## Required Scripts
- `npm run qa:deep`
- `npm run qa:deep:ci`
- `npm run release:prod`
- `npm run release:prod:emergency`

## Environment Defaults
- `RELEASE_WINDOW_START=14:00`
- `RELEASE_WINDOW_END=15:00`
- `RELEASE_TIMEZONE=MST` (resolved to `America/Phoenix`)
- `RELEASE_EMERGENCY_REASON` (required only when using emergency release)

## Daily Release Steps
1. Work and test locally only.
2. Run deep QA locally:
   - `npm run qa:deep`
3. During the 2:00–3:00 PM MST window, run:
   - `npm run release:prod`
4. Verify deployment health:
   - `curl -I https://agentreach-flow.vercel.app`
5. Run post-deploy endpoint checks:
   - `curl -sS https://agentreach-flow.vercel.app/api/auth/me`
   - Expected unauthenticated response: `401` with auth error payload.

## Emergency Release
Use only for urgent incidents.

1. Set a reason:
   - `export RELEASE_EMERGENCY_REASON="<why this cannot wait for the window>"`
2. Run:
   - `npm run release:prod:emergency`

The emergency path still runs `npm run qa:deep` and will stop on any QA failure.

## Logging
Every release attempt writes grep-friendly records to:
- `/tmp/flow-release.log`

Each attempt logs:
- commit SHA
- timestamp
- QA pass/fail summary
- deploy URL on success

## Safety Rules
- Never call `vercel deploy --prod` directly.
- Always use the scripted release entrypoint.
- If outside the release window, only use emergency with a documented reason.

Optional shell guard for team members:

```bash
alias vercel-prod='echo "Use npm run release:prod (or :emergency) instead of direct --prod deploy."'
```

## Vercel Project Setting Alignment
Set Vercel so production is not auto-promoted from `main`.

Recommended configuration for project `agentreach-flow`:
- Production branch: `release` (or another non-used branch)
- Disable automatic production deploys from `main` in Git settings
- Keep production rollouts manual through CLI release scripts

Dashboard path:
1. Open Vercel project `agentreach-flow`.
2. Go to `Settings` -> `Git`.
3. Change `Production Branch` from `main` to `release` (or other non-used branch).
4. Disable auto production deployment from git push if the option is available in your plan/UI.

Until this setting is changed in the Vercel dashboard, treat the scripted release gate as the mandatory control path.
