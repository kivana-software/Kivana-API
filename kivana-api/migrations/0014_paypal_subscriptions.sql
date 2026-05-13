-- Migration 0014: PayPal subscription linkage.
--
-- Purpose:
-- - Extend `subscriptions` with payment-provider fields so the backend can:
--   - Correlate local subscriptions with PayPal subscription/plan IDs.
--   - Track billing cycle, currency, and provider-side status.
--   - Record the last received webhook/event timestamp for reconciliation.
-- - Add a unique index to prevent duplicate provider subscription IDs.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_plan_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS provider_status TEXT,
  ADD COLUMN IF NOT EXISTS provider_last_event_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_provider_subscription_id_unique
  ON subscriptions(provider, provider_subscription_id)
  WHERE provider IS NOT NULL AND provider_subscription_id IS NOT NULL;
