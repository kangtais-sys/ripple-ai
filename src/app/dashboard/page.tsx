import { createClient } from '@/lib/supabase/server'
import { PLANS, type PlanKey, getUsagePercent } from '@/lib/plans'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const month = new Date().toISOString().slice(0, 7)

  const [{ data: profile }, { data: igAccounts }, { data: usage }] = await Promise.all([
    supabase.from('profiles').select('display_name, plan').eq('id', user!.id).single(),
    supabase.from('ig_accounts').select('ig_username').eq('user_id', user!.id),
    supabase.from('usage_logs').select('comment_count, dm_count').eq('user_id', user!.id).eq('month', month).single(),
  ])

  const plan = (profile?.plan || 'free') as PlanKey
  const planInfo = PLANS[plan]
  const hasIg = igAccounts && igAccounts.length > 0
  const comments = usage?.comment_count || 0
  const dms = usage?.dm_count || 0
  const total = comments + dms
  const percent = getUsagePercent(plan, comments, dms)
  const savedHours = Math.round(total * 1.5 / 60) // 건당 ~1.5분 절약 추정
  const savedWon = savedHours * 9860

  return (
    <div>
      {/* 헤더 */}
      <div className="flex justify-between items-center py-5 pb-4">
        <div className="text-[26px] font-black tracking-[-1.2px] text-[#1A1F27]">
          Repli<span className="text-[#00C896]">.</span>
        </div>
        <div className="flex items-center gap-[5px] text-xs font-bold text-[#00C896] cursor-pointer">
          <div className="w-1.5 h-1.5 bg-[#00C896] rounded-full animate-pulse" />
          AI 작동중
        </div>
      </div>

      {/* 계정 연동 안내 */}
      {!hasIg && (
        <Link href="/dashboard/connect" className="block bg-[#F0FDF9] border border-[#00C896]/20 rounded-[20px] p-[18px_20px] mb-3.5 no-underline">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-[15px] font-extrabold text-[#1A1F27]">Instagram 계정을 연동해주세요</div>
              <div className="text-[11px] text-[#00C896] mt-[3px]">연동하면 AI가 자동으로 관리를 시작해요</div>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00C896" strokeWidth={2}><path d="M9 5l7 7-7 7" /></svg>
          </div>
        </Link>
      )}

      {/* ROI 카드 */}
      <div className="bg-white rounded-[24px] p-6 border border-[#F0F2F5] shadow-[0_1px_3px_rgba(0,0,0,.04)] mb-3.5">
        <div className="text-[13px] font-semibold text-[#64748B] mb-2">이번 달 절약한 시간</div>
        <div className="text-[32px] font-black tracking-[-1px] mb-3 leading-none">
          {savedHours > 0 ? `${savedHours}시간` : '0시간'}
          <span className="text-[14px] font-semibold text-[#94A3B8] ml-1">
            ≈ ₩{savedWon.toLocaleString()}
          </span>
        </div>

        {/* 사용량 바 */}
        <div className="h-1 bg-[#F0F2F5] rounded-sm overflow-hidden mb-1.5">
          <div className="h-full bg-[#00C896] rounded-sm transition-all duration-1000" style={{ width: `${Math.min(percent, 100)}%` }} />
        </div>
        <div className="text-xs text-[#94A3B8] font-medium text-right mb-[18px]">
          {total.toLocaleString()} / {planInfo.limit === Infinity ? '무제한' : planInfo.limit.toLocaleString()}건 ({percent}%)
        </div>

        {/* 통계 그리드 */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="bg-[#F9FAFB] p-3 rounded-[14px]">
            <div className="text-[10px] font-semibold text-[#94A3B8] mb-1">댓글 응대</div>
            <div className="text-base font-extrabold text-[#1A1F27]">{comments}건</div>
          </div>
          <div className="bg-[#F9FAFB] p-3 rounded-[14px]">
            <div className="text-[10px] font-semibold text-[#94A3B8] mb-1">DM 응대</div>
            <div className="text-base font-extrabold text-[#1A1F27]">{dms}건</div>
          </div>
          <div className="bg-[#F9FAFB] p-3 rounded-[14px]">
            <div className="text-[10px] font-semibold text-[#94A3B8] mb-1">플랜</div>
            <div className="text-base font-extrabold text-[#1A1F27]">{planInfo.name}</div>
          </div>
        </div>
      </div>

      {/* 빠른 메뉴 */}
      <div className="text-[15px] font-extrabold text-[#1A1F27] mt-5 mb-2.5 tracking-[-0.3px]">빠른 설정</div>
      <div className="space-y-2">
        <QuickMenu href="/dashboard/tone" label="AI 말투 학습" desc="내 말투를 AI에게 가르쳐요" />
        <QuickMenu href="/dashboard/logs" label="응대 내역" desc="자동 응대된 댓글/DM 확인" />
        <QuickMenu href="/dashboard/connect" label="계정 연동" desc={hasIg ? igAccounts.map(a => `@${a.ig_username}`).join(', ') : 'Instagram 연동하기'} />
      </div>
    </div>
  )
}

function QuickMenu({ href, label, desc }: { href: string; label: string; desc: string }) {
  return (
    <Link href={href} className="block bg-white rounded-2xl p-4 border border-[#F0F2F5] hover:border-[#00C896]/30 transition">
      <div className="flex justify-between items-center">
        <div>
          <div className="text-[14px] font-bold text-[#1A1F27]">{label}</div>
          <div className="text-[12px] text-[#94A3B8] mt-0.5">{desc}</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth={2}><path d="M9 5l7 7-7 7" /></svg>
      </div>
    </Link>
  )
}
