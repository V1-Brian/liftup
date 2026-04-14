-- Liftup Invoice Tracker — PostgreSQL Schema
-- Run once against your Render PostgreSQL database

CREATE TABLE IF NOT EXISTS sku_config (
  id             SERIAL PRIMARY KEY,
  sku            VARCHAR(60)   UNIQUE NOT NULL,
  name           VARCHAR(120)  NOT NULL,
  shopify_price  NUMERIC(10,2) NOT NULL DEFAULT 0,
  amazon_price   NUMERIC(10,2) NOT NULL DEFAULT 0,
  flat_comm      NUMERIC(10,2) NOT NULL DEFAULT 0,
  mkt_type       VARCHAR(10)   NOT NULL DEFAULT 'pct',  -- 'flat' | 'pct'
  mkt_value      NUMERIC(10,2) NOT NULL DEFAULT 7,
  amazon_fee_pct NUMERIC(5,2)  NOT NULL DEFAULT 15,
  active         BOOLEAN       NOT NULL DEFAULT TRUE,
  updated_at     TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id                    SERIAL PRIMARY KEY,
  month                 VARCHAR(7)    UNIQUE NOT NULL,  -- 'YYYY-MM'
  invoice_number        VARCHAR(60),
  total_retail          NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_commission      NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_credit          NUMERIC(12,2) NOT NULL DEFAULT 0,
  verified              BOOLEAN       NOT NULL DEFAULT FALSE,
  verified_date         DATE,
  mfr_invoice_paid      BOOLEAN       NOT NULL DEFAULT FALSE,
  mfr_invoice_paid_date DATE,
  commission_paid       BOOLEAN       NOT NULL DEFAULT FALSE,
  commission_paid_date  DATE,
  notes                 TEXT,
  created_at            TIMESTAMPTZ   DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id          SERIAL  PRIMARY KEY,
  invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  order_no    VARCHAR(40),
  order_date  DATE,
  sku         VARCHAR(60)   NOT NULL,
  qty         INTEGER       NOT NULL DEFAULT 1,
  channel     VARCHAR(20)   NOT NULL DEFAULT 'Shopify',
  sale_price  NUMERIC(10,2) NOT NULL DEFAULT 0,
  status      VARCHAR(30)   NOT NULL DEFAULT 'sold',
  note        TEXT,
  comm_flat   NUMERIC(10,2) NOT NULL DEFAULT 0,
  comm_mkt    NUMERIC(10,2) NOT NULL DEFAULT 0,
  comm_amz    NUMERIC(10,2) NOT NULL DEFAULT 0,
  comm_total  NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS adjustments (
  id          SERIAL  PRIMARY KEY,
  invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  label       VARCHAR(120)  NOT NULL,
  amount      NUMERIC(10,2) NOT NULL,
  adj_type    VARCHAR(20)   NOT NULL DEFAULT 'other',
  created_at  TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_invoice      ON orders(invoice_id);
CREATE INDEX IF NOT EXISTS idx_orders_sku          ON orders(sku);
CREATE INDEX IF NOT EXISTS idx_adjustments_invoice ON adjustments(invoice_id);

-- Seed SKU config from Sell Price 2026
INSERT INTO sku_config (sku, name, shopify_price, amazon_price, flat_comm, mkt_type, mkt_value, amazon_fee_pct) VALUES
  ('RU-RZR-M-HR',     'Raizer M',                1595.00, 1905.00, 250.00, 'flat', 150.00, 15),
  ('RU-RXR-CARYCASE', 'Raizer M Carry Case',      174.00,  214.00,  20.00, 'pct',    7.00, 15),
  ('RU-RZR-SEATCVR',  'Raizer M Seat Cover',      105.00,  142.00,  15.00, 'pct',    7.00, 15),
  ('RU-RZR-TROLLEY',  'Raizer M Trolley',         289.00,  350.00,  50.00, 'pct',    7.00, 15),
  ('RU-RZR-HEADREST', 'Raizer M Headrest',        174.00,  213.00,  30.00, 'pct',    7.00, 15),
  ('RU-RZR-CRNKHNDL', 'Raizer M Crank Handle',    125.00,  145.00,  10.00, 'pct',    7.00, 15),
  ('RU-RZR-SFTYBLT',  'Raizer Safety Belt',         0.00,   51.00,  10.00, 'pct',    7.00, 15),
  ('RU-RZR-WLLBRKT',  'Raizer M Wall Bracket',    126.00,  147.00,  15.00, 'pct',    7.00, 15),
  ('RU-RZR-II',       'Raizer II',               5445.00,    0.00, 800.00, 'flat', 360.00, 15),
  ('RU-RZR-II-RF',    'Raizer II (Refurbished)', 4149.00,    0.00, 550.00, 'flat', 290.00, 15),
  ('RU-RZR-I-RF',     'Raizer I (Refurbished)',  2969.00,    0.00, 400.00, 'flat', 200.00, 15)
ON CONFLICT (sku) DO NOTHING;
