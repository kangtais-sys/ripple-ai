// Instagram Graph API 실제 발송 헬퍼
// 댓글(comment_reply)은 comment_id에 replies 추가, DM은 send API

import { createClient as createAdmin } from '@supabase/supabase-js'

type SendResult = {
  ok: boolean
  platformMessageId?: string
  status: number
  error?: unknown
}

export async function sendCommentReply(args: {
  accessToken: string
  commentId: string
  message: string
}): Promise<SendResult> {
  const res = await fetch(
    `https://graph.instagram.com/v21.0/${args.commentId}/replies`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: args.message, access_token: args.accessToken }),
    }
  )
  const data = await res.json().catch(() => ({}))
  return {
    ok: res.ok,
    status: res.status,
    platformMessageId: data.id,
    error: res.ok ? undefined : data.error || data,
  }
}

export async function sendDirectMessage(args: {
  accessToken: string
  recipientId: string
  message: string
}): Promise<SendResult> {
  const res = await fetch(`https://graph.instagram.com/v21.0/me/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: args.recipientId },
      message: { text: args.message },
    }),
  })
  const data = await res.json().catch(() => ({}))
  return {
    ok: res.ok,
    status: res.status,
    platformMessageId: data.message_id,
    error: res.ok ? undefined : data.error || data,
  }
}

// 서버측 admin 클라이언트
export function serviceClient() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// AI 초안과 최종 발송본 유사도 (단순 토큰 비율, 0~1)
export function calcEditSimilarity(aiDraft: string, finalReply: string): number {
  if (!aiDraft || !finalReply) return 0
  if (aiDraft === finalReply) return 1
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const a = norm(aiDraft).split(' ')
  const b = norm(finalReply).split(' ')
  const setA = new Set(a)
  const setB = new Set(b)
  let inter = 0
  for (const t of setA) if (setB.has(t)) inter++
  const union = setA.size + setB.size - inter
  return union === 0 ? 0 : inter / union
}
