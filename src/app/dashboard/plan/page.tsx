'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PLANS, type PlanKey, getUsagePercent } from '@/lib/plans'

export default function PlanPage() {
  const [currentPlan, setCurrentPlan] = useState<PlanKey>('free')
  const [usage, setUsage] = useState({ comments: 0, dms: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const month = new Date().toISOString().slice(0, 7)
      const [{ data: profile }, { data: usageData }] = await Promise.all([
        supabase.from('profiles').select('plan').eq('id', user.id).single(),
        supabase.from('usage_logs').select('comment_count, dm_count').eq('user_id', user.id).eq('month', month).single(),
      ])

      setCurrentPlan((profile?.plan || 'free') as PlanKey)
      setUsage({ comments: usageData?.comment_count || 0, dms: usageData?.dm_count || 0 })
      setLoading(false)
    }
    load()
  }, [])

  const total = usage.comments + usage.dms
  const percent = getUsagePercent(currentPlan, usage.comments, usage.dms)
  const planInfo = PLANS[currentPlan]

  async function handleSubscribe(plan: PlanKey) {
    if (!process.env.NEXT_PUBLIC_PORTONE_STORE_ID) {
      alert('결제 시스템 준비 중입니다. 곧 오픈됩니다!')
      return
    }
    // 포트원 SDK 빌링키 발급 → /api/payment/subscribe 호출
    // 실제 구현은 포트원 가입 후 진행
    alert(`${PLANS[plan].name} 플랜 결제 페이지로 이동합니다`)
  }

  if (loading) return <div className="p-8 text-center text-gray-400">로딩 중...</div>

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-[#1A1F27]">이용권</h1>

      {/* 현재 사용량 */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="flex justify-between items-center mb-2">
          <p className="text-sm font-semibold text-[#1A1F27]">이번 달 사용량</p>
          <span className="text-xs font-medium text-gray-500">
            {planInfo.name} 플랜
          </span>
        </div>
        <div className="flex items-end gap-1 mb-3">
          <span className="text-2xl font-bold text-[#1A1F27]">{total.toLocaleString()}</span>
          <span className="text-sm text-gray-400 mb-0.5">
            / {planInfo.limit === Infinity ? '무제한' : planInfo.limit.toLocaleString()}건
          </span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${percent >= 90 ? 'bg-red-500' : percent >= 70 ? 'bg-yellow-500' : 'bg-[#00C896]'}`}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-400">
          <span>댓글 {usage.comments}건 / DM {usage.dms}건</span>
          <span>{percent}%</span>
        </div>
        {percent >= 80 && (
          <p className="mt-2 text-xs text-red-500 font-medium">
            한도의 {percent}%를 사용했습니다. 플랜 업그레이드를 권장합니다.
          </p>
        )}
      </div>

      {/* 플랜 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(['basic', 'premium', 'business'] as PlanKey[]).map(key => {
          const p = PLANS[key]
          const isCurrent = currentPlan === key
          return (
            <div
              key={key}
              className={`rounded-xl border p-5 ${isCurrent ? 'border-[#00C896] bg-[#00C896]/5' : 'border-gray-100 bg-white'}`}
            >
              <p className="text-sm font-bold text-[#1A1F27]">{p.name}</p>
              <div className="mt-2 mb-3">
                <span className="text-2xl font-bold text-[#1A1F27]">
                  {p.price.toLocaleString()}
                </span>
                <span className="text-sm text-gray-400">원/월</span>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                월 {p.limit === Infinity ? '무제한' : `${p.limit.toLocaleString()}건`} 응대
              </p>
              {isCurrent ? (
                <div className="w-full py-2 rounded-lg bg-[#00C896]/10 text-[#00C896] font-semibold text-sm text-center">
                  현재 플랜
                </div>
              ) : (
                <button
                  onClick={() => handleSubscribe(key)}
                  className="w-full py-2 rounded-lg bg-[#1A1F27] text-white font-semibold text-sm hover:bg-gray-800 transition"
                >
                  {currentPlan === 'free' ? '시작하기' : '변경하기'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
