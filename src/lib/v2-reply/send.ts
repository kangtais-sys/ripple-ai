// v2 — IG Graph API 발송 helper
//
// 댓글 답글: POST /v21.0/{comment_id}/replies
// DM:       POST /v21.0/me/messages

const IG_API_BASE = 'https://graph.instagram.com/v21.0'

export interface SendResult {
  ok: boolean
  id?: string
  error?: string
}

export async function sendCommentReply(
  accessToken: string,
  commentId: string,
  message: string,
): Promise<SendResult> {
  try {
    const res = await fetch(`${IG_API_BASE}/${commentId}/replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, access_token: accessToken }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: JSON.stringify(data.error || data).slice(0, 300) }
    }
    return { ok: true, id: data.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'fetch_failed' }
  }
}

export async function sendDirectMessage(
  accessToken: string,
  recipientIgUserId: string,
  message: string,
): Promise<SendResult> {
  try {
    const res = await fetch(`${IG_API_BASE}/me/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientIgUserId },
        message: { text: message },
        access_token: accessToken,
      }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: JSON.stringify(data.error || data).slice(0, 300) }
    }
    return { ok: true, id: data.message_id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'fetch_failed' }
  }
}
