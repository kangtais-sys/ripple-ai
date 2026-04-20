// POST /api/replies/[id]/approve
// body: { final_reply?: string }  — 있으면 수정본 발송, 없으면 AI 초안 그대로
// Instagram Graph API로 실제 발송 후 reply_logs·outbound_messages 업데이트

import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { NextResponse } from 'next/server'
import { sendCommentReply, sendDirectMessage, calcEditSimilarity, serviceClient } from '@/lib/ig-send'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = adminClient()

  const body = await req.json().catch(() => ({})) as {
    final_reply?: string
    also_send_dm?: boolean        // 댓글 승인 후 동일인에게 DM 초안도 생성
    dm_template?: string          // DM 기본 문구 (없으면 AI가 초안)
  }

  // 드래프트 조회 + 소유권 확인
  const { data: reply } = await sb
    .from('reply_logs')
    .select('*, ig_accounts!inner(id, access_token, user_id)')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!reply) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (reply.send_status === 'sent') return NextResponse.json({ error: 'already sent' }, { status: 409 })

  const igAccount = (reply as unknown as { ig_accounts: { id: string; access_token: string } }).ig_accounts
  if (!igAccount?.access_token) {
    return NextResponse.json({ error: 'no access token' }, { status: 400 })
  }

  // 최종 발송 텍스트 결정
  const aiDraft: string = reply.reply_text || ''
  const finalText: string = (body.final_reply || aiDraft).trim()
  if (!finalText) return NextResponse.json({ error: 'empty reply' }, { status: 400 })
  const userEdited = !!body.final_reply && body.final_reply.trim() !== aiDraft.trim()
  const similarity = userEdited ? calcEditSimilarity(aiDraft, finalText) : 1

  // 발송 — comment vs dm
  const context = (reply.context || {}) as {
    comment_id?: string
    sender_platform_id?: string
    recipient_handle?: string
    commenter_handle?: string
    commenter_platform_id?: string
    sender_handle?: string
  }
  const platformId = reply.platform_id as string | null

  // admin 클라이언트로 후속 업데이트 (outbound_messages는 owner RLS라 user 세션으로도 가능하나 확실히 하기 위해)
  const admin = serviceClient()

  let result: Awaited<ReturnType<typeof sendCommentReply>>
  try {
    if (reply.type === 'comment') {
      const commentId = context.comment_id || platformId || ''
      result = await sendCommentReply({
        accessToken: igAccount.access_token,
        commentId,
        message: finalText,
      })
    } else {
      const recipientId = context.sender_platform_id || platformId || ''
      result = await sendDirectMessage({
        accessToken: igAccount.access_token,
        recipientId,
        message: finalText,
      })
    }
  } catch (e) {
    result = { ok: false, status: 0, error: String(e) }
  }

  // reply_logs 업데이트
  await admin
    .from('reply_logs')
    .update({
      final_reply: finalText,
      is_approved: true,
      approved_at: new Date().toISOString(),
      approved_by: user.id,
      send_status: result.ok ? 'sent' : 'failed',
      edit_similarity: similarity,
    })
    .eq('id', id)

  // outbound_messages 해당 로그 상태 업데이트
  await admin
    .from('outbound_messages')
    .update({
      status: result.ok ? 'sent' : 'failed',
      sent_at: result.ok ? new Date().toISOString() : null,
      error_message: result.ok ? null : JSON.stringify(result.error || {}),
      platform_message_id: result.platformMessageId,
      body: finalText,
    })
    .eq('source_ref_type', 'reply_logs')
    .eq('source_ref_id', id)

  if (!result.ok) {
    return NextResponse.json({ error: 'send failed', detail: result.error }, { status: 502 })
  }

  // 사용량 카운트
  const month = new Date().toISOString().slice(0, 7)
  await admin.rpc('increment_usage', {
    p_user_id: user.id,
    p_month: month,
    p_type: reply.type,
  })

  // 댓글 승인 후 DM 초안 생성 옵션 (Comment-to-DM 플로우)
  let followupDmId: string | null = null
  if (reply.type === 'comment' && body.also_send_dm && context.commenter_platform_id) {
    const dmDraft = body.dm_template && body.dm_template.trim()
      ? body.dm_template.trim()
      : `안녕하세요! 댓글 주셔서 감사해요 🌿 요청 주신 내용은 아래로 안내드려요: (상세 링크·정보)`
    const { data: dmLog } = await admin.from('reply_logs').insert({
      user_id: user.id,
      ig_account_id: igAccount.id,
      type: 'dm',
      original_text: `댓글에 이어 DM 제안: ${reply.original_text || ''}`,
      reply_text: dmDraft,
      platform_id: context.commenter_platform_id,
      urgency: 'medium',
      sentiment: reply.sentiment,
      send_status: 'pending',
      is_approved: null,
      context: {
        sender_platform_id: context.commenter_platform_id,
        sender_handle: (context as { commenter_handle?: string }).commenter_handle || null,
        source_comment_reply_id: id,
        simulated: false,
      },
    }).select('id').single()
    followupDmId = dmLog?.id || null

    await admin.from('outbound_messages').insert({
      user_id: user.id,
      platform: 'instagram',
      kind: 'dm',
      recipient_platform_id: context.commenter_platform_id,
      recipient_handle: (context as { commenter_handle?: string }).commenter_handle || null,
      source_ref_type: 'reply_logs',
      source_ref_id: followupDmId,
      body: dmDraft,
      status: 'queued',
    })
  }

  return NextResponse.json({
    ok: true,
    sent: true,
    edited: userEdited,
    similarity,
    followup_dm_id: followupDmId,
  })
}
