require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
});

const sql = `
  ALTER TABLE credits ADD COLUMN IF NOT EXISTS order_no VARCHAR(60);
`;

(async () => {
  try {
    await pool.query(sql);
    console.log('Migration v8 complete: credits.order_no column added.');
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
