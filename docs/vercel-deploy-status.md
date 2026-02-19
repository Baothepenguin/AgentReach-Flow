# Vercel Deploy Status (2026-02-19)

## Current Status
- Vercel CLI access is available in this environment (verified via project API calls).
- Production release is intentionally blocked outside the scripted 2:00–3:00 PM MST window.
- Git auto-deploy setting currently reports `createDeployments: disabled`.

## What I Prepared
- App compiles and builds successfully (`npm run check`, `npm run build`)
- Full local deep QA command (`npm run qa:deep`) with API smoke coverage
- Script-enforced production release gate (`npm run release:prod`)

## Required Vercel Environment Variables
At minimum:
- `DATABASE_URL`
- `SESSION_SECRET`
- `POSTMARK_ACCOUNT_API_TOKEN` (or `POSTMARK_SERVER_TOKEN`)
- `AI_INTEGRATIONS_GEMINI_API_KEY` (or `GEMINI_API_KEY`)
- Optional: `AI_INTEGRATIONS_GEMINI_BASE_URL`
- Optional OpenAI fallback: `AI_INTEGRATIONS_OPENAI_API_KEY`

## Deploy Commands (once logged in)
```bash
cd /Users/bao/Documents/Flow/AgentReach-Flow
vercel login
npm run qa:deep
npm run release:prod
```

## Policy Reminder
- Do not run `vercel deploy --prod` directly.
- Use the scripted release gate (`npm run release:prod`) so deep QA + release window enforcement are always applied.
- See `/Users/bao/Documents/Flow/AgentReach-Flow/docs/release-runbook.md` for full daily workflow and emergency override steps.
