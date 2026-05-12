import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

// 베타 생애주기 cron — 매일 1회 (KST 09:00)
//   1. beta_ends_at 7일 전 → 알림톡 (beta_notified_7d 플래그)
//   2. beta_ends_at 1일 전 → 알림톡 (beta_notified_1d 플래그)
//   3. beta_ends_at 경과 → beta = false (자동 다운그레이드)
//
// 알림톡 템플릿 (솔라피):
//   - SSOBI_BETA_END_7D: "베타 종료 7일 전 안내"
//   - SSOBI_BETA_END_1D: "내일 베타 종료 — PRO 50% 할인 쿠폰 발급"
//   - SSOBI_BETA_ENDED: "베타 종료 — FREE 로 전환됨"
//
// 카카오 알림톡 환경변수가 없으면 알림은 skip, 다운그레이드 로직만 동작.

async function sendAlimtalk(
  email: string,
  templateCode: string,
  params: Record<string, string>
): Promise<boolean> {
  if (!process.env.KAKAO_ALIMTALK_API_KEY || !process.env.KAKAO_ALIMTALK_APP_KEY) return false
  try {
    const r = await fetch(
      `https://api-alimtalk.cloud.toast.com/alimtalk/v2.3/appkeys/${process.env.KAKAO_ALIMTALK_APP_KEY}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Secret-Key': process.env.KAKAO_ALIMTALK_API_KEY,
        },
        body: JSON.stringify({
          senderKey: process.env.KAKAO_SENDER_KEY,
          templateCode,
          recipientList: [
            {
              recipientNo: email, // 실서비스에선 phone 으로 교체 필요
              templateParameter: params,
            },
          ],
        }),
      }
    )
    return r.ok
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const now = Date.now()
  const in7d = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString()
  const in1d = new Date(now + 1 * 24 * 60 * 60 * 1000).toISOString()
  const nowIso = new Date(now).toISOString()

  // 1) 베타 종료 7일 전 알림 — 아직 안 보냈고 ends_at 이 향후 7일 이내
  const { data: list7d } = await supabase
    .from('profiles')
    .select('id, email, beta_ends_at')
    .eq('beta', true)
    .eq('beta_notified_7d', false)
    .gt('beta_ends_at', nowIso)
    .lte('beta_ends_at', in7d)

  let notified7d = 0
  for (const p of list7d || []) {
    if (!p.email || !p.beta_ends_at) continue
    const endsStr = new Date(p.beta_ends_at).toLocaleDateString('ko-KR')
    await sendAlimtalk(p.email, 'SSOBI_BETA_END_7D', { ends_at: endsStr })
    await supabase.from('profiles').update({ beta_notified_7d: true }).eq('id', p.id)
    notified7d++
  }

  // 2) 베타 종료 1일 전 알림
  const { data: list1d } = await supabase
    .from('profiles')
    .select('id, email, beta_ends_at')
    .eq('beta', true)
    .eq('beta_notified_1d', false)
    .gt('beta_ends_at', nowIso)
    .lte('beta_ends_at', in1d)

  let notified1d = 0
  for (const p of list1d || []) {
    if (!p.email || !p.beta_ends_at) continue
    await sendAlimtalk(p.email, 'SSOBI_BETA_END_1D', {})
    await supabase.from('profiles').update({ beta_notified_1d: true }).eq('id', p.id)
    notified1d++
  }

  // 3) 베타 종료 경과 → beta = false (FREE 로 자동 다운그레이드, plan 컬럼은 free 그대로)
  const { data: expired } = await supabase
    .from('profiles')
    .select('id, email')
    .eq('beta', true)
    .lte('beta_ends_at', nowIso)

  let downgraded = 0
  for (const p of expired || []) {
    await supabase.from('profiles').update({ beta: false }).eq('id', p.id)
    if (p.email) {
      await sendAlimtalk(p.email, 'SSOBI_BETA_ENDED', {})
    }
    downgraded++
  }

  return NextResponse.json({
    ok: true,
    notified7d,
    notified1d,
    downgraded,
  })
}
