'use client'

import { useEffect, useState } from 'react'
// app.html 이 window.supabase.createClient (localStorage 기반) 을 쓰니까
// 동일한 @supabase/supabase-js 로 통일. @supabase/ssr 의 createBrowserClient
// 는 쿠키 기반이라 app.html 세션을 못 읽음.
import { createClient } from '@supabase/supabase-js'
import type { AdminMetrics } from '@/lib/admin-metrics'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function GenerateNowButton() {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'running' }
    | { kind: 'success'; summary: string; details: unknown }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  async function generate() {
    setState({ kind: 'running' })
    try {
      const { data } = await sb.auth.getSession()
      const token = data.session?.access_token
      if (!token) { setState({ kind: 'error', message: '세션 만료' }); return }

      const res = await fetch('/api/admin/marketing/generate-now', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const j = await res.json()
      if (!res.ok || !j.ok) {
        setState({ kind: 'error', message: j.error || '실패' })
        return
      }
      const results = (j.results || []) as Array<{ generated?: Array<{ language: string; text_post_ids: string[]; asset_id: string | null }> }>
      let textCount = 0
      let visualCount = 0
      for (const r of results) {
        for (const g of r.generated || []) {
          textCount += g.text_post_ids?.length || 0
          if (g.asset_id) visualCount++
        }
      }
      setState({ kind: 'success', summary: `텍스트 ${textCount}개 · 비주얼 ${visualCount}장 (생성 중)`, details: j })
    } catch (e) {
      setState({ kind: 'error', message: String(e) })
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={generate}
        disabled={state.kind === 'running'}
        className="bg-[#00C896] hover:bg-[#00A87E] disabled:opacity-50 text-white font-bold px-4 py-2 rounded-lg text-[12px] transition"
      >
        {state.kind === 'running' ? '생성 중 (~30s)...' : '🪄 오늘 콘텐츠 자동 생성'}
      </button>
      {state.kind === 'success' && (
        <span className="text-[11px] text-emerald-300">✓ {state.summary}</span>
      )}
      {state.kind === 'error' && (
        <span className="text-[11px] text-red-300 max-w-xs truncate" title={state.message}>
          ✕ {state.message.slice(0, 60)}
        </span>
      )}
    </div>
  )
}

function HiggsfieldTestButton() {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'submitting' }
    | { kind: 'processing'; assetId: string; secondsElapsed: number }
    | { kind: 'success'; imageUrl: string; secondsElapsed: number }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  async function getToken(): Promise<string | null> {
    const { data } = await sb.auth.getSession()
    return data.session?.access_token || null
  }

  async function test() {
    setState({ kind: 'submitting' })
    const t0 = Date.now()
    try {
      const token = await getToken()
      if (!token) { setState({ kind: 'error', message: '세션 만료' }); return }

      const res = await fetch('/api/admin/higgsfield/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await res.json()
      if (!res.ok || !j.ok) {
        setState({ kind: 'error', message: j.error || '제출 실패' })
        return
      }

      // 폴링 시작
      const assetId = j.asset_id as string
      setState({ kind: 'processing', assetId, secondsElapsed: 0 })

      let attempts = 0
      const maxAttempts = 60  // 5초 × 60 = 5분 한도
      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 5000))
        attempts++
        const elapsed = Math.round((Date.now() - t0) / 1000)
        setState({ kind: 'processing', assetId, secondsElapsed: elapsed })

        const t = await getToken()
        if (!t) { setState({ kind: 'error', message: '세션 만료 (폴링 중)' }); return }

        const statusRes = await fetch(`/api/admin/higgsfield/test?asset_id=${assetId}`, {
          headers: { Authorization: `Bearer ${t}` },
        })
        if (!statusRes.ok) continue
        const sj = await statusRes.json()
        const asset = sj.asset
        if (!asset) continue

        if (asset.generation_status === 'completed') {
          setState({ kind: 'success', imageUrl: asset.url, secondsElapsed: elapsed })
          return
        }
        if (asset.generation_status === 'failed' || asset.generation_status === 'cancelled') {
          setState({ kind: 'error', message: asset.generation_error || asset.generation_status })
          return
        }
      }
      setState({ kind: 'error', message: '폴링 타임아웃 (5분 초과). webhook 미수신.' })
    } catch (e) {
      setState({ kind: 'error', message: String(e) })
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={test}
        disabled={state.kind === 'submitting' || state.kind === 'processing'}
        className="bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white font-semibold px-3 py-2 rounded-lg text-[12px] transition"
      >
        {state.kind === 'submitting' ? 'Higgsfield 제출 중...' :
          state.kind === 'processing' ? `Higgsfield 생성 중 (${state.secondsElapsed}s)` :
          '🎨 Higgsfield 테스트'}
      </button>
      {state.kind === 'success' && (
        <>
          <a href={state.imageUrl} target="_blank" rel="noopener" className="text-[11px] text-[#00C896] hover:underline">
            ✓ 성공 ({state.secondsElapsed}s)
          </a>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={state.imageUrl} alt="test" className="w-10 h-10 rounded object-cover border border-white/10" />
        </>
      )}
      {state.kind === 'error' && (
        <span className="text-[11px] text-red-300 max-w-xs truncate" title={state.message}>
          ✕ {state.message.slice(0, 60)}
        </span>
      )}
    </div>
  )
}

