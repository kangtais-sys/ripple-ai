-- 019: 베타 자동 가입 — handle_new_user 트리거 업데이트
--
-- 베타 기간 동안 신규 가입자에게 자동으로 beta=true + beta_ends_at 부여
-- app_settings 테이블의 'beta_end_date' 값 기준 (admin 이 SQL 로 변경 가능)
-- beta_end_date 이 NULL 이거나 과거면 베타 미적용 (free 가입)

-- 글로벌 설정 테이블 (단일 행, key-value 패턴)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 베타 종료 시점 기본값 — 2026-08-12 (3개월, 변경 시 admin SQL 로)
INSERT INTO public.app_settings (key, value)
VALUES ('beta_end_date', '2026-08-12T23:59:59+09:00')
ON CONFLICT (key) DO NOTHING;

-- handle_new_user 갱신 — 베타 필드 추가
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_beta_end_str TEXT;
  v_beta_end TIMESTAMPTZ;
  v_is_beta BOOLEAN := false;
BEGIN
  -- 베타 기간 체크
  SELECT value INTO v_beta_end_str FROM public.app_settings WHERE key = 'beta_end_date';
  IF v_beta_end_str IS NOT NULL THEN
    BEGIN
      v_beta_end := v_beta_end_str::TIMESTAMPTZ;
      v_is_beta := (NOW() < v_beta_end);
    EXCEPTION WHEN OTHERS THEN
      v_is_beta := false;
    END;
  END IF;

  -- 1. 프로필 생성 + 베타 부여
  INSERT INTO public.profiles (
    id, display_name, email,
    beta, beta_started_at, beta_ends_at
  )
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'display_name',
    NEW.email,
    v_is_beta,
    CASE WHEN v_is_beta THEN NOW() ELSE NULL END,
    CASE WHEN v_is_beta THEN v_beta_end ELSE NULL END
  )
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

  -- 2. 기본 free 구독 레코드 (베타여도 plan 자체는 free, 게이팅만 우회)
  INSERT INTO public.subscriptions (user_id, plan, status)
  VALUES (NEW.id, 'free', 'active')
  ON CONFLICT (user_id) DO NOTHING;

  -- 3. 알림 설정 기본값
  INSERT INTO public.notification_prefs (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  -- 4. 가입 보너스 100P
  INSERT INTO public.points_ledger (user_id, delta, reason, balance_after, description)
  VALUES (NEW.id, 100, 'signup_bonus', 100, '가입 축하 보너스');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 기존 가입자도 베타 백필 — 이미 가입돼있는 모든 유저에게 베타 적용
--   (실제 가입자 0~소수 가정. 운영 후엔 이 부분 제거하고 신규만 베타)
UPDATE public.profiles p
SET beta = true,
    beta_started_at = COALESCE(p.beta_started_at, p.created_at, NOW()),
    beta_ends_at = (SELECT value FROM public.app_settings WHERE key = 'beta_end_date')::TIMESTAMPTZ
WHERE p.beta = false
  AND (SELECT value FROM public.app_settings WHERE key = 'beta_end_date')::TIMESTAMPTZ > NOW();