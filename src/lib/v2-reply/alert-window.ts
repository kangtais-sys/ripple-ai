// 24h 만료 임박 알림 (사용자별 1건)

import type { SupabaseClient } from '@supabase/supabase-js'

const SOLAPI_URL = 'https://api.solapi.com/messages/v4/send-many'

async function authHeader(): Promise<string> {
  const apiKey = process.env.SOLAPI_API_KEY!
  const apiSecret = process.env.SOLAPI_API_SECRET!
  const date = new Date().toISOString()
  const salt = crypto.randomUUID()
  const data = date + salt
  const encoder = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
  const signature = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `HMAC-SHA256 ApiKey=${apiKey}, Date=${date}, Salt=${salt}, Signature=${signature}`
}

export async function sendWindowExpiringAlert(
  sb: SupabaseClient,
  userId: string,
  expiringCount: number,
): Promise<{ ok: boolean; error?: string }> {
  const { data: prof } = await sb
    .from('profiles')
    .select('phone, notify_kakao, link_handle')
    .eq('id', userId)
    .maybeSingle()
  if (!prof?.phone || prof.notify_kakao === false) {
    return { ok: false, error: 'phone_or_consent_missing' }
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://ssobi.ai'
  try {
    const auth = await authHeader()
    const res = await fetch(SOLAPI_URL, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{
          to: prof.phone,
          from: process.env.SOLAPI_SENDER_NUMBER,
          type: 'ATA',
          kakaoOptions: {
            pfId: process.env.SOLAPI_PFID,
            templateId: process.env.SOLAPI_TEMPLATE_ID_WINDOW,
            variables: {
              '#{count}': String(expiringCount),
              '#{url}': `${baseUrl}/app#v-activity`,
            },
          },
        }],
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      return { ok: false, error: `solapi_${res.status}: ${err.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send_failed' }
  }
}
