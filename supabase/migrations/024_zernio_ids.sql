-- 024: Zernio profile/account ID 매핑
--
-- Why: 발행 시 Zernio API 가 각 SNS 계정을 accountId 로 식별.
--   페르소나 = Zernio profile, 채널 계정 = Zernio account 로 1:1 매핑.

ALTER TABLE public.marketing_personas
  ADD COLUMN IF NOT EXISTS zernio_profile_id TEXT;

ALTER TABLE public.marketing_persona_accounts
  ADD COLUMN IF NOT EXISTS zernio_account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_personas_zernio
  ON public.marketing_personas(zernio_profile_id)
  WHERE zernio_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_persona_accounts_zernio
  ON public.marketing_persona_accounts(zernio_account_id)
  WHERE zernio_account_id IS NOT NULL;
