-- 가입 시 자동 부트스트랩: subscriptions + notification_prefs + points_ledger (signup bonus)

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- 1. 프로필 생성 + 이메일 복사
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'display_name', NEW.email)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

  -- 2. 기본 free 구독 레코드
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

-- 트리거는 001에서 이미 등록됨 (AFTER INSERT ON auth.users)
-- 함수만 교체하면 새 로직 자동 적용
