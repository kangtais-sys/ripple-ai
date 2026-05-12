// Ssobi 4단계 멤버십 (2026-05-12 확정)
//   FREE / STARTER / PRO / TEAM
//
// DB enum 매핑 (migration 회피, 기존 컬럼 그대로 재용도):
//   free     → FREE
//   basic    → STARTER (예전 '베이직' 동의어였으나 가입자 0명이라 재용도)
//   premium  → PRO
//   business → TEAM (예전 '프로페셔널', 가입자 0명이라 다운그레이드 안전)
//
// source of truth: landing.html 가격표 · app.html m-plan 모달 · 모든 한도 체크
// 변경 시 동기화: plans.ts → landing.html → app.html (m-plan 모달)
//
// 가격 정책 메모: /Users/yuminhye/.claude/projects/-Users-yuminhye/memory/project_ssobi_pricing.md

export type PlanKey = 'free' | 'basic' | 'premium' | 'business'
export type Currency = 'KRW' | 'USD'

export interface PlanDef {
  // 표시
  tier: 'FREE' | 'STARTER' | 'PRO' | 'TEAM'
  name: string       // 한국어 표시명
  nameEn: string     // 영어 표시명

  // 가격
  priceKrw: number   // 0 / 9900 / 29900 / 79000
  priceUsd: number   // 0 / 7.99 / 22.99 / 59.99

  // 한도 — usage_logs 의 comment+DM 월 합산
  limit: number      // Infinity = 무제한 (Meta 정책 한도까지)

  // 연동 SNS 계정 수
  accountLimit: number

  // 카드뉴스 (Phase 2 — 파이프라인 구현 후 활성)
  cardnewsMonthly: number       // -1 = 무제한
  cardnewsWatermark: boolean    // free 만 true

  // AI 톤 학습 횟수
  toneLearningMonthly: number   // -1 = 무제한

  // 링크 페이지 게이팅
  linkPremiumBlocks: boolean      // 카운트다운/제품그리드/빅배너/매거진
  linkPremiumTemplates: boolean   // editorial 등

  // 예약 발행
  scheduledPublish: boolean

  // 이미지 업로드 (Phase 2)
  imageUploadLimit: number  // -1 = 무제한
  imageMaxMb: number        // 1장당 최대 용량

  // 팀 (Phase 3 — TEAM 전용)
  teamMembers: number       // 0 = 솔로
}

export const PLANS: Record<PlanKey, PlanDef> = {
  free: {
    tier: 'FREE',
    name: 'FREE',
    nameEn: 'FREE',
    priceKrw: 0,
    priceUsd: 0,
    limit: 300,
    accountLimit: 1,
    cardnewsMonthly: 5,
    cardnewsWatermark: true,
    toneLearningMonthly: 1,
    linkPremiumBlocks: false,
    linkPremiumTemplates: false,
    scheduledPublish: false,
    imageUploadLimit: 5,
    imageMaxMb: 2,
    teamMembers: 0,
  },
  basic: {
    tier: 'STARTER',
    name: 'STARTER',
    nameEn: 'STARTER',
    priceKrw: 9900,
    priceUsd: 7.99,
    limit: 3000,
    accountLimit: 1,
    cardnewsMonthly: 50,
    cardnewsWatermark: false,
    toneLearningMonthly: 4,
    linkPremiumBlocks: true,
    linkPremiumTemplates: true,
    scheduledPublish: true,
    imageUploadLimit: 20,
    imageMaxMb: 5,
    teamMembers: 0,
  },
  premium: {
    tier: 'PRO',
    name: 'PRO',
    nameEn: 'PRO',
    priceKrw: 29900,
    priceUsd: 22.99,
    limit: 30000,
    accountLimit: 1,
    cardnewsMonthly: 200,
    cardnewsWatermark: false,
    toneLearningMonthly: -1,
    linkPremiumBlocks: true,
    linkPremiumTemplates: true,
    scheduledPublish: true,
    imageUploadLimit: -1,
    imageMaxMb: 10,
    teamMembers: 0,
  },
  business: {
    tier: 'TEAM',
    name: 'TEAM',
    nameEn: 'TEAM',
    priceKrw: 79000,
    priceUsd: 59.99,
    limit: Infinity,
    accountLimit: 3,
    cardnewsMonthly: -1,
    cardnewsWatermark: false,
    toneLearningMonthly: -1,
    linkPremiumBlocks: true,
    linkPremiumTemplates: true,
    scheduledPublish: true,
    imageUploadLimit: -1,
    imageMaxMb: 10,
    teamMembers: 3,
  },
}

export function getPlan(plan: string): PlanDef {
  return PLANS[plan as PlanKey] || PLANS.free
}

// 베타 프로그램 — 베타 기간 동안 모든 가입자에게 PRO 권한 효과
//   profile.beta = true + beta_ends_at 미경과 → 'premium' 으로 취급
//   카드뉴스 한도·이미지·링크 게이팅 모두 PRO 기준 적용
//   TEAM 의 3계정/3멤버 같은 상위 기능은 베타로 안 풀어줌
export interface BetaSignals {
  plan?: string | null
  beta?: boolean | null
  beta_ends_at?: string | Date | null
}

export function isBetaActive(p: BetaSignals): boolean {
  if (!p.beta) return false
  if (!p.beta_ends_at) return true // ends_at 없으면 무기한 베타
  const ends = typeof p.beta_ends_at === 'string' ? new Date(p.beta_ends_at) : p.beta_ends_at
  return ends.getTime() > Date.now()
}

// 모든 게이팅 체크 진입점 — DB plan 그대로가 아니라 effective plan 사용
export function getEffectivePlanKey(p: BetaSignals): PlanKey {
  if (isBetaActive(p)) return 'premium'
  const k = (p.plan || 'free') as PlanKey
  return PLANS[k] ? k : 'free'
}

export function getEffectivePlan(p: BetaSignals): PlanDef {
  return PLANS[getEffectivePlanKey(p)]
}

export function isOverLimit(plan: string, commentCount: number, dmCount: number): boolean {
  return (commentCount + dmCount) >= getPlan(plan).limit
}

export function getUsagePercent(plan: string, commentCount: number, dmCount: number): number {
  const p = getPlan(plan)
  if (p.limit === Infinity) return 0
  return Math.min(100, Math.round(((commentCount + dmCount) / p.limit) * 100))
}

// 가격 헬퍼 — 통화 분기 호출부에서 사용
export function getPrice(plan: string, currency: Currency): number {
  const p = getPlan(plan)
  return currency === 'USD' ? p.priceUsd : p.priceKrw
}

// 마케팅 tier 명 → DB enum 역매핑 (UI 에서 'STARTER' 선택 시 'basic' 으로 저장)
export const TIER_TO_ENUM: Record<PlanDef['tier'], PlanKey> = {
  FREE: 'free',
  STARTER: 'basic',
  PRO: 'premium',
  TEAM: 'business',
}

// Stripe Price ID 매핑 (USD 결제 시 사용) — env 에서 주입
export function getStripePriceId(plan: PlanKey): string | undefined {
  switch (plan) {
    case 'basic':    return process.env.STRIPE_PRICE_STARTER
    case 'premium':  return process.env.STRIPE_PRICE_PRO
    case 'business': return process.env.STRIPE_PRICE_TEAM
    default:         return undefined
  }
}
