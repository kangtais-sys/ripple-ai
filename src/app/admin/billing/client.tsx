'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface UsageRow {
  reply_logs_this_month: number
  voyage_embeddings_this_month: number
}

// 인프라 고정 비용 (월 단위, USD 기준)
const FIXED_COSTS = [
  { name: 'Vercel Pro', monthly_usd: 20, note: 'Fluid Compute · 1TB egress · cron' },
  { name: 'Supabase Pro', monthly_usd: 25, note: 'Postgres + pgvector + Auth + Storage' },
  { name: 'ssobi.ai 도메인', monthly_usd: 1.5, note: '연 ~$18 / 12개월' },
]

// 변동 비용 (사용량 기반 추정 단가)
const VARIABLE_UNIT_COSTS = {
  claude_haiku_per_reply_usd: 0.0008,    // 응대 1건 평균
  voyage_embedding_per_1k_usd: 0.0001,   // voyage-3-lite $0.02/M tokens 가정 평균 청크 500 tokens
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

  if (state.kind === 'loading') return <div className="py-16 text-center text-gray-500">로딩 중...</div>
  if (state.kind === 'denied') {
    return (
      <div className="py-16 text-center text-gray-700">
        {state.reason === 'unauthenticated' ? '로그인이 필요합니다.' : '관리자 권한이 없습니다.'}
      </div>
    )
  }
  if (state.kind === 'error') {
    return <div className="py-16 text-red-600 font-mono text-[12px] text-center">{state.message}</div>
  }

  const u = state.usage
  const fixedTotalUsd = FIXED_COSTS.reduce((s, c) => s + c.monthly_usd, 0)
  const claudeReplyCost = u.reply_logs_this_month * VARIABLE_UNIT_COSTS.claude_haiku_per_reply_usd
  const voyageCost = u.voyage_embeddings_this_month * VARIABLE_UNIT_COSTS.voyage_embedding_per_1k_usd
  const variableTotalUsd = claudeReplyCost + voyageCost
  const grandTotalUsd = fixedTotalUsd + variableTotalUsd

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight mb-1">비용관리</h1>
          <p className="text-[13px] text-gray-500">이번 달 인프라 + 변동 비용 추정치 · USD</p>
        </div>
        <div className="text-[11px] text-gray-500">{state.email}</div>
      </div>

      {/* 총합 */}
      <section className="rounded-2xl bg-gradient-to-br from-[#00C896]/10 to-[#00C896]/5 border border-[#00C896]/20 p-6">
        <div className="text-[11px] font-bold uppercase tracking-wider text-[#00C896] mb-2">이번 달 총 추정 비용</div>
        <div className="text-4xl font-black tracking-tight text-[#1A1F27]">${grandTotalUsd.toFixed(2)}</div>
        <div className="text-[12px] text-gray-500 mt-2">
          고정 ${fixedTotalUsd.toFixed(2)} + 변동 ${variableTotalUsd.toFixed(2)}
        </div>
      </section>

      {/* 고정 비용 */}
      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-gray-700 mb-3">
          고정 비용 (월 ${fixedTotalUsd.toFixed(2)})
        </h2>
        <div className="space-y-2">
          {FIXED_COSTS.map((c) => (
            <div key={c.name} className="flex items-center justify-between rounded-xl bg-white border border-gray-200 p-4">
              <div>
                <div className="text-[14px] font-bold">{c.name}</div>
                <div className="text-[11.5px] text-gray-500 mt-0.5">{c.note}</div>
              </div>
              <div className="text-[15px] font-black text-[#1A1F27]">${c.monthly_usd.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 변동 비용 */}
      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-gray-700 mb-3">
          변동 비용 (이번 달 ${variableTotalUsd.toFixed(2)})
        </h2>
        <div className="space-y-2">
          <UsageRow
            name="Claude Haiku 4.5"
            sub="댓글/DM 응대 (webhook)"
            count={u.reply_logs_this_month}
            unit="건"
            unitCost={VARIABLE_UNIT_COSTS.claude_haiku_per_reply_usd}
            total={claudeReplyCost}
          />
          <UsageRow
            name="Voyage AI 임베딩"
            sub="지식베이스 학습 (KB chunks)"
            count={u.voyage_embeddings_this_month}
            unit="청크"
            unitCost={VARIABLE_UNIT_COSTS.voyage_embedding_per_1k_usd}
            total={voyageCost}
          />
        </div>
      </section>

      <footer className="text-[11px] text-gray-400 pt-8 border-t border-gray-200">
        ※ 변동 단가는 추정치 · 실제 청구는 각 provider 대시보드 기준
      </footer>
    </div>
  )
}

function UsageRow({
  name, sub, count, unit, unitCost, total,
}: { name: string; sub: string; count: number; unit: string; unitCost: number; total: number }) {
  return (
    <div className="rounded-xl bg-white border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-[14px] font-bold">{name}</div>
          <div className="text-[11.5px] text-gray-500 mt-0.5">{sub}</div>
        </div>
        <div className="text-[15px] font-black text-[#1A1F27]">${total.toFixed(2)}</div>
      </div>
      <div className="text-[11px] text-gray-500 font-mono">
        {count.toLocaleString()}{unit} × ${unitCost} = ${total.toFixed(2)}
      </div>
    </div>
  )
}