type ApiResult =
  | { ok: true; metrics: AdminMetrics; email: string }
  | { ok?: false; error: 'unauthorized' | 'forbidden'; your_email?: string }

function MetricCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string | number
  sub?: string
  accent?: string
}) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5">
      <div className="text-[11px] font-bold uppercase tracking-wider text-white/40 mb-2">{label}</div>
      <div className={`text-3xl font-black tracking-tight ${accent || 'text-white'}`}>{value}</div>
      {sub && <div className="text-[12px] text-white/50 mt-2 font-medium">{sub}</div>}
    </div>
  )
}

function Bar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div>
      <div className="flex justify-between text-[12px] mb-1">
        <span className="text-white/70 font-semibold">{label}</span>
        <span className="text-white/40 font-medium">
          {value.toLocaleString()} <span className="text-white/30">({pct}%)</span>
        </span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%`, transition: 'width .4s ease' }} />
      </div>
    </div>
  )
}

export default function AdminOverview() {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'denied'; email: string | null; reason: 'unauthenticated' | 'not_admin' }
    | { kind: 'ok'; metrics: AdminMetrics; email: string }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: sessionData } = await sb.auth.getSession()
        const accessToken = sessionData.session?.access_token

        if (!accessToken) {
          if (!cancelled) setState({ kind: 'denied', email: null, reason: 'unauthenticated' })
          return
        }

        const res = await fetch('/api/admin/metrics', {
          headers: { Authorization: `Bearer ${accessToken}` },
          credentials: 'include',
        })

        const json = (await res.json()) as ApiResult
        if (!res.ok) {
          if ('error' in json && json.error === 'forbidden') {
            if (!cancelled) setState({ kind: 'denied', email: json.your_email || null, reason: 'not_admin' })
            return
          }
          if (!cancelled) setState({ kind: 'denied', email: null, reason: 'unauthenticated' })
          return
        }
        if (!cancelled && 'metrics' in json && json.ok) {
          setState({ kind: 'ok', metrics: json.metrics, email: json.email })
        }
      } catch (e) {
        if (!cancelled) setState({ kind: 'error', message: String(e) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.kind === 'loading') {
    return (
      <div className="py-16 text-center text-white/40 text-[13px]">로딩 중...</div>
    )
  }

  if (state.kind === 'denied') {
    if (state.reason === 'unauthenticated') {
      return (
        <div className="py-16 flex items-center justify-center">
          <div className="max-w-md text-center space-y-4">
            <div className="text-3xl font-black tracking-tight">로그인이 필요해요</div>
            <p className="text-[14px] text-white/60 leading-relaxed">
              Ssobi Admin 에 접근하려면 먼저 로그인해주세요.
            </p>
            <a
              href="/app?next=%2Fadmin"
              className="inline-block bg-[#00C896] hover:bg-[#00A87E] text-white font-bold px-6 py-3 rounded-lg transition"
            >
              로그인하러 가기 →
            </a>
          </div>
        </div>
      )
    }
    return (
      <div className="py-16 flex items-center justify-center">
        <div className="max-w-lg space-y-5 bg-white/[0.03] border border-white/5 rounded-2xl p-8">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-red-400 mb-2">접근 거부</div>
            <div className="text-2xl font-black tracking-tight">관리자 권한이 없어요</div>
          </div>
          <div className="bg-black/40 rounded-lg p-4 space-y-2 font-mono text-[12.5px]">
            <div>
              <span className="text-white/40">너 이메일:</span>{' '}
              <span className="text-amber-300">{state.email || '(없음)'}</span>
            </div>
          </div>
          <p className="text-[13px] text-white/60 leading-relaxed">
            이 이메일을{' '}
            <code className="text-amber-300 bg-black/40 px-1.5 py-0.5 rounded text-[11.5px]">
              src/lib/admin.ts
            </code>{' '}
            의 HARDCODED_ADMINS 또는 Vercel env{' '}
            <code className="text-amber-300 bg-black/40 px-1.5 py-0.5 rounded text-[11.5px]">ADMIN_EMAILS</code>{' '}
            에 추가해주세요.
          </p>
          <a
            href="/app"
            className="inline-block bg-white/10 hover:bg-white/20 text-white font-semibold px-5 py-2.5 rounded-lg transition text-[13px]"
          >
            ← 앱으로 돌아가기
          </a>
        </div>
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className="py-16 text-center">
        <div className="text-red-400 font-bold mb-2">에러</div>
        <div className="text-white/60 font-mono text-[12px]">{state.message}</div>
      </div>
    )
  }

  // OK 상태 — 메트릭 렌더
  const m = state.metrics
  const planTotal = m.plans.free + m.plans.basic + m.plans.premium + m.plans.business
  const dauPct = m.signups.total > 0 ? Math.round((m.active_users.dau / m.signups.total) * 100) : 0

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight mb-1">개요</h1>
          <p className="text-[13px] text-white/50">
            실시간 운영 현황 · {new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <GenerateNowButton />
          <HiggsfieldTestButton />
          <div className="text-[11px] text-white/40">{state.email}</div>
        </div>
      </div>

      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/60 mb-3">가입자</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="오늘" value={m.signups.today} accent="text-[#00C896]" />
          <MetricCard label="최근 7일" value={m.signups.week} />
          <MetricCard label="최근 30일" value={m.signups.month} />
          <MetricCard label="총 누적" value={m.signups.total} sub={`DAU ${m.active_users.dau} · ${dauPct}%`} />
        </div>
      </section>

      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/60 mb-3">활동</h2>
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="DAU" value={m.active_users.dau} sub="24시간 응대 발생 유저" />
          <MetricCard label="WAU" value={m.active_users.wau} sub="7일 응대 발생" />
          <MetricCard label="MAU" value={m.active_users.mau} sub="30일 응대 발생" />
        </div>
      </section>

      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/60 mb-3">플랜 · 베타</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/40">
              플랜 분포 (총 {planTotal}명)
            </div>
            <Bar label="FREE" value={m.plans.free} total={planTotal} color="bg-white/30" />
            <Bar label="STARTER (basic)" value={m.plans.basic} total={planTotal} color="bg-[#00C896]" />
            <Bar label="PRO (premium)" value={m.plans.premium} total={planTotal} color="bg-[#8B5CF6]" />
            <Bar label="TEAM (business)" value={m.plans.business} total={planTotal} color="bg-[#F59E0B]" />
          </div>
          <div className="grid grid-cols-1 gap-3">
            <MetricCard
              label="베타 활성"
              value={m.plans.beta_active}
              sub="PRO 권한 무료 부여 중"
              accent="text-[#00C896]"
            />
            <MetricCard
              label="7일 내 종료"
              value={m.beta_expiring_7d}
              sub="알림톡 발송 예정"
              accent={m.beta_expiring_7d > 0 ? 'text-amber-400' : 'text-white'}
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/60 mb-3">MRR · 사용량</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="MRR (KRW)"
            value={`₩${m.mrr_krw.toLocaleString()}`}
            sub="NicePay 정기결제 합산"
            accent="text-[#00C896]"
          />
          <MetricCard
            label="MRR (USD)"
            value={`$${m.mrr_usd.toFixed(2)}`}
            sub="Stripe 정기결제 합산"
            accent="text-[#00C896]"
          />
          <MetricCard label="이달 댓글 응대" value={m.usage.monthly_comments.toLocaleString()} />
          <MetricCard label="이달 DM 응대" value={m.usage.monthly_dms.toLocaleString()} />
        </div>
      </section>

      {/* 내 링크 서비스 */}
      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/60 mb-3">내 링크</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <MetricCard
            label="페이지 만든 유저"
            value={m.link.authors_count}
            sub={`총 ${m.link.pages_total}개 페이지 · 발행 ${m.link.pages_published}`}
            accent="text-[#00C896]"
          />
          <MetricCard
            label="총 누적 페이지뷰"
            value={m.link.total_views.toLocaleString()}
            sub={`7일 ${m.link.views_7d.toLocaleString()} · UV ${m.link.unique_visitors_7d.toLocaleString()}`}
          />
          <MetricCard
            label="숏링크 발급"
            value={m.link.short_links_total.toLocaleString()}
            sub={`클릭 ${m.link.short_link_clicks_total.toLocaleString()} 누적`}
          />
          <MetricCard
            label="숏링크 7일 클릭"
            value={m.link.short_link_clicks_7d.toLocaleString()}
            sub="외부 SNS 유입 확인"
            accent="text-[#00C896]"
          />
        </div>
        {m.link.top_referers.length > 0 && (
          <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/40">
              유입처 TOP {m.link.top_referers.length} (최근 30일)
            </div>
            {(() => {
              const total = m.link.top_referers.reduce((s, r) => s + r.count, 0)
              return m.link.top_referers.map((r) => (
                <Bar
                  key={r.source}
                  label={r.source}
                  value={r.count}
                  total={total}
                  color={
                    r.source === 'instagram' ? 'bg-pink-500' :
                    r.source === 'threads' ? 'bg-white/60' :
                    r.source === 'tiktok' ? 'bg-cyan-400' :
                    r.source === 'youtube' ? 'bg-red-500' :
                    r.source === 'x' ? 'bg-white/40' :
                    r.source === 'facebook' ? 'bg-blue-500' :
                    r.source === 'kakao' ? 'bg-yellow-400' :
                    r.source === 'direct' ? 'bg-emerald-400' :
                    'bg-violet-400'
                  }
                />
              ))
            })()}
          </div>
        )}
      </section>

      {/* 만들기 (카드뉴스) */}
      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/60 mb-3">만들기 (카드뉴스)</h2>
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="총 생성" value={m.cardnews.jobs_total} />
          <MetricCard label="이번 달" value={m.cardnews.jobs_this_month} accent="text-[#00C896]" />
          <MetricCard label="발행됨" value={m.cardnews.jobs_published} sub="published_at 있음" />
        </div>
        {m.cardnews.by_template.length > 0 && (
          <div className="mt-3 rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/40">템플릿별 사용</div>
            {(() => {
              const total = m.cardnews.by_template.reduce((s, r) => s + r.count, 0)
              return m.cardnews.by_template.map((r) => (
                <Bar key={r.template} label={r.template} value={r.count} total={total} color="bg-violet-400" />
              ))
            })()}
          </div>
        )}
      </section>

      {/* 자동 응대 (댓글·DM) */}
      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/60 mb-3">자동 응대 (댓글·DM)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <MetricCard label="이번 달 댓글" value={m.replies.this_month_comments.toLocaleString()} />
          <MetricCard label="이번 달 DM" value={m.replies.this_month_dms.toLocaleString()} />
          <MetricCard
            label="누적 응대"
            value={m.replies.total.toLocaleString()}
            sub="전체 reply_logs"
          />
          <MetricCard
            label="긴급 처리"
            value={m.replies.urgent_count}
            sub="urgent/high 분류 (30일)"
            accent={m.replies.urgent_count > 0 ? 'text-amber-400' : 'text-white'}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/40">감정 분포 (최근 30일)</div>
            {(() => {
              const total =
                m.replies.by_sentiment.positive +
                m.replies.by_sentiment.neutral +
                m.replies.by_sentiment.negative +
                m.replies.by_sentiment.unknown
              return (
                <>
                  <Bar label="긍정" value={m.replies.by_sentiment.positive} total={total} color="bg-[#00C896]" />
                  <Bar label="중립" value={m.replies.by_sentiment.neutral} total={total} color="bg-white/40" />
                  <Bar label="부정" value={m.replies.by_sentiment.negative} total={total} color="bg-red-500" />
                  <Bar label="미분류" value={m.replies.by_sentiment.unknown} total={total} color="bg-white/20" />
                </>
              )
            })()}
          </div>
          <MetricCard
            label="자동 승인율"
            value={`${m.replies.approval_rate}%`}
            sub="AI 응대가 그대로 발송된 비율 (최근 30일)"
            accent={m.replies.approval_rate >= 70 ? 'text-[#00C896]' : 'text-amber-400'}
          />
        </div>
      </section>

      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/60 mb-3">마케팅 발행</h2>
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="대기" value={m.marketing.pending} sub="예약된 발행" />
          <MetricCard label="발행 (30일)" value={m.marketing.published_30d} accent="text-[#00C896]" />
          <MetricCard
            label="실패 (30일)"
            value={m.marketing.failed_30d}
            accent={m.marketing.failed_30d > 0 ? 'text-red-400' : 'text-white'}
          />
        </div>
      </section>

      <footer className="text-[11px] text-white/30 pt-8 border-t border-white/5">
        Ssobi Admin · Phase 1.5 베타 운영 모드 · 모든 데이터는 실시간 (캐싱 없음)
      </footer>
    </div>
  )
}
