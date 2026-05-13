-- 023: 콘텐츠 → 가입 attribution
--
-- Why: Ssobi 자체 마케팅의 핵심 KPI 는 "콘텐츠 1개당 가입 수".
--   각 marketing_posts 발행 시 short_link 자동 발급 + 본문 삽입.
--   유저가 클릭하면 /s/[code] → cookie set → 가입 시 source 기록.
--
-- 흐름:
--   1. marketing_posts INSERT → trigger 가 short_link 자동 생성 + post.short_code 채움
--   2. 발행 본문 끝에 ssobi.ai/s/[code] 자동 삽입
--   3. /s/[code] route → cookie `ssobi_attr=[code]` set (90일)
--   4. /api/auth/callback (가입 시) → cookie 읽어 profiles.signup_source_code 기록
--   5. admin/marketing GET → post 별 click_count + signup_count 집계

-- ─────────────────────────────────────────────────────────────────
-- 1) short_links 에 marketing_post_id 컬럼
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE public.short_links
  ADD COLUMN IF NOT EXISTS marketing_post_id UUID REFERENCES public.marketing_posts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_short_links_marketing_post
  ON public.short_links(marketing_post_id)
  WHERE marketing_post_id IS NOT NULL;

-- short_links.user_id 는 NOT NULL 이라 admin 전용 short_link 도 user_id 가 필요.
-- 페르소나용 short_link 는 created_by 어드민 id 를 user_id 로 박을 거.

-- ─────────────────────────────────────────────────────────────────
-- 2) marketing_posts 에 short_code 컬럼 (편의)
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE public.marketing_posts
  ADD COLUMN IF NOT EXISTS short_code TEXT REFERENCES public.short_links(code) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_posts_short_code
  ON public.marketing_posts(short_code)
  WHERE short_code IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────
-- 3) profiles 에 attribution 기록
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signup_source_code TEXT,
  ADD COLUMN IF NOT EXISTS signup_source_post_id UUID REFERENCES public.marketing_posts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_signup_source_post
  ON public.profiles(signup_source_post_id)
  WHERE signup_source_post_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────
-- 4) RPC — marketing_posts 별 KPI 한 번에 집계
--    (post 수가 많아져도 N+1 쿼리 방지)
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.marketing_post_kpis()
RETURNS TABLE(
  post_id UUID,
  short_code TEXT,
  click_count INT,
  signup_count INT
) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    mp.id AS post_id,
    mp.short_code,
    COALESCE(sl.click_count, 0) AS click_count,
    COALESCE(
      (SELECT COUNT(*)::INT FROM public.profiles p WHERE p.signup_source_post_id = mp.id),
      0
    ) AS signup_count
  FROM public.marketing_posts mp
  LEFT JOIN public.short_links sl ON sl.code = mp.short_code
  ORDER BY mp.created_at DESC;
$$;

COMMENT ON FUNCTION public.marketing_post_kpis IS
  '콘텐츠별 클릭·가입 수 (admin 대시보드용)';
