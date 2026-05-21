-- supabase/migrations/031_rag_query_logging.sql
--
-- RAG 응대 로깅 (OCR ROI 판단 데이터):
--   - top_similarity: rag.ts 의 search_knowledge top result 점수 (0~1)
--   - fallback_triggered: generate.ts 의 sim<0.45 또는 chunks=0 시 채널 fallback
--
-- 분석 query: intent='product_inquiry' AND fallback_triggered → OCR 후보
-- Phase B (OCR worker) 진행 기준 = 비율 > 10%

BEGIN;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS top_similarity NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS fallback_triggered BOOLEAN DEFAULT false;

-- OCR ROI 월별 집계 최적화 (inbound 만 partial — 전체 적재 부담 0)
CREATE INDEX IF NOT EXISTS conv_ocr_roi_idx
  ON public.conversations (created_at DESC, intent, fallback_triggered)
  WHERE direction = 'inbound';

COMMIT;
