// 참고 계정 CRUD — 말투 학습·벤치마킹 용도

import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await sb
    .from('reference_accounts')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ accounts: data || [] })
}

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

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
      user_id: user.id,
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
    .eq('id', user.id)

  return NextResponse.json({ account: data })
}

export async function DELETE(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await sb.from('reference_accounts').delete().eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
