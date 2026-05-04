-- Phase 1: 자동 응대 통제권 (Meta App Review 통과 + 운영 통제권)
--   1) profiles.auto_reply_enabled — 글로벌 ON/OFF
--   2) profiles.auto_reply_channels — 채널별 토글 (ig_comment / ig_dm 등)
--   3) profiles.app_language — i18n 언어 설정 (ko / en / ja 추후)
--   4) dm_threads — DM 대화별 takeover 추적 (특정 고객만 자동 응대 중단)

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS auto_reply_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_reply_channels JSONB NOT NULL DEFAULT '{"ig_comment": true, "ig_dm": true, "tiktok_comment": false, "yt_comment": false}'::jsonb,
  ADD COLUMN IF NOT EXISTS app_language TEXT NOT NULL DEFAULT 'ko' CHECK (app_language IN ('ko', 'en', 'ja'));

-- DM thread takeover — 특정 고객 thread 만 자동 응대 중단
--   상대방 IG user ID 기준 (사용자 + 상대 조합으로 unique)
CREATE TABLE IF NOT EXISTS dm_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ig_account_id UUID NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  remote_ig_user_id TEXT NOT NULL,        -- 상대방 IG ID
  remote_username TEXT,                    -- 표시용
  takeover_active BOOLEAN NOT NULL DEFAULT FALSE,
  takeover_started_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, ig_account_id, remote_ig_user_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_threads_user ON dm_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_dm_threads_takeover ON dm_threads(takeover_active) WHERE takeover_active = TRUE;

-- RLS — 본인 thread 만 접근
ALTER TABLE dm_threads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dm_threads_self_select ON dm_threads;
CREATE POLICY dm_threads_self_select ON dm_threads
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS dm_threads_self_update ON dm_threads;
CREATE POLICY dm_threads_self_update ON dm_threads
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS dm_threads_self_insert ON dm_threads;
CREATE POLICY dm_threads_self_insert ON dm_threads
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- service_role 은 RLS 우회 (webhook 처리용)
GRANT ALL ON dm_threads TO service_role;
