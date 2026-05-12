-- 022: 페르소나 멀티언어 + 계정 연동 + 주제 풀
--
-- 변경:
--   1. marketing_personas.languages text[] (다중 언어 지원)
--   2. marketing_persona_accounts — 페르소나별 SNS 계정 연동
--   3. marketing_topics — 일일 주제 풀 (후킹·정보 가치 평가 포함)
--   4. marketing_posts.format — text/shorts/card_news 분류
--   5. Higgsfield 작업 추적 — marketing_assets.higgsfield_request_id + status

-- 1) 페르소나 multi-language
ALTER TABLE public.marketing_personas
  ADD COLUMN IF NOT EXISTS languages TEXT[] DEFAULT ARRAY[]::TEXT[];

-- 기존 language 값을 languages 배열에 백필
UPDATE public.marketing_personas
SET languages = ARRAY[language]
WHERE language IS NOT NULL
  AND (languages IS NULL OR array_length(languages, 1) IS NULL);

-- (language 필드 자체는 유지 — primary 언어로 backward compat. 새 코드는 languages 사용)

-- 2) 페르소나 연동 계정
CREATE TABLE IF NOT EXISTS public.marketing_persona_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID NOT NULL REFERENCES public.marketing_personas(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram','threads','facebook','x','tiktok','youtube')),
  language TEXT NOT NULL CHECK (language IN ('ko','en','ja','zh')),  -- 한국 채널 / 영문 채널 구분
  username TEXT,
  display_name TEXT,
  external_id TEXT,                 -- 플랫폼측 user_id / page_id (Meta business id 등)
  access_token TEXT,                -- 암호화는 추후 (RLS 가 보호)
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_persona_accounts_persona
  ON public.marketing_persona_accounts(persona_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_persona_accounts_platform_lang
  ON public.marketing_persona_accounts(persona_id, platform, language)
  WHERE active = true;

-- 3) 주제 풀 — 일일 주제 발굴 결과
CREATE TABLE IF NOT EXISTS public.marketing_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID NOT NULL REFERENCES public.marketing_personas(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  hook TEXT,                         -- 후킹 1줄
  info_value TEXT,                   -- 정보 가치 (왜 사람들이 저장·공유할지)
  target_emotion TEXT,               -- 목표 감정 (놀람·공감·인사이트)
  engagement_score NUMERIC(3,1),     -- AI 평가 점수 0~10
  source TEXT,                       -- 'trend' / 'evergreen' / 'manual'
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','approved','rejected','used')),
  approved_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topics_persona_status
  ON public.marketing_topics(persona_id, status, created_at DESC);

-- 4) marketing_posts.format — 콘텐츠 유형 분류
ALTER TABLE public.marketing_posts
  ADD COLUMN IF NOT EXISTS format TEXT
    CHECK (format IN ('text','shorts','card_news')),
  ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES public.marketing_topics(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS language TEXT
    CHECK (language IN ('ko','en','ja','zh'));

-- 5) Higgsfield 추적 — marketing_assets 확장
ALTER TABLE public.marketing_assets
  ADD COLUMN IF NOT EXISTS higgsfield_request_id TEXT,
  ADD COLUMN IF NOT EXISTS higgsfield_model_id TEXT,
  ADD COLUMN IF NOT EXISTS generation_status TEXT NOT NULL DEFAULT 'completed'
    CHECK (generation_status IN ('queued','processing','completed','failed','cancelled')),
  ADD COLUMN IF NOT EXISTS generation_error TEXT;

CREATE INDEX IF NOT EXISTS idx_assets_higgsfield_req
  ON public.marketing_assets(higgsfield_request_id)
  WHERE higgsfield_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_generation_status
  ON public.marketing_assets(generation_status)
  WHERE generation_status IN ('queued','processing');

-- 6) RLS — 모두 admin only
ALTER TABLE public.marketing_persona_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct persona_accounts access"
  ON public.marketing_persona_accounts FOR ALL USING (false);
CREATE POLICY "No direct topics access"
  ON public.marketing_topics FOR ALL USING (false);

DROP TRIGGER IF EXISTS trg_persona_accounts_updated_at ON public.marketing_persona_accounts;
CREATE TRIGGER trg_persona_accounts_updated_at
  BEFORE UPDATE ON public.marketing_persona_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
