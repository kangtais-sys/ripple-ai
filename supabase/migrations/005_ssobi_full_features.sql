-- Ssobi v2.2 전체 기능 스키마 (수익·포인트·CRM·AI·정산)
-- 2026-04-19

-- ═══════════════════════════════════════════════════════════════════
-- 0. profiles 컬럼 확장
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

-- 가입 시 auth.users.email → profiles.email 자동 복사
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'display_name',
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════════
-- 1. AI 토큰·비용 로깅 (가격 책정 근거)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.ai_usage_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  feature TEXT NOT NULL CHECK (feature IN ('cardnews','tone_learn','reply_gen','dm_gen','translate','classify','other')),
  model TEXT NOT NULL,
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  cache_read_tokens INT DEFAULT 0,
  cache_creation_tokens INT DEFAULT 0,
  cost_usd_cents NUMERIC(12,4) DEFAULT 0,
  ref_type TEXT,
  ref_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_ai_usage_user_date ON public.ai_usage_logs(user_id, created_at DESC);
CREATE INDEX idx_ai_usage_feature_date ON public.ai_usage_logs(feature, created_at DESC);

-- 유저별 월별 집계 view (가격 대시보드용)
CREATE OR REPLACE VIEW public.ai_usage_monthly AS
SELECT
  user_id,
  DATE_TRUNC('month', created_at)::date AS month,
  feature,
  COUNT(*) AS calls,
  SUM(input_tokens) AS input_tokens,
  SUM(output_tokens) AS output_tokens,
  SUM(cost_usd_cents) AS cost_usd_cents
FROM public.ai_usage_logs
GROUP BY user_id, DATE_TRUNC('month', created_at), feature;

-- ═══════════════════════════════════════════════════════════════════
-- 2. 구독 & 결제
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','basic','premium','business')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','past_due','canceled','paused','trial')),
  started_at TIMESTAMPTZ DEFAULT now(),
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  canceled_at TIMESTAMPTZ,
  portone_customer_key TEXT,
  portone_billing_key TEXT,
  monthly_price_krw INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_subs_status_end ON public.subscriptions(status, current_period_end);

CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  portone_tx_id TEXT UNIQUE NOT NULL,
  portone_merchant_uid TEXT,
  amount_krw INT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('paid','failed','refunded','pending','canceled','partial_refund')),
  plan TEXT,
  payment_method TEXT,
  card_company TEXT,
  failure_reason TEXT,
  receipt_url TEXT,
  paid_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  refunded_amount_krw INT,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_payments_user_date ON public.payments(user_id, created_at DESC);
CREATE INDEX idx_payments_sub ON public.payments(subscription_id, paid_at DESC);

-- 결제 프로필 (실명·사업자 정보)
CREATE TABLE public.billing_profiles (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'individual' CHECK (kind IN ('individual','business')),
  real_name TEXT,
  business_name TEXT,
  business_no TEXT,
  ceo_name TEXT,
  business_type TEXT,
  business_item TEXT,
  business_address TEXT,
  tax_email TEXT,
  contact_phone TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════
-- 3. 소셜 계정 통합 (IG·TT·YT·Kakao·Threads·X)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.social_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('instagram','tiktok','youtube','kakao','threads','x','facebook')),
  platform_user_id TEXT NOT NULL,
  handle TEXT,
  display_name TEXT,
  avatar_url TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT,
  is_primary BOOLEAN DEFAULT false,
  connected_at TIMESTAMPTZ DEFAULT now(),
  disconnected_at TIMESTAMPTZ,
  meta JSONB DEFAULT '{}'::jsonb,
  UNIQUE(user_id, platform, platform_user_id)
);
CREATE INDEX idx_social_user_platform ON public.social_accounts(user_id, platform) WHERE disconnected_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 4. 팔로워 CRM
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.followers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('instagram','tiktok','youtube','threads','x','other')),
  handle TEXT NOT NULL,
  score INT DEFAULT 0,
  tier TEXT CHECK (tier IN ('vvip','royal','fan','regular','concern','blocked')),
  sentiment TEXT CHECK (sentiment IN ('positive','neutral','negative')),
  comment_count INT DEFAULT 0,
  dm_count INT DEFAULT 0,
  purchase_count INT DEFAULT 0,
  last_interaction_at TIMESTAMPTZ,
  note TEXT,
  tags TEXT[],
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, platform, handle)
);
CREATE INDEX idx_followers_user_tier ON public.followers(user_id, tier, score DESC);
CREATE INDEX idx_followers_sentiment ON public.followers(user_id, sentiment, last_interaction_at DESC);

