-- 016: 약관·마케팅 동의 + 카테고리 (가입 플로우 보강)
--
-- 가입 시점에 명시적 약관 동의 (PIPA 컴플라이언스) + 선택적 마케팅 수신 동의 +
-- 콘텐츠 추천에 쓸 카테고리(다중) 저장.
--
-- categories: 뷰티/패션/푸드/운동/IT-테크/라이프/여행/육아/펫/기타 등 다중 (max 3 권장, 클라이언트 enforce)
-- marketing_consent: 마케팅·프로모션 메일·SMS 수신 동의
-- tos_accepted_at: 약관 동의 시각 (가입 시 set)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS categories JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS tos_accepted_at TIMESTAMPTZ;

-- 인덱스 — 카테고리별 유저 검색 (캠페인·트렌드 추천 시 사용)
CREATE INDEX IF NOT EXISTS profiles_categories_gin
  ON public.profiles USING gin (categories);
