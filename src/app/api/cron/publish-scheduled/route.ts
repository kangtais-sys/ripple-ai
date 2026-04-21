// Vercel Cron: 5분마다 실행
// scheduled_at <= now() AND status=scheduled 인 card_news_jobs을 Instagram Graph API로
// 실제 발행. 성공 시 published, 실패 시 failed + meta.last_error.

import { NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { publishCardnewsJob } from '@/lib/ig-publish'

export async function GET(req: Request) {
  // Vercel Cron 인증 (CRON_SECRET 헤더)
  const auth = req.headers.get('authorization')
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  if (expected && auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const nowIso = new Date().toISOString()
  const { data: jobs, error } = await admin
    .from('card_news_jobs')
    .select('id, user_id, status, prompt_caption, meta')
    .eq('status', 'scheduled')
    .lte('scheduled_at', nowIso)
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const appBase = process.env.NEXT_PUBLIC_APP_URL || 'https://ssobi.ai'
  const results: Array<{ id: string; ok: boolean; media_id?: string; reason?: string }> = []

  for (const job of jobs || []) {
    const r = await publishCardnewsJob(admin, job, appBase)
    results.push({ id: job.id, ok: r.ok, media_id: r.mediaId, reason: r.error })
  }

  return NextResponse.json({ ran_at: nowIso, processed: results.length, results })
}