-- ═══════════════════════════════════════════════════════════════════
-- 5. 자동 응답 룰
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.auto_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('comment','dm','mention','reaction','keyword')),
  trigger_match JSONB DEFAULT '{}'::jsonb,
  action_type TEXT NOT NULL CHECK (action_type IN ('reply','send_dm','tag','notify','proposal','bulk_reply')),
  action_template TEXT,
  cooldown_seconds INT DEFAULT 0,
  max_per_day INT,
  priority INT DEFAULT 0,
  last_fired_at TIMESTAMPTZ,
  fire_count_today INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_auto_rules_user_enabled ON public.auto_rules(user_id, enabled, priority DESC);

-- ═══════════════════════════════════════════════════════════════════
-- 6. 아웃바운드 메시지 (DM·댓글 발송 로그)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.outbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('instagram','tiktok','youtube','kakao','email','threads','x')),
  kind TEXT NOT NULL CHECK (kind IN ('comment_reply','dm','mention','broadcast','dm_rule')),
  recipient_handle TEXT,
  recipient_platform_id TEXT,
  source_ref_type TEXT,
  source_ref_id TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','delivered','read','failed','queued','canceled')),
  error_code TEXT,
  error_message TEXT,
  attempts INT DEFAULT 0,
  platform_message_id TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_outbound_user_date ON public.outbound_messages(user_id, created_at DESC);
CREATE INDEX idx_outbound_pending ON public.outbound_messages(status, created_at) WHERE status IN ('pending','queued');

-- ═══════════════════════════════════════════════════════════════════
-- 7. 비즈 DM (수익제안)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.revenue_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  source_channel TEXT NOT NULL CHECK (source_channel IN ('instagram_dm','email','web_form','tiktok_dm','youtube_comment','link_proposal','other')),
  from_name TEXT,
  from_brand TEXT,
  from_email TEXT,
  from_platform_id TEXT,
  kind TEXT CHECK (kind IN ('sponsorship','ad','collab','export','oem','amazon','kakao_biz','other')),
  amount_krw BIGINT,
  currency TEXT DEFAULT 'KRW',
  original_text TEXT NOT NULL,
  ai_summary TEXT,
  ai_classification JSONB,
  status TEXT DEFAULT 'new' CHECK (status IN ('new','reviewing','accepted','rejected','negotiating','closed')),
  replied_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_rev_user_status ON public.revenue_proposals(user_id, status, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════
-- 8. 알림 (카카오 알림톡·이메일·인앱)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.notification_prefs (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  kakao_enabled BOOLEAN DEFAULT false,
  kakao_channel_id TEXT,
  kakao_phone TEXT,
  email_enabled BOOLEAN DEFAULT true,
  push_enabled BOOLEAN DEFAULT true,
  events JSONB DEFAULT '{
    "urgent_reply": true,
    "daily_report": true,
    "revenue_proposal": true,
    "subscription_renewal": true,
    "quota_alert": true,
    "payment_failed": true
  }'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('kakao','email','in_app','push','sms')),
  event TEXT,
  template_code TEXT,
  subject TEXT,
  body TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('pending','sent','delivered','failed','read')),
  error TEXT,
  external_id TEXT,
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_notif_user_date ON public.notifications(user_id, created_at DESC);
CREATE INDEX idx_notif_pending ON public.notifications(status, created_at) WHERE status = 'pending';

