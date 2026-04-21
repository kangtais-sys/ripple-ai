// GET/POST /api/tone/context — 유저의 금지어·브랜드 컨텍스트
import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = adminClient()
  const { data } = await sb
    .from('tone_profiles')
    .select('banned_words, brand_context')
    .eq('user_id', user.id)
    .maybeSingle()

  return NextResponse.json({
    banned_words: data?.banned_words || [],
    brand_context: data?.brand_context || '',
  })
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    banned_words?: string[] | string
    brand_context?: string
  }

  // banned_words 정규화: string ("a, b") → array, 최대 30개
  let banned: string[] = []
  if (Array.isArray(body.banned_words)) {
    banned = body.banned_words.map(s => String(s).trim()).filter(Boolean)
  } else if (typeof body.banned_words === 'string') {
    banned = body.banned_words.split(',').map(s => s.trim()).filter(Boolean)
  }
  banned = banned.slice(0, 30).map(s => s.slice(0, 60))

  const brand_context = (body.brand_context || '').toString().slice(0, 2000)

  const sb = adminClient()

  // profiles row 보장
  const { data: existingProfile } = await sb
    .from('profiles').select('id').eq('id', user.id).maybeSingle()
  if (!existingProfile) {
    await sb.from('profiles').insert({ id: user.id })
  }

  // tone_profiles row 보장 (없으면 생성)
  const { data: existingTone } = await sb
    .from('tone_profiles').select('id').eq('user_id', user.id).maybeSingle()

  let saveErr: { message?: string } | null = null
  if (existingTone) {
    const { error } = await sb
      .from('tone_profiles')
      .update({ banned_words: banned, brand_context, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
    saveErr = error
  } else {
    const { error } = await sb.from('tone_profiles').insert({
      user_id: user.id,
      banned_words: banned,
      brand_context,
      updated_at: new Date().toISOString(),
    })
    saveErr = error
  }

  if (saveErr) {
    return NextResponse.json({ error: 'save_failed', detail: saveErr.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, banned_words: banned, brand_context })
}
