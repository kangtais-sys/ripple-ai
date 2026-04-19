// GET  /api/templates        → 내 템플릿 목록
// POST /api/templates        → 저장 (생성/교체). body: { name?, bg, logo_url?, font_title?, font_body?, elements? }
// DELETE /api/templates?id=x → 삭제

import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await sb
    .from('user_templates')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ templates: data || [] })
}

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    id?: string
    name?: string
    bg?: string
    logo_url?: string
    font_title?: string
    font_body?: string
    elements?: unknown[]
  }

  const payload = {
    user_id: user.id,
    name: (body.name || 'My Template').slice(0, 80),
    bg: body.bg || null,
    logo_url: body.logo_url || null,
    font_title: body.font_title || 'Pretendard',
    font_body: body.font_body || 'Pretendard',
    elements: body.elements ?? [],
  }

  if (body.id) {
    const { data, error } = await sb.from('user_templates')
      .update(payload).eq('id', body.id).eq('user_id', user.id)
      .select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ template: data })
  }

  const { data, error } = await sb.from('user_templates').insert(payload).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ template: data })
}

export async function DELETE(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await sb.from('user_templates').delete().eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