-- ═══════════════════════════════════════════════════════════════════
-- 9. 포인트 원장 (append-only)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.points_ledger (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  delta INT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN (
    'signup_bonus','invite_reward','subscribe_reward','first_cardnews',
    'cardnews_use','reply_use','dm_use',
    'referral_signup','referral_subscribe',
    'purchase','refund','admin_adjust','expire'
  )),
  ref_type TEXT,
  ref_id TEXT,
  balance_after INT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_points_user_date ON public.points_ledger(user_id, created_at DESC);

-- 현재 잔액 조회 함수
CREATE OR REPLACE FUNCTION public.get_points_balance(p_user_id UUID)
RETURNS INT AS $$
  SELECT COALESCE(balance_after, 0)
  FROM public.points_ledger
  WHERE user_id = p_user_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- ═══════════════════════════════════════════════════════════════════
-- 10. 친구 초대
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL NOT NULL,
  invitee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  invited_email TEXT,
  signed_up_at TIMESTAMPTZ,
  subscribed_at TIMESTAMPTZ,
  signup_reward_given BOOLEAN DEFAULT false,
  subscribe_reward_given BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(inviter_id, invitee_id)
);
CREATE INDEX idx_referrals_code ON public.referrals(code);
CREATE INDEX idx_referrals_inviter ON public.referrals(inviter_id);

-- ═══════════════════════════════════════════════════════════════════
-- 11. 일자별 집계 통계
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.short_link_daily_stats (
  code TEXT REFERENCES public.short_links(code) ON DELETE CASCADE,
  date DATE NOT NULL,
  clicks INT DEFAULT 0,
  unique_visitors INT DEFAULT 0,
  countries JSONB DEFAULT '{}'::jsonb,
  PRIMARY KEY (code, date)
);
CREATE INDEX idx_short_daily_date ON public.short_link_daily_stats(date);

CREATE TABLE public.link_page_daily_stats (
  link_page_id UUID REFERENCES public.link_pages(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  views INT DEFAULT 0,
  unique_visitors INT DEFAULT 0,
  block_clicks JSONB DEFAULT '{}'::jsonb,
  PRIMARY KEY (link_page_id, date)
);

-- ═══════════════════════════════════════════════════════════════════
-- 12. KYC (본인·계좌 인증) — 수익 정산용
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.kyc_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('nice','kcb','pass','portone_1won','toss','manual')),
  provider_tx_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('real_name','phone','bank_1won','passbook','business','foreign_id')),
  status TEXT NOT NULL CHECK (status IN ('requested','succeeded','failed','expired','canceled')),
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_kyc_user_kind ON public.kyc_verifications(user_id, kind, status);

-- 정산 계좌
CREATE TABLE public.payout_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  bank_code TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_number_encrypted TEXT NOT NULL,
  account_holder TEXT NOT NULL,
  is_verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMPTZ,
  verification_method TEXT CHECK (verification_method IN ('1won','passbook_image','manual','portone')),
  kyc_verification_id UUID REFERENCES public.kyc_verifications(id) ON DELETE SET NULL,
  is_default BOOLEAN DEFAULT false,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_payout_accounts_user ON public.payout_accounts(user_id) WHERE disabled_at IS NULL;

