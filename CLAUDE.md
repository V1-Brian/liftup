# LiftUp — Claude Context

## Terminology
- **LiftUp** = the manufacturer / client (makes the products, pays us commission)
- **We / the service provider** = the company this app is built for (earns commissions as sales rep)
- Financial flow: LiftUp invoices us for retail sales → we invoice LiftUp for our commission → we pay LiftUp (retail − commission) → LiftUp pays us commission separately
- Always use "LiftUp" (not "manufacturer") in UI labels and documentation

## What this app is
Sales commission tracking app. Tracks monthly invoices, orders, SKU configs, and commission calculations across Shopify and Amazon channels. Manages the full billing cycle: Shopify sync → invoice generation → credit memos → payment tracking → email-driven automation. Also tracks real-time order shipments: new Shopify orders and UPS tracking numbers are captured from email and synced back to Shopify as fulfillments.

## Stack
- **Frontend**: React 18 + Vite, React Router v6. Lives in `frontend/`.
- **Backend**: Node.js + Express, PostgreSQL via `pg`. Lives in `backend/`.
- **Hosting**: Vercel (both frontend and backend as a monorepo)
- **Database**: Render PostgreSQL (free tier — verify upgrade status)

## Infrastructure

### GitHub
- Repo: https://github.com/V1-Brian/liftup
- Account: V1-Brian

