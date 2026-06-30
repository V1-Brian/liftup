require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
});

const sql = `
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS amazon_order_id VARCHAR(40);
  CREATE INDEX IF NOT EXISTS idx_orders_amazon_order_id ON orders(amazon_order_id)
    WHERE amazon_order_id IS NOT NULL;
`;

(async () => {
  try {
    await pool.query(sql);
    console.log('Migration v5 complete: amazon_order_id added to orders.');
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
