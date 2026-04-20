// 3단계 요금제 (베이직·프리미엄·프로페셔널)
// 가격·한도는 landing.html PRICING 섹션과 완전 일치
// DB enum 은 free/basic/premium/business 유지 (migration 회피)
//   free·basic 둘 다 '베이직'으로 표기 (history 데이터 호환)
//   business 슬롯은 '프로페셔널' 로 표기 (추후 '비즈니스' 4단계 복귀 가능)
export const PLANS = {
  free:     { name: '베이직',       limit: 300,       price: 0,     accountLimit: 1  },
  basic:    { name: '베이직',       limit: 300,       price: 0,     accountLimit: 1  },
  premium:  { name: '프리미엄',     limit: 6600,      price: 29800, accountLimit: 3  },
  business: { name: '프로페셔널',   limit: Infinity,  price: 69800, accountLimit: 10 },
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