### Vercel
- Project: `v1-ventures/liftup`
- Dashboard: https://vercel.com/v1-ventures/liftup
- Production alias: https://liftup-three.vercel.app
- All env vars set in Vercel (Production + Preview):
  `DATABASE_URL`, `NODE_ENV`, `SHOPIFY_STORE`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`,
  `CRON_SECRET`, `LIFTUP_EMAIL`, `OUR_EMAIL`,
  `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ACCOUNT_ID`, `ZOHO_REGION`,
  `ZOHO_INVOICE_FOLDER_ID`, `ZOHO_PAYMENT_FOLDER_ID`, `ZOHO_CREDIT_FOLDER_ID`,
  `ZOHO_AMAZON_RETURNS_FOLDER_ID`, `ZOHO_ORDERS_FOLDER_ID`, `ZOHO_SHIPMENTS_FOLDER_ID`
- **Also set** (blog module): `ANTHROPIC_API_KEY`, `SHOPIFY_BLOG_ID_HOME_CARE`, `SHOPIFY_BLOG_ID_PROFESSIONAL_CARE`, `SHOPIFY_BLOG_ID_BUYERSGUIDE`
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
  - `ZOHO_AMAZON_RETURNS_FOLDER_ID` = `7267523000000422018`
- **Note**: when setting env vars via CLI, always use `printf '...' | vercel env add` — never `echo` (adds a trailing newline that breaks Zoho token refresh)
- Deploy command: `vercel --prod` from repo root (Vercel CLI must be logged in to `v1-ventures` scope)
- If CLI loses project link: `vercel link --project liftup --scope v1-ventures --yes`

### Render (Database)
- Instance: `liftup-db` (PostgreSQL 16)
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

## Shopify API scopes
The Shopify custom app requires these Admin API scopes:
- `read_orders` — order lookup for sync and shipment matching
- `read_merchant_managed_fulfillment_orders` — fetch open fulfillment orders (required by new fulfillments API)
- `write_merchant_managed_fulfillment_orders` — create fulfillments with tracking
- `write_content` — blog post publishing

**Note**: `read_fulfillments` / `write_fulfillments` are for the deprecated legacy API and are NOT sufficient for the current fulfillment flow.

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

### Migration blog (migrate_blog.js — applied 2026-05-05)
New table:
- `blog_posts_log` — tracks weekly auto-generated blog posts; prevents topic repeats

### Migration v5 (migrate_v5.js — applied 2026-07-01)
New column on `orders`:
- `amazon_order_id VARCHAR(40)` — Amazon Order ID for MCF orders (e.g. `113-XXXXXXX-XXXXXXX`); populated automatically during Shopify sync from `order.note_attributes`; used to match Amazon "Refund Initiated" emails to orders. Only populated on orders synced/re-saved after this migration shipped — earlier invoices (March–May 2026) largely predate it and need a re-sync to backfill. As of 2026-07-10, `extractAmazonOrderId()` runs regardless of detected sales channel (previously gated behind `channel === 'Amazon'`, which would have silently skipped a Shopify-storefront order fulfilled via Amazon MCF).

**Auto-reconciliation**: both the invoice save (`POST /api/invoices/:month`) and Shopify sync (`POST /api/sync/:month`) run a reconciliation UPDATE after inserting orders. Any `pending_returns` rows with `status='unmatched'` whose `amazon_order_id` now matches a newly written order are automatically promoted to `status='pending'`. So re-syncing or re-saving the relevant month's invoice is sufficient to auto-link a previously unmatched return — no manual DB update needed.

### Migration v6 (migrate_v6.js — applied 2026-07-01)
New table:
- `pending_returns` — one row per Amazon refund notification email; `status`: `'pending'` (matched to order), `'unmatched'` (no order found), `'processed'` (user confirmed), `'dismissed'`; `disposition`: `'before'` or `'after'` set on process
- FKs use `ON DELETE SET NULL` — invoice save deletes+reinserts orders, so `order_id` becomes NULL on re-save (acceptable for processed returns)

### Migration v6b — credits source column (applied 2026-07-02, run manually in TablePlus)
New column on `credits`:
- `source VARCHAR(20) NOT NULL DEFAULT 'invoice_save'` — distinguishes credits created by invoice save UI (`'invoice_save'`) from credits created by the returns flow (`'return_processed'`). Invoice save only deletes `source='invoice_save'` credits, so return-processed credits survive re-saves.

SQL: `ALTER TABLE credits ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'invoice_save';`

### Migration v7 (migrate_v7.js — applied 2026-07-02)
New table:
- `shipments` — one row per Shopify order; tracks order_no, tracking_number, carrier, shipped_at, shopify_synced status; unique on order_no. Populated from email polling (Liftup Orders + Liftup Shipments Zoho folders). Completely independent from the invoicing tables — no FK to orders or invoices.

Run: `DATABASE_URL="..." node backend/migrate_v7.js`

### Migration v8 (migrate_v8.js — applied 2026-07-10)
New column on `credits`:
- `order_no VARCHAR(60)` — denormalized snapshot of the originating order's Shopify order number (like `sku_name`, not an FK — orders are deleted+reinserted on every invoice save, so an FK would go stale). Populated by both credit-creation paths (invoice save + returns flow); displayed on the Credits page so open/applied credits can be matched back to a specific order.

Run: `DATABASE_URL="..." node backend/migrate_v8.js`

---

## Email automation

### Architecture
Emails land in a **Zoho Mail** inbox. The system polls six dedicated Zoho folders every 4 hours via a Vercel cron (and on-demand via the "✉ Check emails" Dashboard button). No third-party webhook or MX record setup required.

### Zoho folders (all created and configured)
| Folder | Folder ID | Env var |
|--------|-----------|---------|
| Liftup Invoices | `7267523000000148012` | `ZOHO_INVOICE_FOLDER_ID` |
| Liftup Payment Confirmation | `7267523000000264033` | `ZOHO_PAYMENT_FOLDER_ID` |
| Liftup Credit Memo | `7267523000000318023` | `ZOHO_CREDIT_FOLDER_ID` |
| Amazon Returns | `7267523000000422018` | `ZOHO_AMAZON_RETURNS_FOLDER_ID` |
| Liftup Orders | (set in Vercel) | `ZOHO_ORDERS_FOLDER_ID` |
| Liftup Shipments | (set in Vercel) | `ZOHO_SHIPMENTS_FOLDER_ID` |

### Email sources
- **LiftUp invoices** — sent from QuickBooks (`@intuit.com` or `@quickbooks.com`). Subject varies: `"Invoice - April sales 4 Raizer M 1 Carry case"`, `"Invoice - March Sales"`, etc. Body contains `BALANCE DUE $X,XXX.00` but **no invoice number** — the invoice number is only in the PDF attachment filename (`INVOICE_XXXX.pdf`) or behind the tracking redirect link. The system extracts the billing month from the subject line (e.g., "April" → `2026-04`) and records the email total for reconciliation; `invoices.invoice_number` must be entered manually.
- **QB payment receipts** — also from QuickBooks. Subject: `"Payment receipt"` or similar. Contains amount paid, invoice number, payment date.
- **Bank transfer notifications** — from the bank. Subject contains "deposit", "transfer received", "ACH", or "wire". Contains amount and date; no invoice reference (requires manual allocation via the commission payment modal).
- **Amazon return notifications** — from Amazon (`@amazon.com`). Subject contains "refund" or "return" and includes Amazon Order ID (`XXX-XXXXXXX-XXXXXXX`). Creates a `pending_returns` row for user review. Matched to an order via `orders.amazon_order_id` (populated during Shopify sync — see note below). **Unlike the Orders/Shipments folders, this folder has no historical-cutoff filter** — the first-ever poll of this folder (2026-05-05) ingested Zoho's entire backlog as if every email were new, producing a burst of `pending_returns` rows that had already been resolved manually long before this feature existed (bulk-dismissed after the fact). Normal ongoing polling is unaffected.
- **Shopify new order notifications** — from Shopify (`@shopify.com`) or subject matches "new order #XXXX". Creates a `shipments` row with the order number.
- **UPS shipment notifications** — from UPS (`@ups.com`) or subject contains tracking number (`1Z...`). Extracts tracking number and "Reference Number 1" (LiftUp enters the Shopify order # here). Updates `shipments` row and creates a Shopify fulfillment to notify the customer. On first poll of the Liftup Shipments folder, emails received before 2026-07-02 are silently marked as processed without triggering Shopify updates.

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
| `GET /api/email/poll` | `0 */4 * * *` | Every 4 hours — poll all 6 Zoho folders for new inbound emails |
| `GET /api/cron/blog-post` | `0 10 * * 1` | Every Monday 10 AM UTC — generate + publish one SEO blog post to Shopify |

Both require `Authorization: Bearer <CRON_SECRET>` (sent automatically by Vercel). To trigger manually use `vercel curl /api/email/poll` or the Dashboard "✉ Check emails" button.

---

## Key files
- `backend/schema.sql` — initial DB schema + seed SKU data
- `backend/migrate_v2.sql` — v2 schema additions (payments, credits, unmatched_emails)
- `backend/commission.js` — `calcCommission(sku, price, channel) → {flat, mkt, amz, total}`
- `backend/shopify.js` — Shopify OAuth token exchange + paginated order fetch + channel detection + `updateShopifyTracking(store, token, orderName, trackingNumber)` (creates fulfillment via fulfillment_orders API)
- `backend/zoho-mail.js` — Zoho Mail API client: `fetchFolderMessages`, `fetchUnreadMessages`, `fetchMessageContent`, `markAsRead`, `sendEmail`, `uploadAttachment`; in-memory token cache
- `backend/email-parser.js` — parsers for all 6 email types: `parseLiftUpInvoiceEmail`, `parseQBPaymentEmail`, `parseBankTransferEmail`, `parseAmazonReturnEmail`, `parseShopifyOrderEmail`, `parseUPSShipmentEmail`; `detectEmailType`; `compareInvoices`
- `backend/report-generator.js` — `buildSalesReport` and `buildCommissionInvoice`; uses pdfkit + V1 Ventures logo from `backend/assets/logo.png`
- `backend/blog-generator.js` — `generateAndPublishBlogPost()`: picks next topic, calls Claude API, posts to Shopify Articles API, logs to `blog_posts_log`
- `backend/blog-topics.js` — ordered array of 40 SEO keyword topics (four content pillars)
- `frontend/src/lib/api.js` — all API calls
- `frontend/src/lib/utils.js` — `calcCommission`, `fmt`, `fmtMonth`, `STATUS_OPTIONS`, `parseShopifyCSV`
- `frontend/src/pages/` — Dashboard, InvoicePage, SkuPage, HistoryPage, CreditsPage, ShipmentsPage
- `frontend/src/components/RecordPaymentModal.jsx` — modal for recording LiftUp invoice payments and commission receipts
- `frontend/src/components/ProcessReturnModal.jsx` — modal for processing a pending return (before/after disposition; on "after" lets user toggle which credit type(s) — retail and/or commission — actually apply)

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
| POST | `/api/credits/:id/apply` | Manually apply an open credit to a chosen invoice month |
| GET | `/api/email/poll` | Poll all 6 Zoho folders for new emails (cron every 4h + manual) |
| GET | `/api/email/unmatched` | List unresolved unmatched emails |
| POST | `/api/email/unmatched/:id/resolve` | Mark unmatched email resolved |
| POST | `/api/email/unmatched/:id/reprocess` | Re-run the parser on a stored unmatched email (marks resolved on success) |
| GET | `/api/returns/pending` | List pending/unmatched returns with order + invoice details |
| POST | `/api/returns/:id/process` | Process a return: `{ disposition: 'before' \| 'after', credit_types?: ['retail'\|'commission', ...] }` — updates order status, generates credits for 'after' (defaults to both types; pass a subset when only one side actually applies), recalculates invoice totals |
| POST | `/api/returns/:id/dismiss` | Dismiss a return without action |
| GET | `/api/shipments` | List all shipments ordered by created_at DESC |
| POST | `/api/shipments/:id/retry-sync` | Retry Shopify fulfillment sync for a failed shipment |

---

## ⚙️ Known issues / pending work

### Zoho attachment upload (PDF reports)
Outbound emails currently send HTML body only. Attaching PDFs fails with "0 bytes" from Zoho's attachment pre-upload endpoint when using Node.js native `fetch` + `FormData`. The `fileName` query-parameter workaround resolves the filename issue but not the content. PDF generation itself works (pdfkit, ~3–10 KB). Needs further investigation — likely requires switching to a manual multipart body or `node-fetch`/`form-data` npm package.

### Frontend — invoice mismatch display
`invoices.mismatch_notes` is stored in the DB when a LiftUp invoice email is parsed, but no UI yet shows it on the invoice Status tab. Should display as a warning card when non-null.

### Blog module
Live as of 2026-05-05. Runs every Monday at 10 AM UTC.

---

## Order status values
| Value | Label | Effect on totals |
|-------|-------|-----------------|
| `sold` | Sold | Counts toward retail + commission |
| `before` | Returned (before invoice) | Excluded from all totals — case-by-case |
| `after` | Returned (credit memo needed) | Counts toward `total_credit`; auto-generates 2 credit rows on save |
| `warranty` | Warranty replacement | Excluded from all totals |
| `rental` | Rental charge | Excluded from all totals |

## Credit auto-generation
Two paths create credits:

**1. Invoice save UI** (`source='invoice_save'`): when an order is manually set to `status='after'` in the invoice editor and the invoice is saved, two credits are created (retail + commission). These are deleted and recreated on each re-save as long as the order remains `after`.

**2. Returns flow** (`source='return_processed'`): when a pending return is processed with `disposition='after'` via `POST /api/returns/:id/process`, credits are created without changing the order's status or invoice totals (invoice was already sent). By default both a retail and a commission credit are created; `ProcessReturnModal` lets the user uncheck one side — e.g. when LiftUp invoiced us for the sale but we never invoiced LiftUp commission on it, only the retail credit applies. These credits survive subsequent invoice re-saves.

Credits start as `status='open'`. They can be:
- **Auto-applied**: when a later-month invoice is saved, all open credits from prior months are automatically inserted as negative adjustment lines and marked `status='applied'`
- **Manually applied**: via the Credits page "Apply to invoice →" button, which calls `POST /api/credits/:id/apply`

---

## ✅ Test cases to verify after deployment

### Feature 1 — LiftUp invoice email → amount reconciliation
1. Ensure a LiftUp QB invoice email lands in the invoices Zoho folder
2. Trigger poll; confirm `invoices.email_invoice_total` is updated on the matching month; `invoice_number` is NOT auto-populated (QB emails don't contain it — enter manually)
3. If parsed total differs from `total_retail`: confirm a mismatch note is recorded in `mismatch_notes`
4. Test with an email where billing month cannot be determined → confirm row in `unmatched_emails`
5. To replay a stored unmatched email after a parser fix: `POST /api/email/unmatched/:id/reprocess`

### Feature 2a — QB payment receipt email → record payment to LiftUp
1. Trigger poll; confirm `payments` row created with `source='email'`, correct `amount`, `reference`, `payment_date`
2. Confirm `payment_allocations` row created if invoice number matched
3. Confirm `invoices.mfr_amount_paid` updated; `mfr_invoice_paid=true` if amount ≥ net owed

### Feature 2b — Bank transfer email → commission receipt + manual allocation
1. Trigger poll; confirm `payments` row created with `payment_type='commission'`, `source='email'`, no allocations yet
2. Open modal, allocate across invoices → confirm `commission_amount_received` updated

### Feature 3 — Shipments + Shopify tracking sync
1. New Shopify order email arrives in Liftup Orders folder → `shipments` row created with order_no
2. UPS tracking email arrives in Liftup Shipments folder with matching Reference Number 1 → tracking_number populated, Shopify fulfillment created, customer notified
3. If sync fails: `shopify_sync_error` populated; "↺ Retry" button appears on Shipments page
4. After fixing permissions: retry button clears error and sets `shopify_synced=true`

### Feature 4 — Amazon returns flow
1. Amazon refund email → `pending_returns` row created; Dashboard shows "Pending Returns" section
2. Process with `disposition='after'` (both checkboxes checked) → 2 open credits created (`source='return_processed'`), each with `order_no` populated; order status and invoice totals unchanged
3. Process with only one checkbox checked (e.g. retail only, when we never invoiced LiftUp commission on that order) → only 1 open credit created
4. Re-save the source invoice → credits survive (not deleted by invoice save)
5. Navigate to Credits page → order # column matches the source order; apply credits to a future invoice manually

### Regression checks
- Existing invoice save/load works unchanged
- Shopify sync completes without touching credits or payments
- SKU page and History page load without errors
- `PATCH /api/invoices/:month/status` still works for manual overrides
