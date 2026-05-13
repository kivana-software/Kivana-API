-- Migration 0007: admin IP lock.
--
-- Purpose:
-- - Allow pinning an admin account to a specific IP address after first admin login.
-- - Adds:
--   - `admin_lock_ip`: locked IP (IPv4/IPv6 text).
--   - `admin_lock_at`: timestamp when the lock was applied.

ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_lock_ip VARCHAR(45);
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_lock_at TIMESTAMPTZ;
