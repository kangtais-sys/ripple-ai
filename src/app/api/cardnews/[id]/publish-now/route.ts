// POST /api/cardnews/:id/publish-now
// 예약 없이 즉시 Instagram으로 발행. content_publish 권한 실제 호출.
import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { publishCardnewsJob } from '@/lib/ig-publish'
import { NextResponse } from 'next/server'

// 캐러셀 발행 시 슬라이드별 status 폴링으로 시간 소요 (최대 ~2분)
export const maxDuration = 300  // 5분 — Vercel Pro 필요 (Hobby 는 60s 상한)

type Params = { id: string }

export async function POST(req: Request, ctx: { params: Promise<Params> }) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const admin = adminClient()

  // 소유권 확인
  const { data: job } = await admin
    .from('card_news_jobs')
    .select('id, user_id, status, prompt_caption, prompt_body, meta')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (['published', 'scheduled'].includes(job.status)) {
    // scheduled 잡은 cron 이 처리 — 즉시 발행 요청 충돌 방지
    return NextResponse.json({
      error: job.status === 'published' ? 'already_published' : 'already_scheduled',
    }, { status: 409 })
  }

  const appBase = process.env.NEXT_PUBLIC_APP_URL || 'https://ssobi.ai'
  const result = await publishCardnewsJob(admin, job, appBase)

  if (!result.ok) {
    return NextResponse.json({ error: 'publish_failed', detail: result.error }, { status: 502 })
  }
  return NextResponse.json({ ok: true, media_id: result.mediaId })
}
