require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'migrate_v2.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('✅  Migration v2 complete');
  } catch (err) {
    console.error('❌  Migration v2 failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
