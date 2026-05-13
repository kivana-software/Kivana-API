-- Migration 0012: support chat (threads + messages).
--
-- Purpose:
-- - Introduce a threaded support inbox:
--   - `support_threads`: per-user (or guest) conversation state + unread tracking.
--   - `support_messages`: append-only messages within a thread.
-- - Add indexes for listing threads by recency and filtering by user/guest/status.
-- - Migrate historical `contact_messages` into the new thread/message model.

CREATE TABLE IF NOT EXISTS support_threads (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  guest_email TEXT,
  guest_name TEXT,
  subject TEXT NOT NULL DEFAULT 'Support',
  status TEXT NOT NULL DEFAULT 'open',
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sender_role TEXT NOT NULL DEFAULT 'user',
  user_last_read_at TIMESTAMPTZ,
  admin_last_read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_threads_user_id_last_message_at ON support_threads (user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_threads_guest_email_last_message_at ON support_threads (guest_email, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_threads_status_last_message_at ON support_threads (status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id UUID PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL,
  sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_thread_created_at ON support_messages (thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_support_messages_created_at ON support_messages (created_at DESC);

INSERT INTO support_threads (
  id,
  user_id,
  guest_email,
  guest_name,
  subject,
  status,
  last_message_at,
  last_sender_role,
  created_at,
  updated_at
)
SELECT
  cm_first.id AS id,
  u.id AS user_id,
  CASE WHEN u.id IS NULL THEN cm_first.email ELSE NULL END AS guest_email,
  CASE WHEN u.id IS NULL THEN cm_first.name ELSE NULL END AS guest_name,
  COALESCE(NULLIF(cm_first.subject, ''), 'Support request') AS subject,
  'open' AS status,
  cm_last.max_created_at AS last_message_at,
  'user' AS last_sender_role,
  cm_first.created_at AS created_at,
  cm_last.max_created_at AS updated_at
FROM (
  SELECT DISTINCT ON (email)
    id,
    email,
    name,
    subject,
    created_at
  FROM contact_messages
  ORDER BY email, created_at ASC
) cm_first
LEFT JOIN users u ON u.email = cm_first.email
LEFT JOIN (
  SELECT email, MAX(created_at) AS max_created_at
  FROM contact_messages
  GROUP BY email
) cm_last ON cm_last.email = cm_first.email
ON CONFLICT (id) DO NOTHING;

INSERT INTO support_messages (
  id,
  thread_id,
  sender_role,
  sender_user_id,
  body,
  created_at
)
SELECT
  cm.id AS id,
  cm_first.id AS thread_id,
  'user' AS sender_role,
  u.id AS sender_user_id,
  cm.message AS body,
  cm.created_at AS created_at
FROM contact_messages cm
JOIN (
  SELECT DISTINCT ON (email)
    id,
    email
  FROM contact_messages
  ORDER BY email, created_at ASC
) cm_first ON cm_first.email = cm.email
LEFT JOIN users u ON u.email = cm.email
ON CONFLICT (id) DO NOTHING;

UPDATE support_threads t
SET
  last_message_at = m.max_created_at,
  updated_at = m.max_created_at,
  last_sender_role = 'user'
FROM (
  SELECT thread_id, MAX(created_at) AS max_created_at
  FROM support_messages
  GROUP BY thread_id
) m
WHERE t.id = m.thread_id;
