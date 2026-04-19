// PATCH /api/cardnews/[id]  — 프롬프트 편집 / 스케줄 / 템플릿 변경
//   body: { hook?, body?, caption?, template?, slide_count?, size?, scheduled_at?, channels? }

import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    hook?: string
    body?: Array<{ title?: string; text?: string }>
    caption?: string
    template?: string
    slide_count?: number
    size?: string
    scheduled_at?: string | null
    channels?: string[]
    status?: string
  }

  const patch: Record<string, unknown> = {}
  if (body.hook !== undefined) patch.prompt_hook = body.hook
  if (body.body !== undefined) patch.prompt_body = body.body
  if (body.caption !== undefined) patch.prompt_caption = body.caption
  if (body.template) patch.template = body.template
  if (typeof body.slide_count === 'number') patch.slide_count = body.slide_count
  if (body.size) patch.size = body.size
  if (body.channels) patch.channels = body.channels
  if (body.scheduled_at !== undefined) {
    patch.scheduled_at = body.scheduled_at
    patch.status = body.scheduled_at ? 'scheduled' : 'draft'
  }
  if (body.status && ['draft', 'scheduled', 'published', 'failed'].includes(body.status)) {
    patch.status = body.status
  }

  const { data, error } = await sb
    .from('card_news_jobs')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ job: data })
}
