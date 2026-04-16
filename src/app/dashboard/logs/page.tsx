import { createClient } from '@/lib/supabase/server'

export default async function LogsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: logs } = await supabase
    .from('reply_logs')
    .select('type, original_text, reply_text, created_at')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#1A1F27]">응대 내역</h1>
        <p className="text-sm text-gray-500 mt-1">AI가 자동으로 응대한 댓글과 DM 기록</p>
      </div>

      {!logs?.length ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
          <p className="text-sm text-gray-400">아직 응대 내역이 없습니다</p>
          <p className="text-xs text-gray-300 mt-1">Instagram 계정을 연동하면 자동 응대가 시작됩니다</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  log.type === 'dm'
                    ? 'bg-blue-50 text-blue-600'
                    : 'bg-purple-50 text-purple-600'
                }`}>
                  {log.type === 'dm' ? 'DM' : '댓글'}
                </span>
                <span className="text-xs text-gray-400">
                  {new Date(log.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-1">
                <span className="text-gray-400">원문:</span> {log.original_text}
              </p>
              <p className="text-sm text-[#1A1F27]">
                <span className="text-[#00C896]">AI:</span> {log.reply_text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
