// 참고 계정 CRUD — 말투 학습·벤치마킹 용도
//
// 인증: Bearer(앱 localStorage 토큰) 우선 + 쿠키 fallback (getUserFromRequest).
//   이전엔 쿠키 전용이라 이메일 로그인 유저가 401 → 참고계정 저장이 조용히 실패했음.

import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = adminClient()
  const { data, error } = await sb
    .from('reference_accounts')
    .select('*')
    .eq('user_id', u.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ accounts: data || [] })
}

export async function POST(req: Request) {
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = adminClient()
  const body = await req.json().catch(() => ({})) as {
    handle?: string
    platform?: string
    note?: string
  }

  const handle = (body.handle || '').trim().replace(/^@/, '')
  const platform = ['ig', 'tk', 'yt', 'other'].includes(body.platform || '') ? body.platform : 'ig'

  if (!handle || handle.length > 80) {
    return NextResponse.json({ error: 'handle required (max 80)' }, { status: 400 })
  }

  const { data, error } = await sb
    .from('reference_accounts')
    .upsert({
      user_id: u.id,
      handle,
      platform,
      note: (body.note || '').slice(0, 400) || null,
    }, { onConflict: 'user_id,handle,platform' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 참고 계정 설정 시각 기록 (첫 등록 시 첫날 모드 체크용)
  await sb.from('profiles')
    .update({ ref_set_at: new Date().toISOString() })
    .eq('id', u.id)

  return NextResponse.json({ account: data })
}

export async function DELETE(req: Request) {
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = adminClient()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await sb.from('reference_accounts').delete().eq('id', id).eq('user_id', u.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
