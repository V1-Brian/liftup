// Migration v10: canceled credits
// Adds a third credit status, 'canceled', for credits that were created but
// should never be applied to an invoice (e.g. a return in the same month as the
// order). The row is kept for reference; cancel metadata is recorded here.
//
// Run: node backend/migrate_v10.js
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
      ALTER TABLE credits ADD COLUMN IF NOT EXISTS canceled_at   TIMESTAMPTZ;
      ALTER TABLE credits ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
    `);
    console.log('Migration v10 applied: credits.canceled_at + credits.cancel_reason added');
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
