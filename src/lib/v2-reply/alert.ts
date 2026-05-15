// 솔라피 카카오 알림톡 발송 — pending_replies 승인 요청
//
// docs: https://docs.solapi.com/api-reference/messages/sendmany
//
// 사용: env SOLAPI_API_KEY + SOLAPI_API_SECRET + SOLAPI_PFID + SOLAPI_TEMPLATE_ID
// 미설정 시 silent skip (응대 흐름 막지 않음)

import type { SupabaseClient } from '@supabase/supabase-js'

const SOLAPI_URL = 'https://api.solapi.com/messages/v4/send-many'

export function isSolapiConfigured(): boolean {
  return !!(process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET && process.env.SOLAPI_PFID)
}

/**
 * 솔라피 HMAC-SHA256 인증 헤더 생성
 */
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

/**
 * pending_reply 에 대한 카카오 알림톡 발송.
 * 사용자한테 알림 → 모바일 1-탭 승인 페이지 URL 포함
 */
export async function sendApprovalAlert(
  sb: SupabaseClient,
  userId: string,
  pendingReplyId: string,
  approvalToken: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSolapiConfigured()) {
    return { ok: false, error: 'solapi_not_configured' }
  }

  // 1) 사용자 알림 채널 (휴대폰 번호) 가져오기
  const { data: prof } = await sb
    .from('profiles')
    .select('phone, name, notify_kakao')
    .eq('id', userId)
    .maybeSingle()
  if (!prof?.phone || prof.notify_kakao === false) {
    return { ok: false, error: 'phone_or_consent_missing' }
  }

  // 2) pending_reply 정보
  const { data: pending } = await sb
    .from('pending_replies')
    .select('original_message, ai_draft, intent, window_expires_at')
    .eq('id', pendingReplyId)
    .single()
  if (!pending) return { ok: false, error: 'pending_not_found' }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://ssobi.ai'
  const quickUrl = `${baseUrl}/quick/${approvalToken}`
  const hoursLeft = Math.max(0, Math.round((new Date(pending.window_expires_at).getTime() - Date.now()) / (60 * 60 * 1000)))

  // 3) 알림톡 발송 (templateId 는 사전 등록 필요)
  const templateId = process.env.SOLAPI_TEMPLATE_ID
  if (!templateId) return { ok: false, error: 'template_id_missing' }

  try {
    const auth = await authHeader()
    const res = await fetch(SOLAPI_URL, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{
          to: prof.phone,
          from: process.env.SOLAPI_SENDER_NUMBER,
          type: 'ATA',                                 // 알림톡 type
          kakaoOptions: {
            pfId: process.env.SOLAPI_PFID,
            templateId,
            variables: {
              '#{intent}': pending.intent || '응대 대기',
              '#{message}': (pending.original_message || '').slice(0, 100),
              '#{draft}': (pending.ai_draft || '').slice(0, 200),
              '#{hours}': String(hoursLeft),
              '#{quickUrl}': quickUrl,
            },
          },
        }],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      return { ok: false, error: `solapi_${res.status}: ${err.slice(0, 200)}` }
    }

    // 4) pending_replies.notified_at 갱신
    await sb.from('pending_replies')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', pendingReplyId)

    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send_failed' }
  }
}
