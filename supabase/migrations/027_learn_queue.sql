-- 027: learn_queue — URL 학습 작업 큐
--
-- Vercel function 안에서 URL 동기 처리하면 timeout/instance-kill 발생.
-- → 큐에 insert 만 하고 즉시 응답, cron 이 1분마다 1개씩 처리.
-- → Firecrawl (JS 렌더링 + 봇 우회) → chunks + OCR → knowledge_chunks

-- ─────────────────────────────────────────────────────────────────
-- 1) learn_queue 테이블
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.learn_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,

  url text NOT NULL,
  label text,

  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',     -- 큐 대기
    'processing',  -- cron 처리 중 (다른 instance 중복 방지)
    'done',        -- 학습 완료
    'blocked',     -- 봇 차단·접근 불가 → 사용자 직접 추가 필요
    'failed'       -- 일시적 에러 (재시도 가능)
  )),

  source text NOT NULL DEFAULT 'sync_links' CHECK (source IN (
    'sync_links',  -- 내 링크 페이지 저장 시 자동
    'chat',        -- 채팅창 단건 URL
    'onboarding'   -- 가입 직후 첫 URL
  )),

  -- 처리 결과 { chunks: N, ocr_chunks: M, error: '...' }
  result jsonb,

  -- 재시도 카운트 (failed 상태에서 재처리할 때 사용)
  attempts int NOT NULL DEFAULT 0,
  last_error text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────
-- 2) 인덱스
-- ─────────────────────────────────────────────────────────────────
-- 학습탭 UI: 사용자별 큐 상태 조회
CREATE INDEX IF NOT EXISTS idx_lq_user_status
  ON public.learn_queue(user_id, status);

-- cron pickup: 가장 오래된 pending 1개 fetch
CREATE INDEX IF NOT EXISTS idx_lq_pickup
  ON public.learn_queue(status, created_at)
  WHERE status = 'pending';

-- 중복 큐 방지: 같은 user + url + (pending|processing) 1건만 허용
CREATE UNIQUE INDEX IF NOT EXISTS idx_lq_active_unique
  ON public.learn_queue(user_id, url)
  WHERE status IN ('pending', 'processing');

-- ─────────────────────────────────────────────────────────────────
-- 3) RLS — 사용자는 자기 큐만 조회. cron 은 service_role 로 우회.
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE public.learn_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner sees own queue"
  ON public.learn_queue FOR ALL
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 4) updated_at 자동 갱신 트리거
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_learn_queue_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_learn_queue_updated_at ON public.learn_queue;
CREATE TRIGGER trg_learn_queue_updated_at
  BEFORE UPDATE ON public.learn_queue
  FOR EACH ROW EXECUTE FUNCTION public.touch_learn_queue_updated_at();
