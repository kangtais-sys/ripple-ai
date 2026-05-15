// GET /api/cron/window-expiring
//   24시간 응대 윈도우 만료 1시간 전 카카오톡 알림
//
// 매시간 실행 → fan_profiles.window_expires_at < now + 1h AND > now AND 미응대
// 사용자한테 카톡 1건 발송: "곧 만료될 응대 N건 있어요"

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sb = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const now = new Date()
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000)

  // 1) 만료 임박 + inbound 받았지만 outbound 없는 팬 — 사용자별 집계
  const { data: expiring } = await sb
    .from('fan_profiles')
    .select(`
      id, user_id, ig_username,
      window_expires_at
    `)
    .gte('window_expires_at', now.toISOString())
    .lte('window_expires_at', oneHourFromNow.toISOString())
    .limit(500)

  if (!expiring?.length) return NextResponse.json({ ok: true, alerted: 0 })

  // 사용자별 그룹
  const byUser = new Map<string, typeof expiring>()
  for (const fan of expiring) {
    if (!byUser.has(fan.user_id)) byUser.set(fan.user_id, [])
    byUser.get(fan.user_id)!.push(fan)
  }

  let alerted = 0
  for (const [userId, fans] of byUser) {
    // 응대 안 한 팬 필터링 (마지막 conversation 가 inbound 인지 체크)
    const unhandled: typeof fans = []
    for (const f of fans) {
      const { data: lastConv } = await sb
        .from('conversations')
        .select('direction')
        .eq('user_id', userId).eq('fan_id', f.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (lastConv?.direction === 'inbound') unhandled.push(f)
    }
    if (unhandled.length === 0) continue

    // 솔라피 알림 (env 있을 때만)
    if (process.env.SOLAPI_API_KEY && process.env.SOLAPI_TEMPLATE_ID_WINDOW) {
      try {
        const { sendWindowExpiringAlert } = await import('@/lib/v2-reply/alert-window')
        await sendWindowExpiringAlert(sb, userId, unhandled.length)
        alerted++
      } catch (e) {
        console.error('[cron/window-expiring] solapi failed:', e)
      }
    }
  }

  return NextResponse.json({ ok: true, alerted, total_expiring: expiring.length })
}
