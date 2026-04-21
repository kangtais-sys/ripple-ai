// POST /api/ig/resubscribe
// 이미 연동된 IG 계정에 대해 webhook 구독을 다시 활성화
// (OAuth 콜백이 구독 API 를 호출하기 전에 연동한 계정용 유틸)
import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = adminClient()
  const { data: accs } = await sb
    .from('ig_accounts')
    .select('ig_user_id, access_token, ig_username')
    .eq('user_id', user.id)

  if (!accs?.length) return NextResponse.json({ error: 'no_ig_account' }, { status: 400 })

  const results: Array<{ username: string; ok: boolean; detail?: unknown }> = []
  for (const acc of accs) {
    try {
      const form = new URLSearchParams()
      form.set('subscribed_fields', 'comments,messages')
      form.set('access_token', acc.access_token)
      const res = await fetch(
        `https://graph.instagram.com/v21.0/me/subscribed_apps`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        }
      )
      const json = await res.json().catch(() => ({}))
      results.push({
        username: acc.ig_username,
        ok: !!json.success || res.ok,
        detail: json,
      })
    } catch (e) {
      results.push({ username: acc.ig_username, ok: false, detail: String(e) })
    }
  }

  return NextResponse.json({ ok: true, results })
}

// GET: 현재 구독 상태 확인
export async function GET(req: Request) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = adminClient()
  const { data: accs } = await sb
    .from('ig_accounts')
    .select('ig_user_id, access_token, ig_username')
    .eq('user_id', user.id)

  if (!accs?.length) return NextResponse.json({ error: 'no_ig_account' }, { status: 400 })

  const results: Array<{ username: string; subscribed: boolean; data?: unknown }> = []
  for (const acc of accs) {
    try {
      const res = await fetch(
        `https://graph.instagram.com/v21.0/${acc.ig_user_id}/subscribed_apps?access_token=${acc.access_token}`
      )
      const json = await res.json().catch(() => ({}))
      const subscribed = Array.isArray(json.data) && json.data.length > 0
      results.push({ username: acc.ig_username, subscribed, data: json })
    } catch (e) {
      results.push({ username: acc.ig_username, subscribed: false, data: String(e) })
    }
  }

  return NextResponse.json({ ok: true, results })
}
