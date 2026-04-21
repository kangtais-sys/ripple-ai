// POST /api/cardnews/:id/publish-now
// 예약 없이 즉시 Instagram으로 발행. content_publish 권한 실제 호출.
import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { publishCardnewsJob } from '@/lib/ig-publish'
import { NextResponse } from 'next/server'

type Params = { id: string }

export async function POST(req: Request, ctx: { params: Promise<Params> }) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const admin = adminClient()

  // 소유권 확인
  const { data: job } = await admin
    .from('card_news_jobs')
    .select('id, user_id, status, prompt_caption, meta')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (job.status === 'published') {
    return NextResponse.json({ error: 'already_published' }, { status: 409 })
  }

  const appBase = process.env.NEXT_PUBLIC_APP_URL || 'https://ssobi.ai'
  const result = await publishCardnewsJob(admin, job, appBase)

  if (!result.ok) {
    return NextResponse.json({ error: 'publish_failed', detail: result.error }, { status: 502 })
  }
  return NextResponse.json({ ok: true, media_id: result.mediaId })
}
