import { createClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: igAccounts } = await supabase
    .from('ig_accounts')
    .select('ig_username')
    .eq('user_id', user!.id)

  const { data: usage } = await supabase
    .from('usage_logs')
    .select('comment_count, dm_count')
    .eq('user_id', user!.id)
    .eq('month', new Date().toISOString().slice(0, 7))
    .single()

  const hasIg = igAccounts && igAccounts.length > 0
  const comments = usage?.comment_count || 0
  const dms = usage?.dm_count || 0

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-[#1A1F27]">홈</h1>

      {/* 계정 연동 안내 */}
      {!hasIg && (
        <div className="bg-[#00C896]/5 border border-[#00C896]/20 rounded-xl p-4">
          <p className="text-sm font-semibold text-[#1A1F27] mb-1">Instagram 계정을 연동해주세요</p>
          <p className="text-xs text-gray-500 mb-3">연동하면 댓글과 DM을 자동으로 관리할 수 있어요.</p>
          <a href="/dashboard/connect" className="inline-block px-4 py-2 bg-[#00C896] text-white text-sm font-semibold rounded-lg hover:bg-[#00B386] transition">
            계정 연동하기
          </a>
        </div>
      )}

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="이번 달 댓글 응대" value={`${comments}건`} />
        <StatCard label="이번 달 DM 응대" value={`${dms}건`} />
        <StatCard label="총 응대" value={`${comments + dms}건`} />
        <StatCard label="연동 계정" value={hasIg ? igAccounts.map(a => `@${a.ig_username}`).join(', ') : '없음'} />
      </div>

      {/* 연동된 계정이 있을 때 최근 활동 */}
      {hasIg && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="text-sm font-semibold text-[#1A1F27] mb-3">최근 응대 내역</h2>
          <p className="text-xs text-gray-400">응대 기록이 여기에 표시됩니다.</p>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-lg font-bold text-[#1A1F27]">{value}</p>
    </div>
  )
}
