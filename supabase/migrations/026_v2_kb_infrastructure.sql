-- 026: v2 KB 인프라 (pgvector + knowledge_chunks + 응대 강화 + 팬 CRM)
--
-- Phase 1 MVP 핵심 인프라:
-- • pgvector extension 활성화
-- • knowledge_chunks (RAG 임베딩 저장)
-- • profiles 확장 (user_type, signup 흐름 단계 추적)
-- • tone_profiles 확장 (페르소나, 사용자 보정)
-- • fan_profiles + conversations (팬 CRM, 차등 컨텍스트)
-- • pending_replies (긴급 응대 큐, 솔라피 알림 → /quick/[id] 1-탭 발송)
-- • urgent_contexts (긴급 공지)
-- • uploaded_files (추가 학습 자료)
-- • crawl_policies (도메인별 학습 정책 캐시)
-- • daily_reports (일일 리포트)
-- • send_attempts + account_health (계정 안전 audit)

-- ─────────────────────────────────────────────────────────────────
-- 1) pgvector extension
-- ─────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────────────────────────
-- 2) knowledge_chunks — RAG KB (Voyage AI 임베딩, 1024 차원)
--    추후 Cohere 등으로 교체 시 차원만 맞추면 재임베딩으로 OK
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,

  source_type text NOT NULL CHECK (source_type IN (
    'link',         -- 내 링크 블록 텍스트 (자동)
    'link_url',     -- 내 링크 블록의 외부 URL 크롤링 (자동)
    'image',        -- Vision 추출 (PDF·이미지 페이지 fallback)
    'pdf',          -- PDF 업로드 학습
    'docx',         -- Word 업로드 학습
    'csv',          -- CSV 업로드 학습
    'sheet',        -- 구글시트 연동 (Phase 2)
    'urgent',       -- 긴급 컨텍스트 (priority=10)
    'manual',       -- 사용자 직접 입력 보완
    'migration',    -- 인포크·Linktree 등 마이그레이션 import
    'tone_sample'   -- IG 게시물·내가 단 댓글 (말투 학습 출처)
  )),
  source_id text,                -- 외부 시스템 참조 (link_pages.id, uploaded_files.id 등)
  source_label text,             -- 사용자한테 보이는 출처명 ("글로우 세럼 상세페이지")
  source_url text,               -- 원본 URL (있으면)
  source_domain text,            -- 도메인 (정책 캐시 + 분류용)

  content text NOT NULL,
  embedding vector(1024),        -- Voyage AI voyage-3-lite (1024 차원)

  -- 카테고리 분류 (사용자 유형 자동 추론용)
  detected_price numeric,        -- 가격 정보 추출 시
  detected_currency text,        -- 'KRW', 'USD' 등
  category text,                 -- 'product', 'content', 'class', 'event', 'service', 'faq', 'other'

  priority int DEFAULT 1,        -- urgent=10 항상 우선, 일반=1
  expires_at timestamptz,        -- 긴급 청크 자동 만료
  is_active boolean DEFAULT true,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kc_user ON public.knowledge_chunks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kc_priority ON public.knowledge_chunks(user_id, priority DESC) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_kc_source_domain ON public.knowledge_chunks(source_domain) WHERE source_domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kc_category ON public.knowledge_chunks(user_id, category) WHERE category IS NOT NULL;

-- 벡터 유사도 인덱스 (ivfflat, lists=100 → 10K 청크까지 충분)
CREATE INDEX IF NOT EXISTS idx_kc_embedding
  ON public.knowledge_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner manages own kb chunks"
  ON public.knowledge_chunks FOR ALL
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 3) profiles 확장 — v2 사용자 유형 + signup 흐름
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS user_type text
    CHECK (user_type IN ('seller', 'creator', 'educator', 'mixed'))
    DEFAULT 'mixed',
  ADD COLUMN IF NOT EXISTS user_type_manual boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS user_type_classified_at timestamptz,

  -- signup 흐름 (가입 검증 단계 완료 추적)
  ADD COLUMN IF NOT EXISTS tone_validated boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_link_added boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS reply_mode text
    CHECK (reply_mode IN ('draft', 'auto'))
    DEFAULT 'draft',                      -- 첫 7일 draft, 그 후 사용자 선택
  ADD COLUMN IF NOT EXISTS draft_mode_until timestamptz,   -- draft 모드 만료일

  -- 응대 시간대 (HH:MM)
  ADD COLUMN IF NOT EXISTS reply_hours_start text DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS reply_hours_end text DEFAULT '23:00',

  -- 응대 데이터 보관 기간 (일)
  ADD COLUMN IF NOT EXISTS data_retention_days int DEFAULT 90,

  -- "(AI 답변)" 표시 옵션
  ADD COLUMN IF NOT EXISTS show_ai_indicator boolean DEFAULT false,

  -- 마지막 KB 재분류 시각
  ADD COLUMN IF NOT EXISTS kb_reclassified_at timestamptz;

