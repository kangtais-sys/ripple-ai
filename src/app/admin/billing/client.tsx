'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface UsageRow {
  cardnews_jobs_this_month: number
  reply_logs_this_month: number
  higgsfield_assets_this_month: number
  higgsfield_credits_balance: number | null
}

// 인프라 고정 비용 (월 단위, USD 기준)
const FIXED_COSTS = [
  { name: 'Vercel Pro', monthly_usd: 20, note: 'Fluid Compute · 1TB egress · cron' },
  { name: 'Supabase Pro', monthly_usd: 25, note: 'Postgres + Auth + Storage (8GB)' },
  { name: 'ssobi.ai 도메인', monthly_usd: 1.5, note: '연 ~$18 / 12개월' },
]

// 변동 비용 (사용량 기반 추정 단가)
const VARIABLE_UNIT_COSTS = {
  claude_sonnet_per_call_usd: 0.015,   // 카드뉴스 1회 평균 토큰 추정
  claude_haiku_per_reply_usd: 0.0008,  // 응대 1건 평균
  higgsfield_per_image_usd: 0.05,      // Soul Standard 추정 (실제 크레딧 ÷ 환율)
}

export default function BillingClient() {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'denied'; reason: 'unauthenticated' | 'not_admin' }
    | { kind: 'ok'; usage: UsageRow; email: string }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: sessionData } = await sb.auth.getSession()
        const token = sessionData.session?.access_token
        if (!token) {
          if (!cancelled) setState({ kind: 'denied', reason: 'unauthenticated' })
          return
        }
        const res = await fetch('/api/admin/billing', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const j = await res.json()
        if (!res.ok) {
          if (j.error === 'forbidden') {
            if (!cancelled) setState({ kind: 'denied', reason: 'not_admin' })
            return
          }
          if (!cancelled) setState({ kind: 'denied', reason: 'unauthenticated' })
          return
        }
        if (!cancelled) setState({ kind: 'ok', usage: j.usage, email: j.email })
      } catch (e) {
        if (!cancelled) setState({ kind: 'error', message: String(e) })
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (state.kind === 'loading') return <div className="py-16 text-center text-white/40">로딩 중...</div>
  if (state.kind === 'denied') {
    return (
      <div className="py-16 text-center text-white/60">
        {state.reason === 'unauthenticated' ? '로그인이 필요합니다.' : '관리자 권한이 없습니다.'}
      </div>
    )
  }
  if (state.kind === 'error') {
    return <div className="py-16 text-red-400 font-mono text-[12px] text-center">{state.message}</div>
  }

  const u = state.usage
  const fixedTotalUsd = FIXED_COSTS.reduce((s, c) => s + c.monthly_usd, 0)
  const claudeContentCost = u.cardnews_jobs_this_month * VARIABLE_UNIT_COSTS.claude_sonnet_per_call_usd
  const claudeReplyCost = u.reply_logs_this_month * VARIABLE_UNIT_COSTS.claude_haiku_per_reply_usd
  const higgsfieldCost = u.higgsfield_assets_this_month * VARIABLE_UNIT_COSTS.higgsfield_per_image_usd
  const variableTotalUsd = claudeContentCost + claudeReplyCost + higgsfieldCost
  const grandTotalUsd = fixedTotalUsd + variableTotalUsd

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight mb-1">비용관리</h1>
          <p className="text-[13px] text-white/50">이번 달 인프라 + 변동 비용 추정치 · USD</p>
        </div>
        <div className="text-[11px] text-white/40">{state.email}</div>
      </div>

      {/* 총합 */}
      <section className="rounded-2xl bg-gradient-to-br from-[#00C896]/15 to-[#00C896]/5 border border-[#00C896]/20 p-6">
        <div className="text-[11px] font-bold uppercase tracking-wider text-[#00C896] mb-2">이번 달 총 추정 비용</div>
        <div className="text-4xl font-black tracking-tight text-white">${grandTotalUsd.toFixed(2)}</div>
        <div className="text-[12px] text-white/50 mt-2">
          고정 ${fixedTotalUsd.toFixed(2)} + 변동 ${variableTotalUsd.toFixed(2)}
        </div>
      </section>

      {/* 고정 비용 */}
      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/60 mb-3">
          고정 비용 (월 ${fixedTotalUsd.toFixed(2)})
        </h2>
        <div className="space-y-2">
          {FIXED_COSTS.map((c) => (
            <div key={c.name} className="flex items-center justify-between rounded-xl bg-white/[0.03] border border-white/5 p-4">
              <div>
                <div className="text-[14px] font-bold">{c.name}</div>
                <div className="text-[11.5px] text-white/40 mt-0.5">{c.note}</div>
              </div>
              <div className="text-[15px] font-black text-white">${c.monthly_usd.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 변동 비용 */}
      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/60 mb-3">
          변동 비용 (이번 달 ${variableTotalUsd.toFixed(2)})
        </h2>
        <div className="space-y-2">
          <UsageRow
            name="Claude Sonnet 4.5"
            sub="카드뉴스·페르소나 콘텐츠 생성"
            count={u.cardnews_jobs_this_month}
            unit="회"
            unitCost={VARIABLE_UNIT_COSTS.claude_sonnet_per_call_usd}
            total={claudeContentCost}
          />
          <UsageRow
            name="Claude Haiku 4.5"
            sub="댓글/DM 응대 (webhook)"
            count={u.reply_logs_this_month}
            unit="건"
            unitCost={VARIABLE_UNIT_COSTS.claude_haiku_per_reply_usd}
            total={claudeReplyCost}
          />
          <UsageRow
            name="Higgsfield"
            sub="페르소나 이미지·비디오 생성"
            count={u.higgsfield_assets_this_month}
            unit="장"
            unitCost={VARIABLE_UNIT_COSTS.higgsfield_per_image_usd}
            total={higgsfieldCost}
          />
        </div>
        {u.higgsfield_credits_balance !== null && (
          <div className="mt-3 text-[11.5px] text-white/40">
            Higgsfield 잔여 크레딧: <span className="text-amber-300 font-bold">{u.higgsfield_credits_balance}</span>
          </div>
        )}
      </section>

      <footer className="text-[11px] text-white/30 pt-8 border-t border-white/5">
        ※ 변동 단가는 추정치 · 실제 청구는 각 provider 대시보드 기준
      </footer>
    </div>
  )
}

function UsageRow({
  name, sub, count, unit, unitCost, total,
}: { name: string; sub: string; count: number; unit: string; unitCost: number; total: number }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/5 p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-[14px] font-bold">{name}</div>
          <div className="text-[11.5px] text-white/40 mt-0.5">{sub}</div>
        </div>
        <div className="text-[15px] font-black text-white">${total.toFixed(2)}</div>
      </div>
      <div className="text-[11px] text-white/40 font-mono">
        {count.toLocaleString()}{unit} × ${unitCost} = ${total.toFixed(2)}
      </div>
    </div>
  )
}
