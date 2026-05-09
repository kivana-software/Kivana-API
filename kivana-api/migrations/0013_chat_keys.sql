ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_public_jwk JSONB;

CREATE INDEX IF NOT EXISTS idx_users_chat_public_jwk ON users ((chat_public_jwk IS NOT NULL));
