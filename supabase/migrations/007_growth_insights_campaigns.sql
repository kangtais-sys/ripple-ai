-- Ssobi v2.3 — 성장 인사이트 · 게시물 분석 · 캠페인 참여 · AI 학습 교정
-- instagram_insights는 RAG(검색 증강 생성)용으로 설계:
--   summary_text (자연어), metric_snapshot (JSONB), raw_json (원본)
--   + embedding(vector) 준비 (pgvector 확장 설치 시 활성화)

-- ═══════════════════════════════════════════════════════════════════
-- 0. profiles 확장 (페르소나·팔로워·온보딩 완료 플래그)
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS persona_type TEXT,                -- 'beauty','lifestyle','food','fashion','fitness','pet','baby','tech','travel','money','book','music','home','sports'
  ADD COLUMN IF NOT EXISTS persona_confidence NUMERIC(3,2),  -- 0.00~1.00 AI 분류 확신도
  ADD COLUMN IF NOT EXISTS follower_count INT,               -- 최근 동기화된 팔로워 수 (캐시)
  ADD COLUMN IF NOT EXISTS follower_count_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;

-- ═══════════════════════════════════════════════════════════════════
-- 1. instagram_insights — 시계열 성장 지표 (RAG 핵심)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.instagram_insights (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  ig_account_id UUID REFERENCES public.ig_accounts(id) ON DELETE CASCADE,

  -- 스냅샷 시점
  recorded_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  period_type TEXT NOT NULL DEFAULT 'daily' CHECK (period_type IN ('hourly','daily','weekly','monthly','snapshot')),
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,

  -- 핵심 지표 (정규화 컬럼 — 빠른 집계·쿼리용)
  follower_count INT,
  following_count INT,
  media_count INT,
  reach INT,
  impressions INT,
  profile_views INT,
  website_clicks INT,
  saves_total INT,        -- 저장 수 (성장 시그널)
  shares_total INT,       -- 공유 수
  comments_total INT,
  likes_total INT,

  -- 변화량 (전일 대비, 집계 시 채움)
  follower_delta INT,
  reach_delta INT,
  saves_delta INT,

  -- RAG 최적화 필드
  metric_snapshot JSONB DEFAULT '{}'::jsonb NOT NULL,
      -- 모든 수치 지표를 한 JSON 오브젝트로 (쿼리 유연성)
  top_content_ids UUID[] DEFAULT '{}',
      -- 이 기간 최고 성과 posts_analysis.id 배열
  summary_text TEXT,
      -- AI가 읽을 자연어 요약: "4월 19일: 팔로워 +120명, 저장 +45% 급증.
      -- 최고 릴스는 '아이돌 메이크업 Best 3' (저장 890회)."
      -- Claude가 이걸 읽고 사용자에게 성장 리포트 생성 (RAG context)
  insights_tags TEXT[] DEFAULT '{}',
      -- ['viral_reel','follower_surge','saves_spike','flat_growth'] 등 라벨링

  -- 원본 (인스타 Graph API 응답 그대로)
  raw_json JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- 시계열 조회 최적화 (유저별 최신순)
CREATE INDEX idx_ig_insights_user_date ON public.instagram_insights(user_id, recorded_at DESC);
CREATE INDEX idx_ig_insights_period ON public.instagram_insights(user_id, period_type, period_start DESC);
-- JSONB 내부 키 검색 최적화
CREATE INDEX idx_ig_insights_snapshot_gin ON public.instagram_insights USING gin (metric_snapshot);
CREATE INDEX idx_ig_insights_tags_gin ON public.instagram_insights USING gin (insights_tags);

-- ═══════════════════════════════════════════════════════════════════
-- 2. posts_analysis — 발행한 게시물별 성과 + AI 학습
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.posts_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  ig_account_id UUID REFERENCES public.ig_accounts(id) ON DELETE SET NULL,
  card_news_job_id UUID REFERENCES public.card_news_jobs(id) ON DELETE SET NULL,
      -- 우리 에디터로 만든 카드뉴스면 연결 (말투·훅 학습 루프)

  -- 플랫폼 식별
  platform TEXT NOT NULL DEFAULT 'instagram' CHECK (platform IN ('instagram','tiktok','youtube','threads')),
  platform_post_id TEXT NOT NULL,
  content_type TEXT CHECK (content_type IN ('reel','feed','story','carousel','igtv','short','video','photo')),
  posted_at TIMESTAMPTZ,
  permalink TEXT,

  -- 콘텐츠 본문 (AI가 "어떤 문구가 터졌나" 학습)
  caption TEXT,
  hook_used TEXT,              -- 추출된 후킹 문구 (예: "한국인이 절대 안 쓰는 7가지...")
  hashtags TEXT[] DEFAULT '{}',
  mentions TEXT[] DEFAULT '{}',

  -- 지표 (최신값으로 주기 갱신)
  reach INT DEFAULT 0,
  impressions INT DEFAULT 0,
  likes INT DEFAULT 0,
  comments INT DEFAULT 0,
  saves INT DEFAULT 0,
  shares INT DEFAULT 0,
  plays INT DEFAULT 0,          -- 릴스·동영상
  engagement_rate NUMERIC(6,4), -- (likes+comments+saves+shares) / reach

  -- 성과 티어 (빠른 필터)
  performance_tier TEXT CHECK (performance_tier IN ('viral','hit','normal','flop','tbd')) DEFAULT 'tbd',

  -- AI 분석 결과
  ai_analysis JSONB DEFAULT '{}'::jsonb,
      -- {hook_type:'question', tone:'casual', structure:'list', length_tier:'short',
      --  strong_elements:[...], weak_elements:[...], next_recommendation:'...'}

  -- 원본
  raw_metrics JSONB DEFAULT '{}'::jsonb,

  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, platform, platform_post_id)
);

