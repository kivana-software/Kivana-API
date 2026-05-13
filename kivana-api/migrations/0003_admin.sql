-- Migration 0003: admin flag.
--
-- Purpose:
-- - Add `users.is_admin` to mark accounts allowed to access admin-only endpoints/UI.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
