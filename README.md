# Liftup Invoice Tracker

Full-stack invoicing app. Backend on Render (Node + PostgreSQL), frontend on Vercel (React).

---

## Project structure

```
liftup/
├── backend/          ← Express API (deploy to Render)
│   ├── index.js
│   ├── schema.sql
│   ├── commission.js
│   ├── migrate.js
│   └── package.json
└── frontend/         ← React app (deploy to Vercel)
    ├── src/
    │   ├── App.jsx
    │   ├── pages/
    │   └── lib/
    └── package.json
```

---

## Step 1 — Push to GitHub

Create a new repo (e.g. `liftup-invoice`) and push this whole folder.

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOU/liftup-invoice.git
git push -u origin main
```

---

## Step 2 — Set up Render (backend + database)

### 2a. Create PostgreSQL database
1. Go to https://render.com → New → PostgreSQL
2. Name: `liftup-db`, Plan: Free
3. After creation, copy the **Internal Database URL**

### 2b. Run the schema migration
From your local machine (once):
```bash
cd backend
npm install
DATABASE_URL="<your-render-db-url>" node migrate.js
```

### 2c. Deploy the API
1. Render → New → Web Service → connect your GitHub repo
2. **Root directory:** `backend`
3. **Build command:** `npm install`
4. **Start command:** `npm start`
5. **Environment variables:**
   - `DATABASE_URL` = your Render internal DB URL
   - `FRONTEND_URL` = https://your-app.vercel.app  ← fill in after Vercel deploy
   - `NODE_ENV` = `production`
6. Deploy. Copy the Render service URL (e.g. `https://liftup-api.onrender.com`)

---

## Step 3 — Deploy frontend to Vercel

1. Go to https://vercel.com → New Project → import your GitHub repo
2. **Root directory:** `frontend`
3. **Framework preset:** Vite
4. **Environment variables:**
   - `VITE_API_URL` = `https://liftup-api.onrender.com`  ← your Render URL
5. Deploy.

---

## Step 4 — Update CORS

Go back to Render → your API service → Environment:
- Set `FRONTEND_URL` = your Vercel URL (e.g. `https://liftup-invoice.vercel.app`)
- Redeploy (or it auto-redeploys)

---

## Local development

**Backend:**
```bash
cd backend
cp .env.example .env   # fill in DATABASE_URL
npm install
npm run dev            # runs on :3001
```

**Frontend:**
```bash
cd frontend
cp .env.example .env   # VITE_API_URL=http://localhost:3001 for local
npm install
npm run dev            # runs on :5173, proxies /api to :3001
```

---

## Features

- Import Shopify CSV exports (auto-detects Amazon vs Shopify orders)
- Commission auto-calculation: flat $ + marketing (flat or %) + Amazon 15% fee
- Returns handling: before-invoice (note only) vs after-invoice (credit memo)
- Manual adjustments (shipping, tax credits, etc.)
- Invoice status tracking: verified, manufacturer paid, commission received
- Full invoice history with filtering
- SKU config management — price/commission changes preserved per invoice
- Print-ready invoice view
