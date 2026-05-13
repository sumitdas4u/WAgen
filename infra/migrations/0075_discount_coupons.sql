CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('subscription')),
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value NUMERIC(12, 2) NOT NULL CHECK (discount_value > 0),
  allowed_plans TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  max_redemptions INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  max_per_user INTEGER CHECK (max_per_user IS NULL OR max_per_user > 0),
  first_purchase_only BOOLEAN NOT NULL DEFAULT FALSE,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'expired')),
  razorpay_offer_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_unique_idx
  ON coupons (UPPER(code));

CREATE INDEX IF NOT EXISTS coupons_status_scope_idx
  ON coupons(status, scope, updated_at DESC);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  purchase_type TEXT NOT NULL CHECK (purchase_type IN ('subscription')),
  plan_code TEXT,
  credits INTEGER CHECK (credits IS NULL OR credits > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'expired')),
  original_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (original_amount_paise >= 0),
  discount_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount_paise >= 0),
  final_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (final_amount_paise >= 0),
  gst_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (gst_amount_paise >= 0),
  gst_rate_percent NUMERIC(5, 2),
  currency TEXT NOT NULL DEFAULT 'INR',
  razorpay_subscription_id TEXT,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_idx
  ON coupon_redemptions(coupon_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS coupon_redemptions_user_idx
  ON coupon_redemptions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS coupon_redemptions_subscription_idx
  ON coupon_redemptions(razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS coupon_redemptions_order_idx
  ON coupon_redemptions(razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS coupon_redemptions_payment_unique_idx
  ON coupon_redemptions(razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coupon_redemption_id UUID REFERENCES coupon_redemptions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount_paise >= 0);

CREATE INDEX IF NOT EXISTS user_subscriptions_coupon_idx
  ON user_subscriptions(coupon_id)
  WHERE coupon_id IS NOT NULL;

ALTER TABLE subscription_payments
  ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coupon_redemption_id UUID REFERENCES coupon_redemptions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount_paise >= 0);

CREATE INDEX IF NOT EXISTS subscription_payments_coupon_idx
  ON subscription_payments(coupon_id)
  WHERE coupon_id IS NOT NULL;

DROP TRIGGER IF EXISTS coupons_touch_updated_at ON coupons;
CREATE TRIGGER coupons_touch_updated_at
BEFORE UPDATE ON coupons
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS coupon_redemptions_touch_updated_at ON coupon_redemptions;
CREATE TRIGGER coupon_redemptions_touch_updated_at
BEFORE UPDATE ON coupon_redemptions
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
