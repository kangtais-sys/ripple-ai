// POST /api/dm-threads/takeover — 특정 DM 대화에서 사용자(사장)가 직접 응대 모드로 전환
//   body: { igAccountId: string, remoteIgUserId: string, remoteUsername?: string, active: boolean }
//   active=true → 그 thread 자동 응대 중단 (사장이 직접 답변)
//   active=false → 자동 응대 재개
import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth-helper'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req).catch(() => null)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    igAccountId?: string
    remoteIgUserId?: string
    remoteUsername?: string
    active?: boolean
  }

  if (!body.igAccountId || !body.remoteIgUserId || typeof body.active !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 })
  }

  const sb = await createClient()

  // upsert dm_threads (user + ig_account + remote 조합 unique)
  const { error } = await sb
    .from('dm_threads')
    .upsert({
      user_id: user.id,
      ig_account_id: body.igAccountId,
      remote_ig_user_id: body.remoteIgUserId,
      remote_username: body.remoteUsername || null,
      takeover_active: body.active,
      takeover_started_at: body.active ? new Date().toISOString() : null,
      last_message_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id,ig_account_id,remote_ig_user_id',
    })

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, active: body.active })
}

// GET — 현재 사용자의 takeover 활성 thread 목록
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req).catch(() => null)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const sb = await createClient()
  const { data: threads } = await sb
    .from('dm_threads')
    .select('id, ig_account_id, remote_ig_user_id, remote_username, takeover_active, takeover_started_at, last_message_at')
    .eq('user_id', user.id)
    .eq('takeover_active', true)
    .order('takeover_started_at', { ascending: false })

  return NextResponse.json({ ok: true, threads: threads || [] })
}
