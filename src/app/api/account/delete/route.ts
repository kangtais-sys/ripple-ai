// POST /api/account/delete
//   본인 계정·데이터 전체 삭제 (개인정보처리방침 제9조 "데이터 삭제 요청" 이행).
//   인증된 본인만(getUserFromRequest). 모든 삭제는 본인 user_id 로 스코프됨.
//   순서: reply_logs(ig FK) → user_id 자식테이블들 → ig_accounts → profiles → auth 계정.
//   복구 불가능한 영구 삭제.

import { NextResponse } from 'next/server'
import { getUserFromRequest, adminClient } from '@/lib/auth-helper'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = adminClient()
  const uid = u.id

  try {
    // 1) reply_logs — ig_accounts FK(reply_logs_ig_account_id_fkey) 때문에 먼저 삭제.
    //    user_id 기준 + 본인 ig_account 기준 둘 다 (webhook 생성 로그는 ig_account_id 로만 묶임).
    const { data: igs } = await sb.from('ig_accounts').select('id').eq('user_id', uid)
    const igIds = (igs || []).map((r) => r.id as string)
    await sb.from('reply_logs').delete().eq('user_id', uid)
    if (igIds.length) await sb.from('reply_logs').delete().in('ig_account_id', igIds)

    // 2) user_id 로 스코프된 자식 테이블 전부 (best-effort — 일부 테이블에 user_id 없어도 전체 중단 안 함)
    //    ig_accounts 는 다른 테이블이 참조하므로 맨 마지막.
    const childTables = [
      'knowledge_chunks', 'learn_queue', 'tone_profiles', 'daily_reports', 'usage_logs',
      'link_pages', 'uploaded_files', 'reference_accounts', 'user_templates',
      'urgent_contexts', 'pending_replies', 'conversations', 'fan_profiles',
      'send_attempts', 'account_health', 'ig_accounts',
    ]
    for (const t of childTables) {
      const { error } = await sb.from(t).delete().eq('user_id', uid)
      if (error) console.warn(`[account/delete] ${t}:`, error.message)
    }

    // 3) profiles
    await sb.from('profiles').delete().eq('id', uid)

    // 4) auth 계정 (로그인 자체 제거)
    const { error: delErr } = await sb.auth.admin.deleteUser(uid)
    if (delErr) {
      console.error('[account/delete] auth deleteUser failed:', delErr.message)
      // 데이터는 삭제됐고 auth 계정만 남은 부분성공 — 사용자 데이터는 없음.
      return NextResponse.json({ ok: true, partial: true })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[account/delete] error:', e)
    return NextResponse.json({ error: 'delete_failed', detail: String(e).slice(0, 200) }, { status: 500 })
  }
}
