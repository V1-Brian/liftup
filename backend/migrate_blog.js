require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
});

const sql = `
  CREATE TABLE IF NOT EXISTS blog_posts_log (
    id                  SERIAL PRIMARY KEY,
    topic_index         INTEGER NOT NULL,
    keyword             TEXT NOT NULL,
    title               TEXT,
    shopify_article_id  BIGINT,
    status              TEXT NOT NULL DEFAULT 'published',
    error_message       TEXT,
    published_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

(async () => {
  try {
    await pool.query(sql);
    console.log('blog_posts_log table created (or already exists).');
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