-- 정산 출금
CREATE TABLE public.payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL NOT NULL,
  payout_account_id UUID REFERENCES public.payout_accounts(id) ON DELETE SET NULL,
  amount_krw BIGINT NOT NULL,
  withholding_tax_krw BIGINT DEFAULT 0,
  net_amount_krw BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested','approved','transferred','failed','canceled')),
  period_start DATE,
  period_end DATE,
  requested_at TIMESTAMPTZ DEFAULT now(),
  approved_at TIMESTAMPTZ,
  transferred_at TIMESTAMPTZ,
  bank_tx_id TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_payouts_user_status ON public.payouts(user_id, status, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════
-- 13. reply_logs, card_news_jobs 컬럼 확장
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.reply_logs
  ADD COLUMN IF NOT EXISTS urgency TEXT CHECK (urgency IN ('low','medium','high','urgent')),
  ADD COLUMN IF NOT EXISTS sentiment TEXT CHECK (sentiment IN ('positive','neutral','negative')),
  ADD COLUMN IF NOT EXISTS send_status TEXT DEFAULT 'pending' CHECK (send_status IN ('pending','sent','failed','manual','skipped'));

ALTER TABLE public.card_news_jobs
  ADD COLUMN IF NOT EXISTS slides_rendered JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS publishes JSONB DEFAULT '{}'::jsonb;

-- ═══════════════════════════════════════════════════════════════════
-- RLS 활성화 & 정책
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.short_link_daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_page_daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

-- 소유자 전용 패턴 (공통)
CREATE POLICY "Owner reads own ai_usage" ON public.ai_usage_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Owner reads own subs" ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Owner reads own payments" ON public.payments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Owner manages own billing" ON public.billing_profiles FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Owner manages own social" ON public.social_accounts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Owner manages own followers" ON public.followers FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Owner manages own rules" ON public.auto_rules FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Owner reads own outbound" ON public.outbound_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Owner manages own revenue" ON public.revenue_proposals FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Owner manages own notif_prefs" ON public.notification_prefs FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Owner reads own notifs" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Owner reads own points" ON public.points_ledger FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Owner reads own referrals" ON public.referrals FOR SELECT USING (auth.uid() = inviter_id OR auth.uid() = invitee_id);
CREATE POLICY "Owner reads own short_stats" ON public.short_link_daily_stats FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.short_links sl WHERE sl.code = short_link_daily_stats.code AND sl.user_id = auth.uid()));
CREATE POLICY "Owner reads own page_stats" ON public.link_page_daily_stats FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.link_pages lp WHERE lp.id = link_page_daily_stats.link_page_id AND lp.user_id = auth.uid()));
CREATE POLICY "Owner reads own kyc" ON public.kyc_verifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Owner manages own payout_accounts" ON public.payout_accounts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Owner reads own payouts" ON public.payouts FOR SELECT USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════
-- 트리거: updated_at 자동 갱신
-- ═══════════════════════════════════════════════════════════════════
CREATE TRIGGER tr_subs_updated BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tr_billing_updated BEFORE UPDATE ON public.billing_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tr_followers_updated BEFORE UPDATE ON public.followers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tr_auto_rules_updated BEFORE UPDATE ON public.auto_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tr_revenue_updated BEFORE UPDATE ON public.revenue_proposals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tr_notif_prefs_updated BEFORE UPDATE ON public.notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tr_payout_accounts_updated BEFORE UPDATE ON public.payout_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════
-- RPC: 포인트 적립·차감 (원자적 트랜잭션)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.add_points(
  p_user_id UUID,
  p_delta INT,
  p_reason TEXT,
  p_ref_type TEXT DEFAULT NULL,
  p_ref_id TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
) RETURNS INT AS $$
DECLARE
  v_new_balance INT;
  v_current INT;
BEGIN
  SELECT COALESCE(balance_after, 0) INTO v_current
    FROM public.points_ledger
    WHERE user_id = p_user_id
    ORDER BY created_at DESC, id DESC
    LIMIT 1 FOR UPDATE;
  v_new_balance := COALESCE(v_current, 0) + p_delta;
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient points balance (current: %, delta: %)', v_current, p_delta;
  END IF;
  INSERT INTO public.points_ledger (user_id, delta, reason, ref_type, ref_id, balance_after, description)
    VALUES (p_user_id, p_delta, p_reason, p_ref_type, p_ref_id, v_new_balance, p_description);
  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.add_points TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_points_balance TO authenticated, service_role;
