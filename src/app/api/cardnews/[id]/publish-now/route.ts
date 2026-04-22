// POST /api/cardnews/:id/publish-now
// 202 로 즉시 응답. 실제 발행은 waitUntil 로 백그라운드 처리.
// 유저는 페이지 닫아도 발행 진행됨. status 는 card_news_jobs.status 로 폴링.
import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { publishCardnewsJob } from '@/lib/ig-publish'
import { waitUntil } from '@vercel/functions'
import { NextResponse } from 'next/server'

// 백그라운드 발행이므로 충분히 길게
export const maxDuration = 300

type Params = { id: string }

export async function POST(req: Request, ctx: { params: Promise<Params> }) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const admin = adminClient()

  const { data: job } = await admin
    .from('card_news_jobs')
    .select('id, user_id, status, prompt_caption, prompt_body, meta')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (['published', 'scheduled', 'processing'].includes(job.status)) {
    return NextResponse.json({
      error: `already_${job.status}`,
    }, { status: 409 })
  }

  // 상태를 processing 으로 표시 (폴링용). 실패 시 publishCardnewsJob 이 failed 로 바꿈.
  //   status CHECK 에 'processing' 없으니 scheduled_at=now() 로 표시
  //   대안: meta.background_started_at
  await admin
    .from('card_news_jobs')
    .update({
      meta: { ...(job.meta || {}), background_started_at: new Date().toISOString() },
    })
    .eq('id', id)

  const appBase = process.env.NEXT_PUBLIC_APP_URL || 'https://ssobi.ai'

  // 백그라운드 발행 — 응답 반환 후에도 서버는 발행 완료까지 실행
  waitUntil(publishCardnewsJob(admin, job, appBase))

  // 즉시 202 반환 — 유저는 페이지 닫아도 됨
  return NextResponse.json({ ok: true, accepted: true, job_id: id }, { status: 202 })
}

// 발행 상태 폴링용 (프론트가 사용 가능)
export async function GET(req: Request, ctx: { params: Promise<Params> }) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const admin = adminClient()

  const { data: job } = await admin
    .from('card_news_jobs')
    .select('id, status, published_at, meta')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const meta = (job.meta || {}) as Record<string, unknown>
  return NextResponse.json({
    status: job.status,
    published_at: job.published_at,
    ig_media_id: meta.ig_media_id || null,
    last_error: meta.last_error || null,
  })
}
