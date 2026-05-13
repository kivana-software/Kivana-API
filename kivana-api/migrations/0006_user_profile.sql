-- Migration 0006: user profile fields.
--
-- Purpose:
-- - Add optional profile metadata used by the account portal UI:
--   - `display_name`: human-friendly name shown in the portal.
--   - `avatar_data_url`: avatar image stored as a data URL (small images only).

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data_url TEXT;