-- ─────────────────────────────────────────────────────────────────
-- 4) tone_profiles 확장
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE public.tone_profiles
  ADD COLUMN IF NOT EXISTS persona_summary text,        -- "30대 K-뷰티 인플루언서"
  ADD COLUMN IF NOT EXISTS persona_details jsonb,       -- 자세한 페르소나 데이터
  ADD COLUMN IF NOT EXISTS user_corrections jsonb DEFAULT '[]',  -- 검증 단계 수정 내역
  ADD COLUMN IF NOT EXISTS validation_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS validation_examples jsonb;   -- 검증 예시 5개 Q&A

-- ─────────────────────────────────────────────────────────────────
-- 5) fan_profiles — 팬 CRM
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fan_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  ig_user_id text,                          -- 팬의 IG user id
  ig_username text,
  display_name text,

  -- 메타데이터 (응대 누적)
  conversation_count int DEFAULT 0,
  comment_count int DEFAULT 0,
  dm_count int DEFAULT 0,
  click_count int DEFAULT 0,                -- 응대 후 short_link 클릭 수
  estimated_purchase_count int DEFAULT 0,   -- 추정 구매 횟수 (매출 클릭으로 추정)

  -- 분류
  is_vip boolean DEFAULT false,             -- 응대 10회+ 또는 구매 3회+
  sentiment_recent text,                    -- 최근 대화 감정 (positive/neutral/negative)

  -- 24h 창
  window_expires_at timestamptz,

  -- 팬 요약 (AI 갱신)
  profile_summary text,
  interests text[],

  -- 첫 등장 / 마지막 활동
  first_seen_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now(),

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(user_id, ig_user_id)
);

CREATE INDEX IF NOT EXISTS idx_fan_user ON public.fan_profiles(user_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_fan_window ON public.fan_profiles(user_id, window_expires_at) WHERE window_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fan_vip ON public.fan_profiles(user_id) WHERE is_vip = true;

ALTER TABLE public.fan_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner manages own fans" ON public.fan_profiles FOR ALL USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 6) conversations — 전체 대화 영구 보관
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  fan_id uuid REFERENCES public.fan_profiles(id) ON DELETE CASCADE,

  channel text CHECK (channel IN ('dm', 'comment')) NOT NULL,
  direction text CHECK (direction IN ('inbound', 'outbound')) NOT NULL,
  content text NOT NULL,

  -- 의도 분류 (4-way)
  intent text CHECK (intent IN ('purchase_intent', 'product_inquiry', 'schedule_inquiry', 'urgent', 'other')),
  sentiment text CHECK (sentiment IN ('positive', 'neutral', 'negative', 'unknown')) DEFAULT 'unknown',
  is_urgent boolean DEFAULT false,
  is_converted boolean DEFAULT false,

  -- IG 메타
  ig_message_id text,
  ig_comment_id text,
  ig_media_id text,

  -- 응대 이력
  ai_drafted boolean DEFAULT false,
  is_approved boolean,
  approved_by_user boolean DEFAULT false,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_user_fan ON public.conversations(user_id, fan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_intent ON public.conversations(user_id, intent, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_urgent ON public.conversations(user_id, created_at DESC) WHERE is_urgent = true;

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads own conversations" ON public.conversations FOR ALL USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 7) pending_replies — 긴급/draft 모드 응대 큐 (1-탭 승인)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pending_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  fan_id uuid REFERENCES public.fan_profiles(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,

  channel text CHECK (channel IN ('dm', 'comment')) NOT NULL,
  original_message text NOT NULL,
  original_message_id text NOT NULL,
  ai_draft text NOT NULL,
  intent text,

  -- 알림·승인
  approval_token text NOT NULL UNIQUE,                  -- /quick/[token] 인증
  window_expires_at timestamptz NOT NULL,               -- 24h 창
  notified_at timestamptz,                              -- 솔라피 첫 발송
  reminded_count int DEFAULT 0,

  status text DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'edited_sent', 'ignored', 'expired')),
  approved_at timestamptz,
  sent_at timestamptz,
  final_message text,                                   -- 사용자 수정 시 최종 발송 내용

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_active
  ON public.pending_replies(status, window_expires_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pending_user
  ON public.pending_replies(user_id, created_at DESC);

ALTER TABLE public.pending_replies ENABLE ROW LEVEL SECURITY;
-- token 으로 access 하니까 user 인증 없이 token verify 로 동작 (앱 서버에서 처리)
CREATE POLICY "Owner reads own pending" ON public.pending_replies FOR SELECT USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 8) urgent_contexts — 긴급 공지 (가격 변경·배송 지연 등)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.urgent_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  content text NOT NULL,
  is_active boolean DEFAULT true,
  expires_at timestamptz,
  knowledge_chunk_id uuid REFERENCES public.knowledge_chunks(id) ON DELETE CASCADE,  -- 임베딩 청크 참조
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_urgent_user_active
  ON public.urgent_contexts(user_id, expires_at)
  WHERE is_active = true;

ALTER TABLE public.urgent_contexts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner manages own urgent" ON public.urgent_contexts FOR ALL USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 9) uploaded_files — 추가 학습 자료 (PDF·이미지·Word·CSV)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.uploaded_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL CHECK (file_type IN ('pdf', 'image', 'docx', 'csv', 'txt')),
  file_size_bytes int,
  storage_path text NOT NULL,
  status text DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'error')),
  chunk_count int DEFAULT 0,
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uploaded_user ON public.uploaded_files(user_id, created_at DESC);

