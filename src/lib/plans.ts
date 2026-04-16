export const PLANS = {
  free: { name: '무료', limit: 100, price: 0 },
  basic: { name: '베이직', limit: 3300, price: 29000 },
  premium: { name: '프리미엄', limit: 6600, price: 59000 },
  business: { name: '비즈니스', limit: Infinity, price: 129000 },
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
