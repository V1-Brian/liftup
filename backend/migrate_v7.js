require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
});

const sql = `
  CREATE TABLE IF NOT EXISTS shipments (
    id                      SERIAL PRIMARY KEY,
    order_no                VARCHAR(50)  NOT NULL,
    shopify_order_id        BIGINT,
    tracking_number         VARCHAR(100),
    carrier                 VARCHAR(50)  NOT NULL DEFAULT 'UPS',
    shipped_at              TIMESTAMPTZ,
    tracking_updated_at     TIMESTAMPTZ,
    shopify_synced          BOOLEAN      NOT NULL DEFAULT FALSE,
    shopify_synced_at       TIMESTAMPTZ,
    shopify_sync_error      TEXT,
    order_email_subject     TEXT,
    shipment_email_subject  TEXT,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_order_no
    ON shipments(order_no);
  CREATE INDEX IF NOT EXISTS idx_shipments_tracking
    ON shipments(tracking_number) WHERE tracking_number IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_shipments_unsynced
    ON shipments(shopify_synced) WHERE shopify_synced = FALSE AND tracking_number IS NOT NULL;
`;

(async () => {
  try {
    await pool.query(sql);
    console.log('Migration v7 complete: shipments table created.');
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
