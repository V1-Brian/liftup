// Migration v9: add credit_id FK to adjustments
// Links a credit-memo adjustment row back to its source credit so the invoice
// save handler can tell which credits are still on the invoice and which the
// user has removed (and should be reset to open).
//
// Run: node backend/migrate_v9.js
// Or paste the SQL directly into TablePlus.

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false } : false,
});

(async () => {
  try {
    await pool.query(`
      ALTER TABLE adjustments
        ADD COLUMN IF NOT EXISTS credit_id INT REFERENCES credits(id) ON DELETE SET NULL
    `);
    console.log('Migration v9 applied: adjustments.credit_id added');
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
