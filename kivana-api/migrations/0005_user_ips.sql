-- Migration 0005: user last IP.
--
-- Purpose:
-- - Store the last observed client IP for security/audit and basic abuse prevention.
-- - Uses VARCHAR(45) to cover IPv4 and IPv6 textual formats.

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_ip VARCHAR(45);
