// 3단계 표기 (베이직·프리미엄·프로페셔널)
// DB enum 은 free/basic/premium/business 유지 (migration 회피)
// free·basic 둘 다 '베이직' 으로 표기 (추후 비즈니스 단계 복귀 시 쉽게 분리)
// 한도·가격은 기존 유지 — 추후 조정 시 여기만 수정
export const PLANS = {
  free: { name: '베이직', limit: 100, price: 0 },
  basic: { name: '베이직', limit: 3300, price: 29000 },
  premium: { name: '프리미엄', limit: 6600, price: 59000 },
  business: { name: '프로페셔널', limit: Infinity, price: 129000 },
} as const

export type PlanKey = keyof typeof PLANS

export function isOverLimit(plan: string, commentCount: number, dmCount: number): boolean {
  const p = PLANS[plan as PlanKey] || PLANS.free
  return (commentCount + dmCount) >= p.limit
}

export function getUsagePercent(plan: string, commentCount: number, dmCount: number): number {
  const p = PLANS[plan as PlanKey] || PLANS.free
  if (p.limit === Infinity) return 0
  return Math.min(100, Math.round(((commentCount + dmCount) / p.limit) * 100))
}
