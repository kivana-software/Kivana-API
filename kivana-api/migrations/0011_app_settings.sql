-- Migration 0011: application settings store.
--
-- Purpose:
-- - Provide a simple key/value store for runtime configuration managed via admin APIs.
-- - Stores JSON values (`JSONB`) so the portal can evolve config shape without schema changes.

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
