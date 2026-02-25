# AgentReach FLOW

## Cron: Send Due Newsletters

GitHub Action `.github/workflows/send-due-newsletters.yml` calls:

- `GET/POST /api/internal/cron/send-due-newsletters`
- Header: `Authorization: Bearer <secret>`

### Required environment variables

For the deployed app (server):

- `CRON_SECRET` (**preferred**) — expected bearer token for cron auth.
- `FLOW_CRON_SECRET` (fallback alias) — accepted for backward compatibility.

For GitHub Actions repository secrets:

- `FLOW_CRON_URL` — full URL to cron endpoint (example: `https://your-app.vercel.app/api/internal/cron/send-due-newsletters`)
- `FLOW_CRON_SECRET` — bearer token value (must match server `CRON_SECRET` or `FLOW_CRON_SECRET`).

### Behavior

- Returns `200` with `{ ok: true, dueCount: 0, ... }` when no newsletters are due.
- Returns `500` with structured JSON error (`code: "cron_secret_missing"`) when cron auth env is missing in production.
- Returns `401` with structured JSON error (`code: "invalid_cron_auth"`) when auth header is wrong.
