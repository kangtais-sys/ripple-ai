-- 025: ig_accounts 메타데이터 확장
--
-- Why: 메타 검수 시 instagram_business_basic 권한이 "username 만 가져온다" 가
--   아니라 account_type / media_count / profile picture 등 비즈니스 계정
--   메타데이터를 가져와 앱 내 화면에서 사용함을 명확히 보이기 위함.
--   또 키우기 탭의 "연동 계정" 카드에서 표시.

ALTER TABLE public.ig_accounts
  ADD COLUMN IF NOT EXISTS account_type TEXT,
  ADD COLUMN IF NOT EXISTS media_count INT,
  ADD COLUMN IF NOT EXISTS followers_count INT,
  ADD COLUMN IF NOT EXISTS profile_picture_url TEXT,
  ADD COLUMN IF NOT EXISTS metadata_synced_at TIMESTAMPTZ;