ALTER TABLE public.uploaded_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner manages own files" ON public.uploaded_files FOR ALL USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 10) crawl_policies — 도메인별 학습 정책 캐시 (지능적 분기)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crawl_policies (
  domain text PRIMARY KEY,
  policy text CHECK (policy IN ('quick_ok', 'playwright_needed', 'bot_blocked', 'image_page')) NOT NULL,
  success_count int DEFAULT 0,
  fail_count int DEFAULT 0,
  service_type text,                  -- 'commerce', 'linkbio', 'content', 'class', 'sns', 'blog', 'other'
  last_checked_at timestamptz DEFAULT now(),
  notes text
);

-- 알려진 봇 차단 도메인 시드
INSERT INTO public.crawl_policies (domain, policy, service_type, notes) VALUES
  ('amazon.com', 'bot_blocked', 'commerce', 'IP 차단 + 봇 감지'),
  ('amazon.co.jp', 'bot_blocked', 'commerce', 'IP 차단'),
  ('oliveyoung.co.kr', 'bot_blocked', 'commerce', '봇 감지 + 이미지 페이지'),
  ('coupang.com', 'bot_blocked', 'commerce', '봇 감지'),
  ('wemakeprice.com', 'bot_blocked', 'commerce', '봇 감지'),
  ('ticketmonster.co.kr', 'bot_blocked', 'commerce', '봇 감지'),
  ('linktr.ee', 'quick_ok', 'linkbio', 'Next.js SSR — __NEXT_DATA__'),
  ('infolink.kr', 'quick_ok', 'linkbio', 'HTML 파싱 안정'),
  ('litt.link', 'quick_ok', 'linkbio', 'HTML 파싱'),
  ('beacons.ai', 'quick_ok', 'linkbio', 'API endpoint'),
  ('bento.me', 'playwright_needed', 'linkbio', 'JS 렌더'),
  ('lnk.bio', 'quick_ok', 'linkbio', '단순 HTML'),
  ('smartstore.naver.com', 'playwright_needed', 'commerce', 'JS 렌더 OK'),
  ('youtube.com', 'quick_ok', 'content', 'OG 메타'),
  ('youtu.be', 'quick_ok', 'content', 'OG 메타')
