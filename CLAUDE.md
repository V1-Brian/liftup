# LiftUp — Claude Context

## What this app is
Sales commission tracking app for LiftUp. Tracks monthly invoices, orders, SKU configs, and commission calculations across Shopify and Amazon channels.

## Stack
- **Frontend**: React 18 + Vite, React Router v6. Lives in `frontend/`.
- **Backend**: Node.js + Express, PostgreSQL via `pg`. Lives in `backend/`.
- **Hosting**: Vercel (both frontend and backend as a monorepo)
- **Database**: Render PostgreSQL (free tier, expires 2026-05-14 — upgrade before then)

## Infrastructure

### GitHub
- Repo: https://github.com/V1-Brian/liftup
- Account: V1-Brian

### Vercel
- Project: `tfows-projects/liftup`
- Dashboard: https://vercel.com/tfows-projects/liftup
- Latest production URL: https://liftup-e7vw48uhv-tfows-projects.vercel.app
- Env vars set: `DATABASE_URL`, `NODE_ENV=production`
- Deploy command: `vercel --prod` from repo root (Vercel CLI must be logged in)

### Render (Database)
- Instance: `liftup-db` (PostgreSQL 16, free tier)
- Dashboard: https://dashboard.render.com/d/dpg-d7f908n7f7vs739rfh30-a
- External connection string:
  `postgresql://liftup_user:g0z2pq31zdbRrJTkfnAHTCdfCJ7JSmNN@dpg-d7f908n7f7vs739rfh30-a.oregon-postgres.render.com:5432/liftup_31bl`
- API key for Render: `rnd_vnnVng4enQhOvIugY8647CtgVAAf`

## ⚠️ Outstanding task — DB migration not yet run
The database schema has NOT been applied yet. Port 5432 was blocked on the original machine.

Run this once from any machine with open outbound access:
```bash
cd backend
DATABASE_URL="postgresql://liftup_user:g0z2pq31zdbRrJTkfnAHTCdfCJ7JSmNN@dpg-d7f908n7f7vs739rfh30-a.oregon-postgres.render.com:5432/liftup_31bl" node migrate.js
```
Or connect via TablePlus / psql using the connection string above (SSL required) and run `backend/schema.sql` manually.

Once done, verify with: `SELECT * FROM sku_config;` — should return 11 seed rows.

## Vercel deployment architecture
- `vercel.json` at root builds the Vite frontend and routes all `/api/*` and `/health` requests to `api/index.js` as a serverless function
- `api/index.js` is a thin wrapper: `module.exports = require('../backend/index')`
- `backend/index.js` exports the Express app and only calls `app.listen()` when run directly (local dev)
- Root `package.json` holds the backend dependencies so Vercel can resolve them for the serverless function
- Frontend uses relative API URLs (`VITE_API_URL` defaults to `''`), so no env var needed on Vercel for the frontend

## Local dev
```bash
# Backend
cd backend && npm install
cp .env.example .env   # fill in DATABASE_URL
npm run dev            # runs on :3001

# Frontend
cd frontend && npm install
cp .env.example .env   # VITE_API_URL can be left empty (proxied via vite.config.js)
npm run dev            # runs on :5173, proxies /api to :3001
```

## Key files
- `backend/schema.sql` — full DB schema + seed SKU data (run once)
- `backend/commission.js` — commission calculation logic
- `frontend/src/lib/api.js` — all API calls
- `frontend/src/pages/` — Dashboard, InvoicePage, SkuPage, HistoryPage