CREATE INDEX idx_posts_user_posted ON public.posts_analysis(user_id, posted_at DESC);
CREATE INDEX idx_posts_tier ON public.posts_analysis(user_id, performance_tier, engagement_rate DESC);
CREATE INDEX idx_posts_hashtags_gin ON public.posts_analysis USING gin (hashtags);
CREATE INDEX idx_posts_analysis_gin ON public.posts_analysis USING gin (ai_analysis);

-- ═══════════════════════════════════════════════════════════════════
-- 3. campaigns + campaigns_participation — 수익화 캠페인
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  brand_name TEXT,
  description TEXT,
  category TEXT,                -- 'beauty','fashion','food',...
  kind TEXT CHECK (kind IN ('sponsorship','product_seed','group_buy','affiliate','ambassador','other')),
  reward_amount_krw INT,
  reward_type TEXT CHECK (reward_type IN ('cash','product','commission','mixed')),
  min_follower_count INT DEFAULT 0,
  required_persona TEXT[],      -- ['beauty','lifestyle']
  applications_deadline TIMESTAMPTZ,
  campaign_start TIMESTAMPTZ,
  campaign_end TIMESTAMPTZ,
  brief_url TEXT,
  is_active BOOLEAN DEFAULT true,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_campaigns_active ON public.campaigns(is_active, applications_deadline DESC);

CREATE TABLE public.campaigns_participation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN (
    'applied','approved','in_progress','submitted','completed','payout_requested','paid','rejected','canceled'
  )),
  applied_at TIMESTAMPTZ DEFAULT now(),
  approved_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  reward_amount_krw INT,
  payout_id UUID REFERENCES public.payouts(id) ON DELETE SET NULL,

  -- 성과 증빙 (브랜드사 제출용)
  submitted_post_id UUID REFERENCES public.posts_analysis(id) ON DELETE SET NULL,
  conversion_log JSONB DEFAULT '{}'::jsonb,
      -- {clicks: 1234, purchases: 45, revenue_krw: 450000, tracking_code: 'A1B2C3'}
  brand_feedback TEXT,

  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(campaign_id, user_id)
);
CREATE INDEX idx_cp_user_status ON public.campaigns_participation(user_id, status, applied_at DESC);
CREATE INDEX idx_cp_campaign ON public.campaigns_participation(campaign_id, status);

