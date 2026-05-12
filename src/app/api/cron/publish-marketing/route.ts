import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { publishToChannel, type ChannelKey } from '@/lib/marketing-publishers'

export const maxDuration = 60

// 마케팅 발행 cron — 5분마다 due 글 발행
//   marketing_posts 에서 status='pending' 이고 scheduled_at <= now() 인 글 pickup
//   각 channel 별로 publishToChannel 호출
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
    .select('id, content, image_urls, channels')
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

    const payload = {
      content: post.content as string,
      imageUrls: (post.image_urls as string[]) || [],
    }
    const results: Record<string, { ok: boolean; id?: string; error?: string }> = {}
    let successCount = 0
    let failCount = 0

    for (const ch of post.channels as ChannelKey[]) {
      const r = await publishToChannel(ch, payload)
      results[ch] = { ok: r.ok, id: r.id, error: r.error }
      if (r.ok) successCount++
      else failCount++
    }

    // 2) 최종 status 결정
    let finalStatus: 'published' | 'partial' | 'failed' = 'failed'
    if (successCount === (post.channels as ChannelKey[]).length) finalStatus = 'published'
    else if (successCount > 0) finalStatus = 'partial'

    await sb
      .from('marketing_posts')
      .update({
        status: finalStatus,
        results,
        published_at: new Date().toISOString(),
        error: failCount > 0 ? Object.entries(results).filter(([, v]) => !v.ok).map(([k, v]) => `${k}: ${v.error}`).join(' | ') : null,
      })
      .eq('id', post.id)

    processed++
  }

  return NextResponse.json({ ok: true, processed })
}
