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

  const { error: delErr } = await sb.from('ig_accounts').delete().eq('user_id', user.id)
  if (delErr) {
    return NextResponse.json({ error: 'delete_failed', detail: delErr.message }, { status: 500 })
  }

  await sb.from('profiles').update({ ig_linked_at: null }).eq('id', user.id)

  return NextResponse.json({ ok: true })
}
