-- 021: 마케팅 페르소나 시스템 — Ssobi 공식 SNS 운영용 가상 인플루언서
--
-- 구조:
--   marketing_personas        — 페르소나 정의 (이름·언어·voice·토픽 기둥)
--   marketing_persona_samples — Claude 학습용 샘플 포스트 (참고 인플루언서 스타일)
--   marketing_assets          — 비주얼 자산 라이브러리 (Higgsfield 결과 업로드)
--   marketing_posts.persona_id / asset_ids — 페르소나·자산 연결
--   marketing_posts.status 에 'draft' 추가
--
-- 자동화 흐름:
--   1) 너가 페르소나 정의 + 샘플 paste + 자산 업로드
--   2) 매일 cron 이 Claude 호출 → draft 5개 생성 → 너 검수
--   3) 좋은 거 schedule → 기존 publish-marketing cron 이 채널 발행

-- 페르소나 정의
CREATE TABLE IF NOT EXISTS public.marketing_personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'ko' CHECK (language IN ('ko','en','ja','zh')),
  bio TEXT,                          -- 짧은 자기소개 (Claude system prompt 일부)
  voice_description TEXT NOT NULL,   -- 톤·관점·말투 묘사 (3~5줄)
  reference_account_url TEXT,        -- 참고 인플루언서 URL (메모)
  channels TEXT[] NOT NULL DEFAULT '{}',  -- ['threads','x','instagram','tiktok','youtube','facebook']
  topic_pillars JSONB NOT NULL DEFAULT '[]', -- [{name, weight}] 배열, 합 100
  daily_draft_count INTEGER NOT NULL DEFAULT 3 CHECK (daily_draft_count BETWEEN 1 AND 10),
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personas_active ON public.marketing_personas(active) WHERE active = true;

-- 샘플 포스트 (학습 데이터)
CREATE TABLE IF NOT EXISTS public.marketing_persona_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID NOT NULL REFERENCES public.marketing_personas(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  source_channel TEXT,              -- 'threads' | 'x' | 'instagram' (참고)
  posted_at TIMESTAMPTZ,            -- 원본 게시 시점 (참고)
  notes TEXT,                       -- "좋은 톤 예시" 등
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_samples_persona ON public.marketing_persona_samples(persona_id);

-- 비주얼 자산 (Higgsfield 결과 업로드)
CREATE TABLE IF NOT EXISTS public.marketing_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID REFERENCES public.marketing_personas(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('image','video')),
  url TEXT NOT NULL,                -- Supabase Storage public URL
  storage_path TEXT,                -- internal path
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  duration_seconds NUMERIC(6,2),    -- video 만
  scene_prompt TEXT,                -- 묘사 (Higgsfield 프롬프트 또는 메모)
  tags TEXT[] DEFAULT '{}',         -- 자유 태그 (분류·필터용)
  usage_count INTEGER NOT NULL DEFAULT 0,  -- 사용된 횟수
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assets_persona ON public.marketing_assets(persona_id);
CREATE INDEX IF NOT EXISTS idx_assets_type ON public.marketing_assets(type);

-- marketing_posts 확장 — 페르소나·자산 연결, 'draft' 상태 추가
ALTER TABLE public.marketing_posts
  ADD COLUMN IF NOT EXISTS persona_id UUID REFERENCES public.marketing_personas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS asset_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS topic_pillar TEXT;

-- status check 제약 재정의 — 'draft' 추가
ALTER TABLE public.marketing_posts
  DROP CONSTRAINT IF EXISTS marketing_posts_status_check;
ALTER TABLE public.marketing_posts
  ADD CONSTRAINT marketing_posts_status_check
  CHECK (status IN ('draft','pending','publishing','published','partial','failed','cancelled'));

-- draft 검수 빠른 조회
CREATE INDEX IF NOT EXISTS idx_marketing_posts_drafts
  ON public.marketing_posts(persona_id, created_at DESC)
  WHERE status = 'draft';

-- RLS — admin 만 접근 (API 가 service_role 로 작업)
ALTER TABLE public.marketing_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_persona_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct persona access" ON public.marketing_personas FOR ALL USING (false);
CREATE POLICY "No direct sample access" ON public.marketing_persona_samples FOR ALL USING (false);
CREATE POLICY "No direct asset access" ON public.marketing_assets FOR ALL USING (false);

-- updated_at 자동 갱신 (set_updated_at 함수는 020 에서 정의됨)
DROP TRIGGER IF EXISTS trg_personas_updated_at ON public.marketing_personas;
CREATE TRIGGER trg_personas_updated_at
  BEFORE UPDATE ON public.marketing_personas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
