-- 매일 23:00 cron 이 TREND_RESEARCH_PROMPT 로 생성한 "오늘의 추천 주제"
-- 유저가 만들기 탭 열면 오늘 날짜의 recommended_topics 3개 + top5 원본을 읽어 감
CREATE TABLE IF NOT EXISTS public.daily_trends (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- date_kst = KST 기준 날짜 (하루 1 row) — 동일 날짜 중복 시 최신 cron 이 upsert
  date_kst    DATE NOT NULL UNIQUE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Claude 가 TREND_RESEARCH_PROMPT 로 뽑은 결과
  top5                JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_topics  JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- cron 이 수집한 raw feed (디버깅/재분석용)
  raw_feed_snapshot   JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Claude 토큰 usage
  meta                JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS daily_trends_date_idx ON public.daily_trends (date_kst DESC);

-- RLS: 전 유저 read 허용 (추천 주제는 공용), write 는 service role 만
ALTER TABLE public.daily_trends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daily_trends read all" ON public.daily_trends FOR SELECT USING (true);
