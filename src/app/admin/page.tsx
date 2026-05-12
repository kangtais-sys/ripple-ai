import { getAdminMetrics } from '@/lib/admin-metrics'

export const dynamic = 'force-dynamic'
export const revalidate = 0

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
        <span className="text-white/40 font-medium">{value.toLocaleString()} <span className="text-white/30">({pct}%)</span></span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%`, transition: 'width .4s ease' }} />
      </div>
    </div>
  )
}

export default async function AdminOverview() {
  const m = await getAdminMetrics()
  const planTotal = m.plans.free + m.plans.basic + m.plans.premium + m.plans.business
  const dauPct = m.signups.total > 0 ? Math.round((m.active_users.dau / m.signups.total) * 100) : 0

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight mb-1">개요</h1>
        <p className="text-[13px] text-white/50">실시간 운영 현황 — {new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>
      </div>

      {/* 가입자 */}
      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/60 mb-3">가입자</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="오늘" value={m.signups.today} accent="text-[#00C896]" />
          <MetricCard label="최근 7일" value={m.signups.week} />
          <MetricCard label="최근 30일" value={m.signups.month} />
          <MetricCard label="총 누적" value={m.signups.total} sub={`DAU ${m.active_users.dau} · ${dauPct}%`} />
        </div>
      </section>

      {/* 활동 */}
      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/60 mb-3">활동</h2>
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="DAU" value={m.active_users.dau} sub="24시간 응대 발생 유저" />
          <MetricCard label="WAU" value={m.active_users.wau} sub="7일 응대 발생" />
          <MetricCard label="MAU" value={m.active_users.mau} sub="30일 응대 발생" />
        </div>
      </section>

      {/* 플랜 분포 + 베타 */}
      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/60 mb-3">플랜 · 베타</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/40">플랜 분포 (총 {planTotal}명)</div>
            <Bar label="FREE" value={m.plans.free} total={planTotal} color="bg-white/30" />
            <Bar label="STARTER (basic)" value={m.plans.basic} total={planTotal} color="bg-[#00C896]" />
            <Bar label="PRO (premium)" value={m.plans.premium} total={planTotal} color="bg-[#8B5CF6]" />
            <Bar label="TEAM (business)" value={m.plans.business} total={planTotal} color="bg-[#F59E0B]" />
          </div>
          <div className="grid grid-cols-1 gap-3">
            <MetricCard label="베타 활성" value={m.plans.beta_active} sub={`PRO 권한 무료 부여 중`} accent="text-[#00C896]" />
            <MetricCard label="7일 내 종료" value={m.beta_expiring_7d} sub="알림톡 발송 예정" accent={m.beta_expiring_7d > 0 ? 'text-amber-400' : 'text-white'} />
          </div>
        </div>
      </section>

      {/* MRR + 사용량 */}
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
          <MetricCard
            label="이달 댓글 응대"
            value={m.usage.monthly_comments.toLocaleString()}
          />
          <MetricCard
            label="이달 DM 응대"
            value={m.usage.monthly_dms.toLocaleString()}
          />
        </div>
      </section>

      {/* 마케팅 발행 */}
      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/60 mb-3">마케팅 발행</h2>
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="대기" value={m.marketing.pending} sub="예약된 발행" />
          <MetricCard label="발행 (30일)" value={m.marketing.published_30d} accent="text-[#00C896]" />
          <MetricCard label="실패 (30일)" value={m.marketing.failed_30d} accent={m.marketing.failed_30d > 0 ? 'text-red-400' : 'text-white'} />
        </div>
      </section>

      <footer className="text-[11px] text-white/30 pt-8 border-t border-white/5">
        Ssobi Admin · Phase 1.5 베타 운영 모드 · 모든 데이터는 실시간 (캐싱 없음)
      </footer>
    </div>
  )
}
