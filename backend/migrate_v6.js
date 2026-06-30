require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
});

const sql = `
  CREATE TABLE IF NOT EXISTS pending_returns (
    id               SERIAL PRIMARY KEY,
    amazon_order_id  VARCHAR(40) NOT NULL,
    refund_amount    NUMERIC(10,2),
    email_subject    TEXT,
    email_from       TEXT,
    email_body       TEXT,
    received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    order_id         INTEGER REFERENCES orders(id),
    invoice_id       INTEGER REFERENCES invoices(id),
    status           TEXT NOT NULL DEFAULT 'pending',
    disposition      TEXT,
    processed_at     TIMESTAMPTZ,
    notes            TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_pending_returns_status
    ON pending_returns(status) WHERE status IN ('pending', 'unmatched');
  CREATE INDEX IF NOT EXISTS idx_pending_returns_amazon_order_id
    ON pending_returns(amazon_order_id);
`;

// status: 'pending' (matched to order, awaiting user action)
//         'unmatched' (no matching order found by amazon_order_id)
//         'processed' (user confirmed disposition)
//         'dismissed' (user dismissed without action)
// disposition: 'before' | 'after' — set on process

(async () => {
  try {
    await pool.query(sql);
    console.log('Migration v6 complete: pending_returns table created.');
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
