-- Migration 0013: chat public keys (JWK).
--
-- Purpose:
-- - Store a user's public key (as JWK JSON) to support encrypted support chat messages.
-- - Add an index to efficiently find users who have published a key.

ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_public_jwk JSONB;

CREATE INDEX IF NOT EXISTS idx_users_chat_public_jwk ON users ((chat_public_jwk IS NOT NULL));
