-- Migration 0010: account security metadata.
--
-- Purpose:
-- - Track password rotation (`users.password_changed_at`) for UI display and security policies.
-- - Backfill existing rows and enforce NOT NULL.
-- - Store session client metadata (`sessions.client_ip`, `sessions.user_agent`) for session listing and revocation UX.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NULL;

UPDATE users
SET password_changed_at = created_at
WHERE password_changed_at IS NULL;

ALTER TABLE users
  ALTER COLUMN password_changed_at SET NOT NULL;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS client_ip TEXT NULL,
  ADD COLUMN IF NOT EXISTS user_agent TEXT NULL;
