-- supabase/migrations/030_ocr_cache.sql
--
-- OCR 비용 통제 인프라:
--   1) ocr_cache       — 다중 사용자가 같은 이미지 공유 시 OCR 1회만 호출 (SaaS 절감 핵심)
--   2) ocr_usage_logs  — 사용자별 OCR 호출 추적 (quota 검증 + ROI 데이터)

BEGIN;

-- 1) 글로벌 OCR 캐시 (image_url_hash 기준)
CREATE TABLE IF NOT EXISTS public.ocr_cache (
  image_url_hash TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  provider TEXT,                                  -- 'claude_haiku' | 'gemini_flash' | 'google_vision'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2) 사용자별 OCR 사용 로그 (cache hit/miss + quota 차감용)
CREATE TABLE IF NOT EXISTS public.ocr_usage_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  image_url_hash TEXT NOT NULL,
  cached BOOLEAN DEFAULT false,                   -- true: cache hit (quota 차감 X) / false: 실제 API call
  provider TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 월별 사용량 집계 최적화
CREATE INDEX IF NOT EXISTS ocr_usage_user_month_idx
  ON public.ocr_usage_logs (user_id, created_at DESC);

-- cache hit/miss 통계용
CREATE INDEX IF NOT EXISTS ocr_usage_cached_idx
  ON public.ocr_usage_logs (cached, created_at DESC);

COMMIT;
