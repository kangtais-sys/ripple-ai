// GET·POST /api/quick/[token]
//   pending_reply 를 token 으로 인증 후 조회 / 발송
//
// 인증 모델: approval_token 자체가 인증. 로그인 X.
// 보안: token 32자 random, DB 에 UNIQUE.
//   알림톡으로만 전달돼 사용자만 알 수 있음.
//
// GET   — pending_reply 정보 반환 (모바일 페이지 fetch)
// POST  — 발송 (action: 'send' | 'edit_send' | 'ignore')

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

const TOKEN_RE = /^[a-z0-9]{32}$/

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!TOKEN_RE.test(token)) return NextResponse.json({ error: 'invalid_token' }, { status: 400 })

  const sb = admin()
  const { data, error } = await sb
    .from('pending_replies')
    .select('id, channel, original_message, ai_draft, intent, window_expires_at, status, sent_at, fan_id')
    .eq('approval_token', token)
    .maybeSingle()

  if (error || !data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (data.status !== 'pending') {
    return NextResponse.json({ pending: data, expired: true })
  }
  if (new Date(data.window_expires_at) < new Date()) {
    // 만료 → status 갱신
    await sb.from('pending_replies').update({ status: 'expired' }).eq('id', data.id)
    return NextResponse.json({ pending: { ...data, status: 'expired' }, expired: true })
  }

  // 팬 정보 추가
  let fanInfo = null
  if (data.fan_id) {
    const { data: fan } = await sb
      .from('fan_profiles')
      .select('ig_username, display_name')
      .eq('id', data.fan_id)
      .maybeSingle()
    fanInfo = fan
  }

  return NextResponse.json({ pending: data, fan: fanInfo, expired: false })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!TOKEN_RE.test(token)) return NextResponse.json({ error: 'invalid_token' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as {
    action?: 'send' | 'edit_send' | 'ignore'
    final_message?: string
  }
  const action = body.action || 'send'

  const sb = admin()
  const { data: pending } = await sb
    .from('pending_replies')
    .select('id, user_id, fan_id, channel, original_message, original_message_id, ai_draft, window_expires_at, status, conversation_id')
    .eq('approval_token', token)
    .maybeSingle()

  if (!pending) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (pending.status !== 'pending') return NextResponse.json({ error: 'already_processed', status: pending.status }, { status: 409 })

  // 만료 체크
  if (new Date(pending.window_expires_at) < new Date()) {
    await sb.from('pending_replies').update({ status: 'expired' }).eq('id', pending.id)
    return NextResponse.json({ error: 'window_expired' }, { status: 410 })
  }

  // action: ignore
  if (action === 'ignore') {
    await sb.from('pending_replies').update({
      status: 'ignored',
      approved_at: new Date().toISOString(),
    }).eq('id', pending.id)
    return NextResponse.json({ ok: true, action: 'ignored' })
  }

  // action: send | edit_send
  const finalMessage = (action === 'edit_send' && body.final_message)
    ? body.final_message.trim()
    : pending.ai_draft
  if (!finalMessage) return NextResponse.json({ error: 'empty_message' }, { status: 400 })

  // 1) IG Graph API 호출
  const { data: igAcc } = await sb
    .from('ig_accounts')
    .select('access_token')
    .eq('user_id', pending.user_id)
    .maybeSingle()
  if (!igAcc?.access_token) {
    return NextResponse.json({ error: 'no_ig_token' }, { status: 500 })
  }

  // DM 의 경우 recipient (fan) 의 ig_user_id 필요
  let recipientIgUserId: string | null = null
  if (pending.channel === 'dm' && pending.fan_id) {
    const { data: fan } = await sb
      .from('fan_profiles').select('ig_user_id').eq('id', pending.fan_id).maybeSingle()
    recipientIgUserId = fan?.ig_user_id || null
  }

  const { sendCommentReply, sendDirectMessage } = await import('@/lib/v2-reply/send')
  const sendResult = pending.channel === 'comment'
    ? await sendCommentReply(igAcc.access_token, pending.original_message_id, finalMessage)
    : recipientIgUserId
      ? await sendDirectMessage(igAcc.access_token, recipientIgUserId, finalMessage)
      : { ok: false as const, error: 'no_recipient_id' }

  if (!sendResult.ok) {
    await sb.from('send_attempts').insert({
      user_id: pending.user_id, fan_id: pending.fan_id,
      channel: pending.channel, draft_content: finalMessage,
      status: 'failed', block_reason: sendResult.error,
    })
    return NextResponse.json({ error: 'send_failed', detail: sendResult.error }, { status: 502 })
  }

  // 2) pending_replies 상태 갱신
  await sb.from('pending_replies').update({
    status: action === 'edit_send' ? 'edited_sent' : 'sent',
    approved_at: new Date().toISOString(),
    sent_at: new Date().toISOString(),
    final_message: finalMessage,
  }).eq('id', pending.id)

  // 3) conversation outbound 추가
  await sb.from('conversations').insert({
    user_id: pending.user_id,
    fan_id: pending.fan_id,
    channel: pending.channel,
    direction: 'outbound',
    content: finalMessage,
    ai_drafted: true,
    is_approved: true,
    approved_by_user: true,
    ig_message_id: pending.channel === 'dm' ? sendResult.id : null,
    ig_comment_id: pending.channel === 'comment' ? sendResult.id : null,
  })

  // 4) send_attempts audit
  await sb.from('send_attempts').insert({
    user_id: pending.user_id,
    fan_id: pending.fan_id,
    channel: pending.channel,
    draft_content: finalMessage,
    status: 'sent',
  })

  return NextResponse.json({ ok: true, action, final_message: finalMessage, ig_id: sendResult.id })
}
