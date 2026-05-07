# LiftUp — Claude Context

## Terminology
- **LiftUp** = the manufacturer / client (makes the products, pays us commission)
- **We / the service provider** = the company this app is built for (earns commissions as sales rep)
- Financial flow: LiftUp invoices us for retail sales → we invoice LiftUp for our commission → we pay LiftUp (retail − commission) → LiftUp pays us commission separately
- Always use "LiftUp" (not "manufacturer") in UI labels and documentation

## What this app is
Sales commission tracking app. Tracks monthly invoices, orders, SKU configs, and commission calculations across Shopify and Amazon channels. Manages the full billing cycle: Shopify sync → invoice generation → credit memos → payment tracking → email-driven automation.

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
- Latest production URL: https://liftup-cj5b84t40-tfows-projects.vercel.app
- All env vars set in Vercel (Production + Preview):
  `DATABASE_URL`, `NODE_ENV`, `SHOPIFY_STORE`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`,
  `CRON_SECRET`, `LIFTUP_EMAIL`, `OUR_EMAIL`,
  `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ACCOUNT_ID`, `ZOHO_REGION`,
  `ZOHO_INVOICE_FOLDER_ID`, `ZOHO_PAYMENT_FOLDER_ID`, `ZOHO_CREDIT_FOLDER_ID`
- **Still needed** (blog module): `ANTHROPIC_API_KEY`, `SHOPIFY_BLOG_ID`
- Known values for reference:
  - `LIFTUP_EMAIL` = `cyo@liftup.us`
  - `OUR_EMAIL` = `info@rizeup.care` (Zoho sender; also CCed on all outbound reports)
  - `ZOHO_CLIENT_ID` = `1000.J3YLNWJX3B3X3O359GNNDYI2ZWU7NX`
  - `ZOHO_CLIENT_SECRET` = `e22f7f89ea5980f797d2e86543c082841804ff18f1`
  - `ZOHO_REFRESH_TOKEN` = `1000.1211d3194ec70a33e04e5a445cff1ffe.84b93dd1aa9b59840f7df6416d4bf1b0`
  - `ZOHO_ACCOUNT_ID` = `7267523000000008002`
  - `ZOHO_REGION` = `com`
  - `ZOHO_INVOICE_FOLDER_ID` = `7267523000000148012`
  - `ZOHO_PAYMENT_FOLDER_ID` = `7267523000000264033`
  - `ZOHO_CREDIT_FOLDER_ID` = `7267523000000318023`
- **Note**: when setting env vars via CLI, always use `printf '...' | vercel env add` — never `echo` (adds a trailing newline that breaks Zoho token refresh)
- Deploy command: `vercel --prod` from repo root (Vercel CLI must be logged in)

### Render (Database)
- Instance: `liftup-db` (PostgreSQL 16, free tier)
- Dashboard: https://dashboard.render.com/d/dpg-d7f908n7f7vs739rfh30-a
- External connection string:
  `postgresql://liftup_user:g0z2pq31zdbRrJTkfnAHTCdfCJ7JSmNN@dpg-d7f908n7f7vs739rfh30-a.oregon-postgres.render.com:5432/liftup_31bl`
- API key for Render: `rnd_vnnVng4enQhOvIugY8647CtgVAAf`

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
cp .env.example .env   # fill in DATABASE_URL + Zoho vars once obtained
npm run dev            # runs on :3001

