-- 017: subscriptions 테이블 확장 — NicePay 직결 + Stripe 직결 듀얼 결제 지원
--   기존 portone_* 컬럼은 deprecated 상태로 남김 (drop 안 함, 안전 차원)
--   새 시스템은 provider 컬럼 기반으로 분기
--
-- 가격 정책: /Users/yuminhye/.claude/projects/-Users-yuminhye/memory/project_ssobi_pricing.md
-- DB enum (plan) 은 free/basic/premium/business 그대로 재용도:
--   basic = STARTER, premium = PRO, business = TEAM (가입자 0명이라 안전)

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS payment_provider TEXT
    CHECK (payment_provider IN ('nicepay','stripe')),
  ADD COLUMN IF NOT EXISTS provider_billing_key TEXT,
  ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'KRW'
    CHECK (currency IN ('KRW','USD')),
  ADD COLUMN IF NOT EXISTS monthly_price_usd NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS next_billing_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_billing_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_payment_id TEXT;

-- 정기결제 cron 빠른 조회 — next_billing_at 이 임박한 active 구독만 스캔
CREATE INDEX IF NOT EXISTS idx_subscriptions_next_billing
  ON public.subscriptions(next_billing_at)
  WHERE status = 'active' AND payment_provider = 'nicepay';

-- Stripe webhook 에서 subscription_id 로 빠르게 조회
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_sub_id
  ON public.subscriptions(provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

-- 결제 시도 로그 (성공/실패 모두 기록 — 운영 트러블슈팅 + 재시도 판단용)
CREATE TABLE IF NOT EXISTS public.payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  payment_provider TEXT NOT NULL CHECK (payment_provider IN ('nicepay','stripe')),
  payment_id TEXT NOT NULL,              -- NicePay tid OR Stripe charge/invoice id
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('KRW','USD')),
  status TEXT NOT NULL CHECK (status IN ('pending','paid','failed','refunded','cancelled')),
  failure_reason TEXT,
  attempted_at TIMESTAMPTZ DEFAULT now(),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_user
  ON public.payment_attempts(user_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_subscription
  ON public.payment_attempts(subscription_id, attempted_at DESC);

-- RLS — 본인 결제 시도만 조회 가능 (서비스 키만 INSERT)
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own payment attempts"
  ON public.payment_attempts FOR SELECT
  USING (auth.uid() = user_id);
