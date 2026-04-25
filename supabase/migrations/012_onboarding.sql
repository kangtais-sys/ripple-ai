-- 온보딩 플로우 결과 저장 (PART 6 개인화 데이터 누적)
-- profiles 테이블에 직접 컬럼 추가 — JSONB 보다 쿼리·인덱스 용이
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_topics TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS onboarding_tone TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_goal TEXT,
  ADD COLUMN IF NOT EXISTS preferred_hook_type TEXT,        -- 'number' | 'fomo' | 'reverse'
  ADD COLUMN IF NOT EXISTS preferred_template TEXT,
  ADD COLUMN IF NOT EXISTS generated_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS category_history JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

-- 추천 갱신 cron 이 빠르게 조회하도록 인덱스
CREATE INDEX IF NOT EXISTS profiles_onboarding_topics_idx ON public.profiles USING gin (onboarding_topics);
