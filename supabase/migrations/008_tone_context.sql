-- 유저 응대 컨텍스트 (금지어 + 브랜드/제품 정보) 추가
-- AI 초안 생성 시 말투 외에 이 정보를 추가 주입해서 브랜드 일관성 유지

ALTER TABLE public.tone_profiles
  ADD COLUMN IF NOT EXISTS banned_words JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS brand_context TEXT;

COMMENT ON COLUMN public.tone_profiles.banned_words IS
  '유저가 AI 응대에서 사용 금지한 표현 배열 (예: ["고객님","부탁드립니다"])';
COMMENT ON COLUMN public.tone_profiles.brand_context IS
  '브랜드·제품·채널 정보. AI 응대 system prompt 에 주입 (예: "Millimilli 공식 사이트 millimilli.co · 카카오 @millimilli")';
