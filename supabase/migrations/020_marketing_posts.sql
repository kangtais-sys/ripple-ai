-- 020: 마케팅 발행 큐 — Ssobi 본인 SNS 자동 발행 (admin 전용)
--
-- Why: Phase 1.5 마케팅 자동화 — Ssobi 출시 마케팅을 Meta 3채널
--   (IG / Threads / Facebook) 에 자동 동시 발행. 추후 X 도 추가.
--   사용자 콘텐츠 ig_accounts 와는 별개. ssobi 본인 채널 운영용.
--
-- 발행 흐름:
--   admin /admin/marketing 에서 콘텐츠 작성
--   → marketing_posts INSERT (status='pending', scheduled_at)
--   → /api/cron/publish-marketing (5분마다)
--     → due 글 가져와 channels 각각 publish
--     → results 에 채널별 결과 누적
--     → status='published' | 'partial' | 'failed'

CREATE TABLE IF NOT EXISTS public.marketing_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  image_urls TEXT[] DEFAULT '{}',
  channels TEXT[] NOT NULL CHECK (array_length(channels, 1) > 0),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','publishing','published','partial','failed','cancelled')),
  results JSONB DEFAULT '{}',           -- { ig: {ok,id,error}, threads: ..., fb: ..., x: ... }
  published_at TIMESTAMPTZ,
  error TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- cron 빠른 조회 — pending + due
CREATE INDEX IF NOT EXISTS idx_marketing_posts_due
  ON public.marketing_posts(scheduled_at)
  WHERE status = 'pending';

-- admin 목록 정렬용
CREATE INDEX IF NOT EXISTS idx_marketing_posts_created
  ON public.marketing_posts(created_at DESC);

-- RLS — admin 만 SELECT/INSERT (서비스 키는 우회)
ALTER TABLE public.marketing_posts ENABLE ROW LEVEL SECURITY;

-- admin 이메일 allowlist 와 동기화 어렵기 때문에, 일단 모든 RLS 차단.
-- API 라우트에서 isAdminEmail 체크 후 service role 로 작업.
CREATE POLICY "No direct access"
  ON public.marketing_posts FOR ALL
  USING (false);

-- updated_at 자동 갱신 트리거 (이미 다른 테이블에 동일 함수 있다면 재사용)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_marketing_posts_updated_at ON public.marketing_posts;
CREATE TRIGGER trg_marketing_posts_updated_at
  BEFORE UPDATE ON public.marketing_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();