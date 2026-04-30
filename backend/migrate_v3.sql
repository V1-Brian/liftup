-- Migration v3: invoice discrepancy tracking

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS email_invoice_total  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS email_line_items      JSONB,
  ADD COLUMN IF NOT EXISTS mismatch_notes        TEXT;
