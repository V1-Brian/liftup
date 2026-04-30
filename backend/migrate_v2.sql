-- LiftUp Invoice Tracker — Migration v2
-- Features: Payments, Credits, Email Inbound
-- Run once: DATABASE_URL=... node backend/migrate_v2.js

-- ── New columns on invoices ──────────────────────────────────────────────────
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS mfr_amount_paid           NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_amount_received NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ── payments ─────────────────────────────────────────────────────────────────
-- payment_type:
--   'liftup_invoice' — we pay LiftUp (detected via QB receipt email)
--   'commission'     — LiftUp pays us (detected via bank notification email or manual)
CREATE TABLE IF NOT EXISTS payments (
  id             SERIAL        PRIMARY KEY,
  payment_type   VARCHAR(20)   NOT NULL,
  payment_date   DATE          NOT NULL,
  amount         NUMERIC(12,2) NOT NULL,
  reference      VARCHAR(120),
  notes          TEXT,
  source         VARCHAR(20)   NOT NULL DEFAULT 'manual',  -- 'manual' | 'email'
  raw_email_text TEXT,
  created_at     TIMESTAMPTZ   DEFAULT NOW()
);

-- ── payment_allocations ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_allocations (
  id         SERIAL        PRIMARY KEY,
  payment_id INTEGER       NOT NULL REFERENCES payments(id)  ON DELETE CASCADE,
  invoice_id INTEGER       NOT NULL REFERENCES invoices(id)  ON DELETE CASCADE,
  amount     NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ   DEFAULT NOW(),
  UNIQUE (payment_id, invoice_id)
);

-- ── credits ───────────────────────────────────────────────────────────────────
-- credit_type:
--   'retail'     — LiftUp owes us less retail (return reduces what we owe LiftUp)
--   'commission' — We owe LiftUp less commission (return reduces what LiftUp owes us)
-- status: 'open' | 'applied'
CREATE TABLE IF NOT EXISTS credits (
  id                   SERIAL        PRIMARY KEY,
  source_invoice_id    INTEGER       NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  source_order_id      INTEGER                REFERENCES orders(id)   ON DELETE SET NULL,
  credit_type          VARCHAR(20)   NOT NULL,
  sku                  VARCHAR(60)   NOT NULL,
  sku_name             VARCHAR(120),
  amount               NUMERIC(12,2) NOT NULL,
  source_month         VARCHAR(7)    NOT NULL,
  status               VARCHAR(20)   NOT NULL DEFAULT 'open',
  receiving_invoice_id INTEGER                REFERENCES invoices(id) ON DELETE SET NULL,
  applied_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ   DEFAULT NOW()
);

-- ── unmatched_emails ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unmatched_emails (
  id          SERIAL      PRIMARY KEY,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  subject     TEXT,
  from_addr   VARCHAR(255),
  text_body   TEXT,
  reason      VARCHAR(120),
  resolved    BOOLEAN     NOT NULL DEFAULT FALSE
);

-- ── indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment  ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice  ON payment_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_credits_source_invoice       ON credits(source_invoice_id);
CREATE INDEX IF NOT EXISTS idx_credits_receiving_invoice    ON credits(receiving_invoice_id);
CREATE INDEX IF NOT EXISTS idx_credits_status               ON credits(status);
CREATE INDEX IF NOT EXISTS idx_unmatched_emails_resolved    ON unmatched_emails(resolved);
