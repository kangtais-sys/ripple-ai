-- 유저별 오늘의 추천 주제 (매일 오전 6시 KST cron 이 onboarding_topics 기반으로 재랭킹)
-- daily_trends 는 전 유저 공용, user_daily_recs 는 개인화 레이어
CREATE TABLE IF NOT EXISTS public.user_daily_recs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date_kst    DATE NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  topics      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- 디버깅·튜닝용: 어떤 onboarding_topics 로 골라졌는지
  meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (user_id, date_kst)
);

CREATE INDEX IF NOT EXISTS user_daily_recs_user_idx
  ON public.user_daily_recs (user_id, date_kst DESC);

ALTER TABLE public.user_daily_recs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_daily_recs read own" ON public.user_daily_recs
  FOR SELECT USING (auth.uid() = user_id);
