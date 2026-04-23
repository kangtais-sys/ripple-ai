// POST /api/cardnews/:id/set-overrides
// 편집 캔버스에서 캡처·업로드한 슬라이드 URL 들을 card_news_jobs.meta.slide_overrides 에 저장
// 이후 publish-now 가 이 URL 들을 IG 캐러셀 child 로 사용 (Satori 렌더 대신)
import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { NextResponse } from 'next/server'

type Params = { id: string }

export async function POST(req: Request, ctx: { params: Promise<Params> }) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const body = await req.json().catch(() => ({})) as { slide_overrides?: string[] }
  const overrides = Array.isArray(body.slide_overrides)
    ? body.slide_overrides.filter(u => typeof u === 'string' && u.startsWith('http')).slice(0, 10)
    : []

  const sb = adminClient()
  const { data: job } = await sb
    .from('card_news_jobs')
    .select('id, meta')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const newMeta = { ...(job.meta || {}), slide_overrides: overrides }
  const { error } = await sb
    .from('card_news_jobs')
    .update({ meta: newMeta })
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: 'update_failed', detail: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, count: overrides.length })
}
