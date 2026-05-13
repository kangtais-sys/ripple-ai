import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { publishMarketingPost } from '@/lib/zernio/publisher'

export const maxDuration = 60

// 마케팅 발행 cron — 5분마다 due 글 발행 (Zernio API 경유)
//   marketing_posts 에서 status='pending' 이고 scheduled_at <= now() 인 글 pickup
//   각 글 → Zernio /posts 단일 호출 (모든 채널 동시 발행)
//   결과 누적 → status 갱신 (published/partial/failed)

export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: dueList, error } = await sb
    .from('marketing_posts')
    .select('id, channels')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(20)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!dueList?.length) {
    return NextResponse.json({ ok: true, processed: 0 })
  }

  let processed = 0
  for (const post of dueList) {
    // 1) 락 — publishing 으로 상태 변경
    await sb.from('marketing_posts').update({ status: 'publishing' }).eq('id', post.id)

    // 2) Zernio 발행
    const outcome = await publishMarketingPost(sb, post.id as string)
    const totalChannels = (post.channels as string[]).length
    const okCount = Object.values(outcome.results).filter((r) => r.ok).length
    const failCount = totalChannels - okCount

    let finalStatus: 'published' | 'partial' | 'failed' = 'failed'
    if (okCount === totalChannels) finalStatus = 'published'
    else if (okCount > 0) finalStatus = 'partial'

    const errMsg = !outcome.ok
      ? (outcome.error || Object.entries(outcome.results).filter(([, v]) => !v.ok).map(([k, v]) => `${k}: ${v.error || 'fail'}`).join(' | '))
      : null

    await sb
      .from('marketing_posts')
      .update({
        status: finalStatus,
        results: outcome.results,
        published_at: new Date().toISOString(),
        error: errMsg,
      })
      .eq('id', post.id)

    processed++
  }

  return NextResponse.json({ ok: true, processed })
}