# Frontend
cd frontend && npm install
npm run dev            # runs on :5173, proxies /api to :3001
```

---

## Database schema

### Initial schema (schema.sql — already applied)
- `sku_config` — 11 seeded SKUs, commission rates per channel
- `invoices` — one row per month, totals + payment status booleans
- `orders` — line items per invoice with comm_flat/mkt/amz/total
- `adjustments` — manual line item adjustments per invoice

### Migration v2 (migrate_v2.sql — applied 2026-04-27)
New columns on `invoices`:
- `mfr_amount_paid NUMERIC(12,2)` — cumulative amount paid to LiftUp
- `commission_amount_received NUMERIC(12,2)` — cumulative commission received from LiftUp

New tables:
- `payments` — records a payment event; `payment_type`: `'liftup_invoice'` (we pay LiftUp) or `'commission'` (LiftUp pays us); `source`: `'manual'` or `'email'`
- `payment_allocations` — links a payment to one or more invoices with the amount applied to each
- `credits` — auto-generated when an order has status `'after'`; `credit_type`: `'retail'` (reduces what we owe LiftUp) or `'commission'` (reduces what LiftUp owes us); `status`: `'open'` or `'applied'`
- `unmatched_emails` — inbound emails that could not be auto-matched; surfaced on Dashboard as a warning badge

### Migration v3 (migrate_v3.sql — applied 2026-04-29)
New columns on `invoices`:
- `email_invoice_total NUMERIC(12,2)` — total parsed from LiftUp's incoming invoice email
- `email_line_items JSONB` — parsed line items array from their invoice email
- `mismatch_notes TEXT` — human-readable discrepancy notes; null = no issues found

### Migration v4 (migrate_v4.sql — applied 2026-05-05)
New table:
- `processed_emails` — tracks message IDs already processed by the poll; prevents reprocessing when emails are re-read or folder-fetched without unread filter

Run: `DATABASE_URL="..." node migrate_v4.js`

### Migration blog (migrate_blog.js — **NOT YET RUN**)
New table:
- `blog_posts_log` — tracks weekly auto-generated blog posts; prevents topic repeats

Run: `DATABASE_URL="..." node backend/migrate_blog.js`

---

## Email automation

### Architecture
Emails land in a **Zoho Mail** inbox. The system polls two dedicated Zoho folders every 4 hours via a Vercel cron (and on-demand via the "✉ Check emails" Dashboard button). No third-party webhook or MX record setup required.

### Two dedicated Zoho folders (already created by user)
| Folder | Folder ID | Env var |
|--------|-----------|---------|
| Liftup Invoices | `7267523000000148012` | `ZOHO_INVOICE_FOLDER_ID` |
| Liftup Payment Confirmation | `7267523000000264033` | `ZOHO_PAYMENT_FOLDER_ID` |
| Liftup Credit Memo | `7267523000000318023` | `ZOHO_CREDIT_FOLDER_ID` |
| Amazon Returns | `7267523000000422018` | (not yet wired up) |

### Email sources
- **LiftUp invoices** — sent from QuickBooks (`@intuit.com` or `@quickbooks.com`). Subject varies: `"Invoice - April sales 4 Raizer M 1 Carry case"`, `"Invoice - March Sales"`, etc. Body contains `BALANCE DUE $X,XXX.00` but **no invoice number** — the invoice number is only in the PDF attachment filename (`INVOICE_XXXX.pdf`) or behind the tracking redirect link. The system extracts the billing month from the subject line (e.g., "April" → `2026-04`) and records the email total for reconciliation; `invoices.invoice_number` must be entered manually.
- **QB payment receipts** — also from QuickBooks. Subject: `"Payment receipt"` or similar. Contains amount paid, invoice number, payment date.
- **Bank transfer notifications** — from the bank. Subject contains "deposit", "transfer received", "ACH", or "wire". Contains amount and date; no invoice reference (requires manual allocation via the commission payment modal).

### Invoice mismatch detection
When a LiftUp invoice email is received, the system compares against our records:
- **Total amount** — their parsed `BALANCE DUE` total vs. our `total_retail`
- **Per-SKU line items** — only checked when their email contains a parseable HTML table; QB invoice emails typically do not, so only the total is compared
- **Shipping** — they break out shipping as a separate line; we include it in our total; noted but not flagged as an error

Results are stored in `invoices.mismatch_notes` (newline-separated strings; null = clean).
The `email_invoice_total` column is always updated; mismatches are flagged for review, not blocked.

**Frontend display** (pending): show mismatch_notes as a warning card on the invoice Status tab when non-null.

### Cron schedule
| Path | Schedule | Purpose |
|------|----------|---------|
| `GET /api/cron/monthly-sync` | `0 8 1 * *` | 1st of month, 8 AM UTC — sync Shopify → send sales report + commission invoice to LiftUp (CC `OUR_EMAIL`) |
| `GET /api/email/poll` | `0 */4 * * *` | Every 4 hours — poll Zoho folders for new inbound emails |
| `GET /api/cron/blog-post` | `0 10 * * 1` | Every Monday 10 AM UTC — generate + publish one SEO blog post to Shopify |

Both require `Authorization: Bearer <CRON_SECRET>` (sent automatically by Vercel). To trigger manually use `vercel curl /api/email/poll` or run a local script.

---

## Key files
- `backend/schema.sql` — initial DB schema + seed SKU data
- `backend/migrate_v2.sql` — v2 schema additions (payments, credits, unmatched_emails)
- `backend/commission.js` — `calcCommission(sku, price, channel) → {flat, mkt, amz, total}`
- `backend/shopify.js` — Shopify OAuth token exchange + paginated order fetch + channel detection
- `backend/zoho-mail.js` — Zoho Mail API client: `fetchFolderMessages` (uses `/messages/view?folderId=X` — the only working folder-fetch endpoint in this env), `fetchUnreadMessages`, `fetchMessageContent`, `markAsRead`, `sendEmail`, `uploadAttachment`; in-memory token cache; requires ZOHO_* + OUR_EMAIL env vars
- `backend/email-parser.js` — `parseLiftUpInvoiceEmail(text, html, subject)` (extracts billing_month from subject when absent from body; invoice_number may be null since QB emails don't embed it), `parseQBPaymentEmail`, `parseBankTransferEmail`, `detectEmailType`, `compareInvoices` (total-level check; line-item check skipped when no parsed line items)
- `backend/report-generator.js` — `buildSalesReport` and `buildCommissionInvoice`; each returns `{ subject, html, pdfBuffer, filename }`; uses pdfkit + V1 Ventures logo from `backend/assets/logo.png`
- `backend/assets/logo.png` — V1 Ventures logo; used in PDF report headers
- `backend/blog-generator.js` — `generateAndPublishBlogPost()`: picks next topic from `blog-topics.js`, calls Claude API, posts to Shopify Articles API, logs to `blog_posts_log`
- `backend/blog-topics.js` — ordered array of 40 SEO keyword topics (four content pillars)
- `backend/migrate_blog.js` — creates `blog_posts_log` table (**not yet run against Render DB**)
- `frontend/src/lib/api.js` — all API calls
- `frontend/src/lib/utils.js` — `calcCommission`, `fmt`, `fmtMonth`, `STATUS_OPTIONS`, `parseShopifyCSV`
- `frontend/src/pages/` — Dashboard, InvoicePage, SkuPage, HistoryPage, CreditsPage
- `frontend/src/components/RecordPaymentModal.jsx` — modal for recording LiftUp invoice payments and commission receipts

## API endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check |
| GET | `/api/skus` | List active SKUs |
| POST | `/api/skus` | Create SKU |
| PUT | `/api/skus/:id` | Update SKU |
| DELETE | `/api/skus/:id` | Soft-delete SKU |
| GET | `/api/invoices` | List all invoices |
| GET | `/api/invoices/:month` | Get invoice + orders + adjustments |
| POST | `/api/invoices/:month` | Save/upsert invoice (also generates credits, auto-applies open credits) |
| PATCH | `/api/invoices/:month/status` | Quick status field patch |
| DELETE | `/api/invoices/:month` | Delete invoice |
| GET | `/api/invoices/payment-status` | All invoices with net_owed_to_liftup, used by allocation modal |
| POST | `/api/sync/:month` | Manual Shopify sync |
| GET | `/api/cron/monthly-sync` | Vercel cron — runs 1st of month at 08:00 UTC |
| GET | `/api/cron/blog-post` | Vercel cron — runs every Monday at 10:00 UTC; generates + publishes one blog post |
| GET | `/api/payments` | List payments (optional `?type=commission`) |
| POST | `/api/payments` | Record/allocate a payment |
| GET | `/api/credits` | Returns `{ open: [...], applied: [...] }` |
| GET | `/api/email/poll` | Poll both Zoho folders for new emails (cron every 4h + manual; requires `?token=CRON_SECRET`) |
| GET | `/api/email/unmatched` | List unresolved unmatched emails |
| POST | `/api/email/unmatched/:id/resolve` | Mark unmatched email resolved |
| POST | `/api/email/unmatched/:id/reprocess` | Re-run the parser on a stored unmatched email (marks resolved on success) |

---

## ⚙️ Known issues / pending work

### Zoho attachment upload (PDF reports)
Outbound emails currently send HTML body only. Attaching PDFs fails with "0 bytes" from Zoho's attachment pre-upload endpoint when using Node.js native `fetch` + `FormData`. The `fileName` query-parameter workaround resolves the filename issue but not the content. PDF generation itself works (pdfkit, ~3–10 KB). Needs further investigation — likely requires switching to a manual multipart body or `node-fetch`/`form-data` npm package.

### Frontend — invoice mismatch display
`invoices.mismatch_notes` is stored in the DB when a LiftUp invoice email is parsed, but no UI yet shows it on the invoice Status tab. Should display as a warning card when non-null.

### Blog module — setup incomplete
The blog cron is deployed but not yet live. Before it can run:
1. Add `ANTHROPIC_API_KEY` and `SHOPIFY_BLOG_ID` to Vercel env vars
2. Add `write_content` scope to the Shopify custom app (Settings → Apps → Develop apps)
3. Run `DATABASE_URL="..." node backend/migrate_blog.js` to create `blog_posts_log` table
4. Trigger once manually to verify: `vercel curl /api/cron/blog-post`

### Render DB free tier expiry
Upgrade `liftup-db` on Render before **2026-05-14** to avoid downtime.

---

## Order status values
| Value | Label | Effect on totals |
|-------|-------|-----------------|
| `sold` | Sold | Counts toward retail + commission |
| `before` | Returned (before invoice) | Excluded from all totals — case-by-case |
| `after` | Returned (credit memo needed) | Counts toward `total_credit`; auto-generates 2 credit rows on save |
| `warranty` | Warranty replacement | Excluded from all totals |
| `rental` | Rental charge | Excluded from all totals |

## Credit auto-generation (status = 'after')
When an invoice is saved with any `after` orders, two credit rows are auto-generated per order:
1. **Retail credit** (`credit_type='retail'`) — amount = `sale_price × qty`. Reduces what we owe LiftUp.
2. **Commission credit** (`credit_type='commission'`) — amount = `comm_total × qty`. Reduces what LiftUp owes us.

Credits start as `status='open'`. When a subsequent invoice is saved, all open credits from prior months are automatically inserted as negative adjustment lines (`adj_type='credit'`) and marked `status='applied'`.

---

## ✅ Test cases to verify after deployment

### Feature 1 — LiftUp invoice email → amount reconciliation
1. Ensure a LiftUp QB invoice email lands in the invoices Zoho folder
2. Trigger poll (`GET /api/email/poll?token=...`); confirm `invoices.email_invoice_total` is updated on the matching month; `invoice_number` is NOT auto-populated (QB emails don't contain it — enter manually)
3. If parsed total differs from `total_retail`: confirm a mismatch note is recorded in `mismatch_notes`
4. Test with an email where billing month cannot be determined → confirm row in `unmatched_emails`
5. Test with a billing month that has no invoice in the system → confirm `unmatched_emails` row with `reason='no_matching_invoice'`
6. To replay a stored unmatched email after a parser fix: `POST /api/email/unmatched/:id/reprocess`

### Feature 2a — QB payment receipt email → record payment to LiftUp
1. Ensure a QB payment receipt lands in the payment confirmations Zoho folder
2. Trigger poll; confirm `payments` row created with `source='email'`, correct `amount`, `reference`, `payment_date`
3. Confirm `payment_allocations` row created if invoice number matched
4. Confirm `invoices.mfr_amount_paid` updated; `mfr_invoice_paid=true` if amount ≥ net owed
5. Test partial payment → `mfr_invoice_paid` stays `false`; Status tab progress bar shows < 100%
6. Test duplicate email processed twice → `mfr_amount_paid` must not double-count

### Feature 2b — Bank transfer email → commission receipt + manual allocation
1. Ensure a bank deposit notification email lands in the payment confirmations folder
2. Trigger poll; confirm `payments` row created with `payment_type='commission'`, `source='email'`, no allocations yet
3. Dashboard badge on "Record commission received" button reflects the unallocated payment
4. Open modal, allocate across two invoices with partial amounts → submit
5. Confirm both invoices have `commission_amount_received` updated; fully-covered invoice has `commission_paid=true`
6. Test allocation where amounts exceed payment total → form blocks submission

### Feature 3 — Auto-generate credit memos
1. Open an invoice, change an order status to `after`, save
2. Query DB: `SELECT * FROM credits WHERE source_invoice_id = <id>` — expect 2 rows (retail + commission), `status='open'`
3. Re-save without changing orders → verify no duplicates
4. Change order back to `sold`, re-save → verify open credits deleted
5. After a credit is applied (Feature 4), re-save source invoice → applied credits must NOT be deleted

### Feature 4 — Credits page + auto-apply to next invoice
1. Navigate to `/credits` — open credits from Feature 3 appear
2. Open a later-month invoice and save it
3. Confirm: adjustment rows labelled `"Credit memo - {sku_name} (from YYYY-MM)"` appear in Review tab; info banner shows count; credits in DB are `status='applied'`
4. Navigate back to `/credits` → applied credits section shows them; "Applied to" link navigates to correct invoice
5. Delete an auto-applied adjustment, re-save → credit is NOT re-applied (already `status='applied'`)

### Regression checks
- Existing invoice save/load works unchanged
- Shopify sync completes without touching credits or payments
- SKU page and History page load without errors
- `PATCH /api/invoices/:month/status` still works for manual overrides
- Print view hides `.no-print` sections correctly
