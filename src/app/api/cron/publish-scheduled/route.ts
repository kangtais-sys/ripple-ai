// Vercel Cron: 5분마다 실행
// scheduled_at <= now() AND status=scheduled 인 card_news_jobs을 발송
// MVP: 실제 플랫폼 발송은 stub. 상태만 published로 전환하고 캘린더에 반영.

import { NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

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

  // 발송 대상: scheduled_at 이 지났고 status=scheduled
  const nowIso = new Date().toISOString()
  const { data: jobs, error } = await admin
    .from('card_news_jobs')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', nowIso)
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results: Array<{ id: string; ok: boolean; reason?: string }> = []

  for (const job of jobs || []) {
    try {
      // TODO: 채널별 실제 발송 (Meta/TikTok/YouTube)
      // 현재는 상태만 published로 전환
      const { error: uErr } = await admin
        .from('card_news_jobs')
        .update({ status: 'published', published_at: new Date().toISOString() })
        .eq('id', job.id)
      if (uErr) {
        results.push({ id: job.id, ok: false, reason: uErr.message })
        continue
      }
      results.push({ id: job.id, ok: true })
    } catch (e) {
      await admin.from('card_news_jobs').update({ status: 'failed' }).eq('id', job.id)
      results.push({ id: job.id, ok: false, reason: String(e) })
    }
  }

  return NextResponse.json({ ran_at: nowIso, processed: results.length, results })
}
