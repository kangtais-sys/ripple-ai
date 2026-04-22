// GET  /api/cardnews              → 내 잡 목록 (최신순, 필터: status)
// POST /api/cardnews               → 편집기에서 저장 (draft/scheduled)
// PUT  /api/cardnews/[id]         → 편집/스케줄 (아래 /[id]/route.ts)
// DELETE /api/cardnews?id=xx      → 삭제

import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = adminClient()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)

  let q = sb.from('card_news_jobs').select('*').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(limit)
  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jobs: data || [] })
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    topic?: string
    hook?: string
    body?: string
    bodySlides?: Array<{ title?: string; text?: string }> | null
    caption?: string
    template?: string
    size?: string
    channels?: string[]
    status?: string
    scheduled_at?: string | null
  }

  // 슬라이드 구조: bodySlides 우선 (Claude 원본), 없으면 flatten 문자열로 단일 슬라이드
  const promptBody = Array.isArray(body.bodySlides) && body.bodySlides.length > 0
    ? body.bodySlides.map(s => ({ title: (s.title || '').slice(0, 200), text: (s.text || '').slice(0, 1500) }))
    : (body.body ? [{ title: '', text: body.body }] : [])

  const sb = adminClient()
  const { data, error } = await sb.from('card_news_jobs').insert({
    user_id: user.id,
    topic: (body.topic || '').slice(0, 200) || 'draft',
    prompt_hook: body.hook || null,
    prompt_body: promptBody,
    slide_count: Math.max(1, promptBody.length),
    prompt_caption: body.caption || null,
    template: body.template || 'clean',
    size: body.size || 'sq',
    channels: body.channels || ['ig'],
    status: (body.status && ['draft','scheduled','published'].includes(body.status)) ? body.status : 'draft',
    scheduled_at: body.scheduled_at || null,
  }).select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data?.id, ok: true })
}

export async function DELETE(req: Request) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = adminClient()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await sb.from('card_news_jobs').delete().eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