-- ═══════════════════════════════════════════════════════════════════
-- 4. reply_logs 확장 — AI 비서 학습 (최종 발송 vs AI 초안 비교)
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.reply_logs
  ADD COLUMN IF NOT EXISTS final_reply TEXT,
  ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT NULL,    -- true=딸깍승인, false=수정후발송, null=미처리
  ADD COLUMN IF NOT EXISTS edit_similarity NUMERIC(4,3),        -- 0.000~1.000, AI 초안과 최종 발송 유사도
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS context JSONB DEFAULT '{}'::jsonb;
      -- 학습용 맥락: {post_id, post_caption, prior_comments, sender_tier,...}

-- ═══════════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.instagram_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns_participation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads own ig_insights" ON public.instagram_insights FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Owner reads own posts_analysis" ON public.posts_analysis FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Public reads active campaigns" ON public.campaigns FOR SELECT USING (is_active = true);
CREATE POLICY "Owner manages own participation" ON public.campaigns_participation FOR ALL USING (auth.uid() = user_id);

-- 트리거: updated_at
CREATE TRIGGER tr_posts_analysis_updated BEFORE UPDATE ON public.posts_analysis
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tr_campaigns_updated BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tr_cp_updated BEFORE UPDATE ON public.campaigns_participation
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════
-- RPC: RAG용 성장 인사이트 요약 조회 (Claude가 읽기 좋은 포맷)
-- 최근 N일간의 summary_text + 주요 지표를 붙여서 반환
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_insights_context(
  p_user_id UUID,
  p_days INT DEFAULT 14
) RETURNS TEXT AS $$
DECLARE
  v_result TEXT := '';
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT recorded_at, period_type, summary_text,
           follower_count, reach, saves_total, profile_views,
           follower_delta, reach_delta, saves_delta, insights_tags
    FROM public.instagram_insights
    WHERE user_id = p_user_id
      AND recorded_at >= now() - (p_days || ' days')::interval
    ORDER BY recorded_at DESC
  LOOP
    v_result := v_result || '## ' || to_char(v_row.recorded_at, 'YYYY-MM-DD HH24:MI') ||
      ' [' || v_row.period_type || ']' || E'\n' ||
      COALESCE(v_row.summary_text, '') || E'\n' ||
      '지표: 팔로워=' || COALESCE(v_row.follower_count::text,'-') ||
      ' (Δ'||COALESCE(v_row.follower_delta::text,'0')||'), ' ||
      '도달=' || COALESCE(v_row.reach::text,'-') ||
      ', 저장=' || COALESCE(v_row.saves_total::text,'-') ||
      ', 프로필뷰=' || COALESCE(v_row.profile_views::text,'-') || E'\n';
    IF array_length(v_row.insights_tags, 1) > 0 THEN
      v_result := v_result || '태그: ' || array_to_string(v_row.insights_tags, ', ') || E'\n';
    END IF;
    v_result := v_result || E'---\n';
  END LOOP;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_insights_context TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════
-- RPC: 최고 성과 게시물 조회 (AI 훅·포맷 학습용)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_top_posts_for_learning(
  p_user_id UUID,
  p_limit INT DEFAULT 10
) RETURNS TABLE(
  post_id UUID,
  hook_used TEXT,
  caption TEXT,
  content_type TEXT,
  engagement_rate NUMERIC,
  saves INT,
  shares INT,
  performance_tier TEXT,
  ai_analysis JSONB,
  posted_at TIMESTAMPTZ
) AS $$
  SELECT id, hook_used, caption, content_type, engagement_rate,
         saves, shares, performance_tier, ai_analysis, posted_at
  FROM public.posts_analysis
  WHERE user_id = p_user_id
    AND performance_tier IN ('viral','hit')
  ORDER BY engagement_rate DESC NULLS LAST, saves DESC NULLS LAST
  LIMIT p_limit;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_top_posts_for_learning TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════
-- (선택) pgvector 임베딩 추가 — 나중에 Supabase에서 extension 활성화 후
-- ALTER TABLE public.instagram_insights ADD COLUMN IF NOT EXISTS summary_embedding vector(1536);
-- ALTER TABLE public.posts_analysis ADD COLUMN IF NOT EXISTS caption_embedding vector(1536);
-- CREATE INDEX ON public.instagram_insights USING ivfflat (summary_embedding vector_cosine_ops);
-- ═══════════════════════════════════════════════════════════════════
