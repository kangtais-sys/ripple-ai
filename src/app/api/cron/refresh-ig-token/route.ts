import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

// 매주 실행 — 만료 7일 전 토큰 자동 갱신
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 7일 이내 만료되는 토큰 조회
  const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: accounts } = await supabase
    .from('ig_accounts')
    .select('id, ig_username, access_token, token_expires_at')
    .lt('token_expires_at', sevenDaysLater)

  if (!accounts?.length) {
    return NextResponse.json({ message: 'No tokens to refresh', refreshed: 0 })
  }

  const results = []

  for (const account of accounts) {
    try {
      // Instagram long-lived token refresh (60일 연장)
      const res = await fetch(
        `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${account.access_token}`
      )
      const data = await res.json()

      if (data.access_token) {
        const newExpiry = new Date(Date.now() + (data.expires_in || 5184000) * 1000).toISOString()

        await supabase
          .from('ig_accounts')
          .update({
            access_token: data.access_token,
            token_expires_at: newExpiry,
          })
          .eq('id', account.id)

        results.push({ username: account.ig_username, status: 'refreshed', expires: newExpiry })
        console.log(`[Token Refresh] @${account.ig_username} refreshed, expires: ${newExpiry}`)
      } else {
        results.push({ username: account.ig_username, status: 'failed', error: data.error?.message })
        console.error(`[Token Refresh] @${account.ig_username} failed:`, data.error)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      results.push({ username: account.ig_username, status: 'error', error: msg })
      console.error(`[Token Refresh] @${account.ig_username} error:`, msg)
    }
  }

  return NextResponse.json({ refreshed: results.filter(r => r.status === 'refreshed').length, results })
}