ON CONFLICT (domain) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────
-- 11) daily_reports — 일일 리포트 cron 결과
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL,

  total_handled int DEFAULT 0,
  auto_rate float DEFAULT 0,
  converted_count int DEFAULT 0,
  urgent_count int DEFAULT 0,
  window_expired_count int DEFAULT 0,
  new_fan_count int DEFAULT 0,
  returning_fan_count int DEFAULT 0,

  estimated_revenue_krw numeric DEFAULT 0,
  link_click_count int DEFAULT 0,
  commerce_reach_count int DEFAULT 0,        -- 매출 사이트 도달 수

  top_questions jsonb DEFAULT '[]',          -- [{ q: '...', count: N }, ...]

  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_user_date ON public.daily_reports(user_id, date DESC);

ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads own reports" ON public.daily_reports FOR SELECT USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 12) send_attempts — 모든 발송 시도 audit (계정 안전 + 디버깅)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.send_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  fan_id uuid REFERENCES public.fan_profiles(id) ON DELETE SET NULL,
  channel text CHECK (channel IN ('dm', 'comment')) NOT NULL,

  draft_content text NOT NULL,
  attempted_at timestamptz DEFAULT now(),

  status text NOT NULL CHECK (status IN (
    'sent',
    'blocked_window',           -- 24h 창 만료
    'blocked_spam',              -- 스팸 패턴 (동일 답안 반복)
    'blocked_rate_limit',        -- IG API rate limit
    'blocked_content_filter',    -- 금지 콘텐츠 필터
    'blocked_hours',             -- 응대 시간대 외
    'queued',                    -- 시간대 외 → 시간 되면 발송
    'failed'                     -- IG API 오류
  )),
  block_reason text,
  rate_limit_pct float,
  retry_after timestamptz
);

CREATE INDEX IF NOT EXISTS idx_send_attempts_user
  ON public.send_attempts(user_id, attempted_at DESC);

ALTER TABLE public.send_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads own attempts" ON public.send_attempts FOR SELECT USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 13) account_health — 계정 헬스 일별 스냅샷
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.account_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL,

  total_sent int DEFAULT 0,
  blocked_count int DEFAULT 0,
  max_rate_limit_pct float DEFAULT 0,
  policy_compliance_score float DEFAULT 1.0,  -- 0~1
  token_health boolean DEFAULT true,

  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_acc_health_user ON public.account_health(user_id, date DESC);

ALTER TABLE public.account_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads own health" ON public.account_health FOR SELECT USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 14) RPC — 사용자 유형 자동 분류
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.classify_user_type(p_user_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_commerce int; v_content int; v_edu int; v_price int;
  v_total int;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE source_domain ~* '(smartstore|oliveyoung|cafe24|shopify|coupang|amazon|naver\.com/shopping)'),
    COUNT(*) FILTER (WHERE source_domain ~* '(youtube|tiktok|instagram|naver\.tv|twitch|vlive)'),
    COUNT(*) FILTER (WHERE source_domain ~* '(class101|inflearn|kmooc|udemy|coursera|fastcampus)'),
    COUNT(*) FILTER (WHERE detected_price IS NOT NULL),
    COUNT(*)
  INTO v_commerce, v_content, v_edu, v_price, v_total
  FROM public.knowledge_chunks
  WHERE user_id = p_user_id AND is_active = true;

  -- 데이터 부족 → mixed
  IF v_total < 3 THEN RETURN 'mixed'; END IF;

  -- 압도적 단일 유형 (50%+)
  IF v_commerce + v_price * 0.5 > v_total * 0.5 THEN RETURN 'seller'; END IF;
  IF v_content > v_total * 0.5 THEN RETURN 'creator'; END IF;
  IF v_edu > v_total * 0.3 THEN RETURN 'educator'; END IF;

  RETURN 'mixed';
END;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 15) RPC — KB RAG 검색 (priority 우선 + 코사인 유사도)
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_knowledge(
  p_user_id uuid,
  p_query_embedding vector(1024),
  p_limit int DEFAULT 5
) RETURNS TABLE (
  id uuid,
  content text,
  source_type text,
  source_label text,
  priority int,
  similarity float
) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    kc.id,
    kc.content,
    kc.source_type,
    kc.source_label,
    kc.priority,
    1 - (kc.embedding <=> p_query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.user_id = p_user_id
    AND kc.is_active = true
    AND (kc.expires_at IS NULL OR kc.expires_at > now())
    AND kc.embedding IS NOT NULL
  ORDER BY
    kc.priority DESC,
    kc.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.classify_user_type IS 'v2: KB 기반 사용자 유형 자동 분류 (seller/creator/educator/mixed)';
COMMENT ON FUNCTION public.search_knowledge IS 'v2: RAG 검색 — priority 우선 + 코사인 유사도';
