// GET /api/cron/trend-research  (Vercel Cron · 매일 23:00 KST = 14:00 UTC)
// 1) Reddit + 올리브영 + 무신사 수집
// 2) engagement 내림차순 TOP 20 만 Claude 에 전달 (토큰 절약)
// 3) Claude (TREND_RESEARCH_PROMPT) → top5 + recommended_topics 3개
// 4) daily_trends upsert (date_kst 기준)
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { collectAllTrends, rankTopN } from '@/lib/trend-collectors'
import { TREND_RESEARCH_PROMPT } from '@/lib/cardnews-prompt'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  // Cron secret 검증 (Vercel cron 은 Authorization: Bearer CRON_SECRET 으로 호출)
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 1) 수집
  const { items, stats } = await collectAllTrends()
  const top20 = rankTopN(items, 20)

  if (top20.length === 0) {
    return NextResponse.json({ ok: false, reason: 'no_feed_items', stats })
  }

  // 2) Claude 호출
  const userPrompt = `${TREND_RESEARCH_PROMPT}

## 입력 데이터 (rawFeedItems)
${JSON.stringify(top20, null, 2)}
`

  let claudeResp: unknown = null
  let parsed: {
    top5?: Array<Record<string, unknown>>
    recommended_topics?: Array<Record<string, unknown>>
  } = {}
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })
    claudeResp = await res.json()
    const text = (claudeResp as { content?: Array<{ text?: string }> })?.content?.[0]?.text || '{}'
    const match = text.match(/\{[\s\S]*\}/)
    if (match) parsed = JSON.parse(match[0])
  } catch (e) {
    return NextResponse.json({ ok: false, reason: 'claude_error', detail: String(e), stats })
  }

  // 3) KST 날짜 계산
  const now = new Date()
  const kstOffset = 9 * 60
  const kstNow = new Date(now.getTime() + (kstOffset - now.getTimezoneOffset()) * 60 * 1000)
  const dateKst = kstNow.toISOString().slice(0, 10)

  // 4) Supabase upsert
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { error } = await sb
    .from('daily_trends')
    .upsert({
      date_kst: dateKst,
      generated_at: new Date().toISOString(),
      top5: parsed.top5 || [],
      recommended_topics: parsed.recommended_topics || [],
      raw_feed_snapshot: top20,
      meta: {
        stats,
        usage: (claudeResp as { usage?: Record<string, unknown> })?.usage || null,
        model: 'claude-sonnet-4-20250514',
      },
    }, { onConflict: 'date_kst' })

  if (error) {
    return NextResponse.json({ ok: false, reason: 'db_error', detail: error.message, stats })
  }

  return NextResponse.json({
    ok: true,
    date_kst: dateKst,
    recommended_topics: parsed.recommended_topics || [],
    stats,
  })
}
