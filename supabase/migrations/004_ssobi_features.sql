-- Ssobi v2 기능 스키마: 내 링크 / 카드뉴스 / 숏링크 / 수익제안 / 예약 / 내 템플릿

-- ═══════════════════════════════════════════════════════════════════
-- 1. 내 링크 페이지 (link-in-bio)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.link_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  handle TEXT UNIQUE NOT NULL CHECK (handle ~ '^[a-z0-9_-]{3,30}$'),
  hero JSONB DEFAULT '{}'::jsonb,           -- 히어로 캐러셀 (slides[])
  theme JSONB DEFAULT '{}'::jsonb,          -- 배경·폰트·색상
  settings JSONB DEFAULT '{}'::jsonb,       -- 다국어·숏링크·Powered by 토글
  blocks JSONB DEFAULT '[]'::jsonb,         -- 블록 배열 (14종)
  view_count INT DEFAULT 0,
  published BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_link_pages_user ON public.link_pages(user_id);
CREATE INDEX idx_link_pages_handle ON public.link_pages(handle) WHERE published = true;

-- 방문자 제안(Contact) 수신함
CREATE TABLE public.link_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_page_id UUID REFERENCES public.link_pages(id) ON DELETE CASCADE,
  from_name TEXT,
  from_email TEXT,
  from_handle TEXT,
  message TEXT NOT NULL,
  kind TEXT CHECK (kind IN ('collab','ad','question','other')),
  read BOOLEAN DEFAULT false,
  ip_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_link_proposals_page ON public.link_proposals(link_page_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════
-- 2. 숏링크
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.short_links (
  code TEXT PRIMARY KEY CHECK (code ~ '^[a-zA-Z0-9]{4,12}$'),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  link_page_id UUID REFERENCES public.link_pages(id) ON DELETE SET NULL,
  target_url TEXT NOT NULL,
  label TEXT,
  click_count INT DEFAULT 0,
  last_click_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_short_links_user ON public.short_links(user_id, created_at DESC);

CREATE TABLE public.short_link_clicks (
  id BIGSERIAL PRIMARY KEY,
  code TEXT REFERENCES public.short_links(code) ON DELETE CASCADE,
  clicked_at TIMESTAMPTZ DEFAULT now(),
  referer TEXT,
  user_agent TEXT,
  country TEXT,
  ip_hash TEXT
);
CREATE INDEX idx_short_clicks_code ON public.short_link_clicks(code, clicked_at DESC);

-- ═══════════════════════════════════════════════════════════════════
-- 3. 카드뉴스 생성 잡 (Claude 생성 이력)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.card_news_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  topic TEXT NOT NULL,
  prompt_hook TEXT,
  prompt_body JSONB,                        -- [{title, text}...]
  prompt_caption TEXT,
  template TEXT,                            -- clean/bold/mint/mag/pop/editorial/mono/pastel/custom
  slide_count INT DEFAULT 5,
  size TEXT DEFAULT 'sq',                   -- sq/pt/st/ls
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','failed')),
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  channels JSONB DEFAULT '[]'::jsonb,       -- ['ig','tk','yt']
  meta JSONB DEFAULT '{}'::jsonb,           -- 생성 메타 (tokens, model 등)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_cnj_user_status ON public.card_news_jobs(user_id, status, created_at DESC);
CREATE INDEX idx_cnj_scheduled ON public.card_news_jobs(scheduled_at) WHERE status = 'scheduled';

-- ═══════════════════════════════════════════════════════════════════
-- 4. 내 템플릿 (카드뉴스 커스텀 템플릿)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.user_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT DEFAULT 'My Template',
  bg TEXT,                                  -- linear-gradient(...) 또는 color
  logo_url TEXT,
  font_title TEXT DEFAULT 'Pretendard',
  font_body TEXT DEFAULT 'Pretendard',
  elements JSONB DEFAULT '[]'::jsonb,       -- 배치된 요소들
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_user_templates_user ON public.user_templates(user_id);

-- ═══════════════════════════════════════════════════════════════════
-- 5. 참고 계정 / 해시태그 (말투 학습 보조)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE public.reference_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  handle TEXT NOT NULL,
  platform TEXT CHECK (platform IN ('ig','tk','yt','other')),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, handle, platform)
);
CREATE INDEX idx_ref_accounts_user ON public.reference_accounts(user_id);

-- ═══════════════════════════════════════════════════════════════════
-- 6. 첫날 온보딩 상태
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ig_linked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tone_learned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ref_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kakao_linked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS link_handle TEXT UNIQUE;

-- ═══════════════════════════════════════════════════════════════════
-- RLS 활성화 & 정책
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.link_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.short_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.short_link_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_news_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_accounts ENABLE ROW LEVEL SECURITY;

-- 링크 페이지: 소유자는 전체 CRUD, 공개된 페이지는 누구나 read
CREATE POLICY "Owner manages own link_pages" ON public.link_pages FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Public reads published link_pages" ON public.link_pages FOR SELECT USING (published = true);

-- 제안: 소유자만 read, 누구나 insert
CREATE POLICY "Owner reads own proposals" ON public.link_proposals FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.link_pages lp WHERE lp.id = link_page_id AND lp.user_id = auth.uid()));
CREATE POLICY "Owner updates own proposals" ON public.link_proposals FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.link_pages lp WHERE lp.id = link_page_id AND lp.user_id = auth.uid()));
CREATE POLICY "Anyone submits proposal" ON public.link_proposals FOR INSERT WITH CHECK (true);

-- 숏링크: 소유자 CRUD, 누구나 read(리다이렉트용)
CREATE POLICY "Owner manages own short_links" ON public.short_links FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Public resolves short_links" ON public.short_links FOR SELECT USING (true);

-- 숏링크 클릭: service_role만 insert (서버), 소유자만 read
CREATE POLICY "Owner reads own clicks" ON public.short_link_clicks FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.short_links sl WHERE sl.code = short_link_clicks.code AND sl.user_id = auth.uid()));

-- 카드뉴스: 소유자만
CREATE POLICY "Owner manages own card_news" ON public.card_news_jobs FOR ALL USING (auth.uid() = user_id);

-- 내 템플릿: 소유자만
CREATE POLICY "Owner manages own templates" ON public.user_templates FOR ALL USING (auth.uid() = user_id);

-- 참고 계정: 소유자만
CREATE POLICY "Owner manages own ref_accounts" ON public.reference_accounts FOR ALL USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════
-- updated_at 자동 갱신 트리거 (공용)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_link_pages_updated BEFORE UPDATE ON public.link_pages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tr_card_news_updated BEFORE UPDATE ON public.card_news_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tr_templates_updated BEFORE UPDATE ON public.user_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════
-- 숏링크 클릭 카운트 증가 RPC (공개 호출용)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.track_short_click(
  p_code TEXT,
  p_referer TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_ip_hash TEXT DEFAULT NULL
) RETURNS TEXT AS $$
DECLARE
  v_target TEXT;
BEGIN
  UPDATE public.short_links
    SET click_count = click_count + 1, last_click_at = now()
    WHERE code = p_code
    RETURNING target_url INTO v_target;
  IF v_target IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.short_link_clicks (code, referer, user_agent, country, ip_hash)
    VALUES (p_code, p_referer, p_user_agent, p_country, p_ip_hash);
  RETURN v_target;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.track_short_click TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- 핸들 기반 링크 페이지 조회 RPC (SSR용)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_link_page(p_handle TEXT)
RETURNS SETOF public.link_pages AS $$
  SELECT * FROM public.link_pages WHERE handle = p_handle AND published = true LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_link_page TO anon, authenticated;
