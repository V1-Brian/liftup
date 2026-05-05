require('dotenv').config();
const { Pool } = require('pg');
const fs       = require('fs');
const path     = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'migrate_v4.sql'), 'utf8');
  await pool.query(sql);
  console.log('✅  Migration v4 complete');
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
