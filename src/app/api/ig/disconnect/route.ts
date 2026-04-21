// POST /api/ig/disconnect — 유저의 Instagram 연동 완전 해제
// 1) ig_accounts 전체 삭제 (CASCADE 로 관련 reply_logs 등은 남음)
// 2) profiles.ig_linked_at = null
// Meta 앱 쪽 토큰은 유저가 Instagram 설정에서 별도 제거 가능
import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = adminClient()

  // 1) 이 유저의 ig_accounts id 들 조회
  const { data: igs } = await sb
    .from('ig_accounts')
    .select('id')
    .eq('user_id', user.id)
  const igIds = (igs || []).map(r => r.id as string)

  // 2) reply_logs.ig_account_id FK 끊기 (RESTRICT 회피 — 기록은 보존)
  if (igIds.length > 0) {
    const { error: unlinkErr } = await sb
      .from('reply_logs')
      .update({ ig_account_id: null })
      .in('ig_account_id', igIds)
    if (unlinkErr) {
      return NextResponse.json({
        error: 'unlink_reply_logs_failed',
        detail: unlinkErr.message,
      }, { status: 500 })
    }
  }

  // 3) ig_accounts 삭제
  const { error: delErr } = await sb.from('ig_accounts').delete().eq('user_id', user.id)
  if (delErr) {
    return NextResponse.json({ error: 'delete_failed', detail: delErr.message }, { status: 500 })
  }

  await sb.from('profiles').update({ ig_linked_at: null }).eq('id', user.id)

  return NextResponse.json({ ok: true, removed_accounts: igIds.length })
}
