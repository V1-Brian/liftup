CREATE TABLE IF NOT EXISTS processed_emails (
  message_id  VARCHAR(64) PRIMARY KEY,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);
