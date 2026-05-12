-- 018: 베타 프로그램 — 베타 기간 동안 모든 가입자에게 PRO 권한 무료 부여
--
-- Why: Ssobi 출시 초기 (Meta 검수 진행 중 + 카드뉴스 파이프라인 구현 중)
--   유저 시드 모집을 위해 2~3개월 베타 운영. 베타 종료 시 자동 FREE 다운그레이드.
--
-- 가격 정책: ~/.claude/projects/-Users-yuminhye/memory/project_ssobi_pricing.md
-- 로드맵: Phase 1.5 — 베타 모드 + 백오피스 + 마케팅 자동화

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS beta BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS beta_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS beta_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS beta_notified_7d BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS beta_notified_1d BOOLEAN NOT NULL DEFAULT false;

-- 베타 종료 임박 cron 빠른 조회용
CREATE INDEX IF NOT EXISTS idx_profiles_beta_ends
  ON public.profiles(beta_ends_at)
  WHERE beta = true AND beta_ends_at IS NOT NULL;

-- 베타 가입자 통계용 (백오피스 코호트 분석)
CREATE INDEX IF NOT EXISTS idx_profiles_beta_started
  ON public.profiles(beta_started_at)
  WHERE beta = true;

-- 베타 자동 가입 트리거 — 신규 가입자에게 자동으로 beta 권한 부여
--   beta_ends_at 은 ENABLE_BETA 환경변수 + 기간 (BETA_DURATION_DAYS) 기준
--   환경변수 없으면 90일 (3개월) 기본
--   베타 종료 시점 (BETA_END_DATE) 이후 가입자는 베타 미적용 — 이건 app 코드에서 처리
--
-- 단순화: 가입 시 자동 beta=true + 종료 시점은 BETA_END_DATE (env) 또는 가입일+90일
-- 정책 변경 가능성 위해 트리거 대신 app 단 bootstrapUser 에서 처리 권장
--
-- 여기선 컬럼만 추가. 가입 시 beta 부여 로직은 src/app/api/auth/callback/route.ts 에서 처리.