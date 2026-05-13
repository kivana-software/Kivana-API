-- Migration 0008: staff roles + discounts.
--
-- Purpose:
-- - Add role flags used by moderation/support tooling:
--   - `is_moderator`, `is_founder`.
-- - Add flexible discount fields to apply account-specific price reductions:
--   - `discount_percent`, `discount_label`, `discount_expires_at`.
-- - Track when a founder discount was granted (`founder_discount_at`).

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_moderator BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_founder BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS founder_discount_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS discount_percent INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS discount_label TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS discount_expires_at TIMESTAMPTZ;
