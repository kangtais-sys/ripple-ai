import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { isOverLimit } from '@/lib/plans'
import { logAIUsage } from '@/lib/ai-usage'
import { classifyText, upsertFollower, recordOutboundMessage, maybeCreateRevenueProposal } from '@/lib/webhook-helpers'

type AdminClient = SupabaseClient

async function checkUserLimit(supabase: AdminClient, userId: string): Promise<boolean> {
  const month = new Date().toISOString().slice(0, 7)
  const [{ data: profile }, { data: usage }] = await Promise.all([
    supabase.from('profiles').select('plan').eq('id', userId).single(),
    supabase.from('usage_logs').select('comment_count, dm_count').eq('user_id', userId).eq('month', month).single(),
  ])
  const plan = profile?.plan || 'free'
  const comments = usage?.comment_count || 0
  const dms = usage?.dm_count || 0
  return !isOverLimit(plan, comments, dms)
}

// Webhook verification (GET)
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('hub.mode')
  const token = request.nextUrl.searchParams.get('hub.verify_token')
  const challenge = request.nextUrl.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

// Webhook event handler (POST)
export async function POST(request: NextRequest) {
  const body = await request.json()
  console.log('[Webhook] POST received, body preview:', JSON.stringify(body).slice(0, 500))

  // Admin client (bypasses RLS for webhook processing)
  const supabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 디버그용: webhook 전체 body 를 Supabase 에 임시 저장 (reply_logs 의 user_id=null 로 특수 기록)
  //   Vercel 로그가 console.log 를 안 싣는 이슈 회피용 — 운영 후 제거 가능
  try {
    await supabase.from('reply_logs').insert({
      user_id: null,
      type: 'comment',
      original_text: '__WEBHOOK_DEBUG__',
      reply_text: JSON.stringify(body).slice(0, 2000),
      send_status: 'skipped',
      is_approved: false,
      context: { debug: true, raw_body: body },
    })
  } catch (dbgErr) {
    console.error('[Webhook] debug log insert failed:', dbgErr)
  }

  try {
    const entries = body.entry || []
    console.log('[Webhook] entries count:', entries.length)

    for (const entry of entries) {
      const changes = entry.changes || []
      const messaging = entry.messaging || []
      console.log('[Webhook] entry', entry.id, '— changes:', changes.length, 'messaging:', messaging.length)

      for (const change of changes) {
        console.log('[Webhook] change.field =', change.field)
        if (change.field === 'comments') {
          await handleComment(supabase, change.value)
        }
        if (change.field === 'messages') {
          await handleMessage(supabase, change.value)
        }
      }

      // Instagram Messaging API 는 messaging 배열로 전달되기도 함
      for (const m of messaging) {
        console.log('[Webhook] messaging event:', JSON.stringify(m).slice(0, 200))
        await handleMessage(supabase, m)
      }
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[Webhook] Error:', error)
    return NextResponse.json({ received: true })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleComment(supabase: AdminClient, value: any) {
  const commentId = value.id as string
  const text = value.text as string

  console.log('[Webhook/Comment] received:', { commentId, text: text?.slice(0, 100), from: value.from })

  if (!text || !commentId) {
    console.log('[Webhook/Comment] skipped — missing text or id')
    return
  }

  const igUserId = String(value.from?.id || '')
  // media owner의 IG user ID로 찾아야 함 - 실제로는 media.owner 사용
  // 여기서는 webhook subscription의 IG 계정 기준으로 매칭

  // 연동된 모든 계정에서 이 미디어의 소유자 찾기
  const { data: accounts } = await supabase
    .from('ig_accounts')
    .select('id, user_id, ig_user_id, access_token')

  if (!accounts?.length) {
    console.log('[Webhook/Comment] no ig_accounts connected — ignored')
    return
  }

  console.log('[Webhook/Comment] checking', accounts.length, 'connected accounts against commenter', igUserId)

  for (const account of accounts) {
    if (account.ig_user_id === igUserId) {
      console.log('[Webhook/Comment] skip self-comment (account=commenter)', account.ig_user_id)
      continue
    }

    // 플랜 한도 체크
    const withinLimit = await checkUserLimit(supabase, account.user_id)
    if (!withinLimit) {
      console.log(`[Webhook] User ${account.user_id} over plan limit, skipping`)
      continue
    }

    try {
      const draft = await generateReply(account.user_id, text, supabase)
      console.log('[Webhook/Comment] generated draft:', draft?.slice(0, 80))
      if (!draft || draft === 'SKIP') continue

      const commenterHandle = value.from?.username || String(value.from?.id || '')
      const cls = classifyText(text)

      // 🎯 분기:
      //   - 긴급/부정/비즈 → pending (긴급 탭에서 유저 승인 필요)
      //   - 일반 → 자동 발송 (댓글·DM 탭에 "완료"로 쌓임)
      const isUrgent = cls.urgency === 'urgent' || cls.urgency === 'high' || cls.isBizProposal
      let sent = false
      let platformMsgId: string | undefined
      let errMsg: string | undefined

      if (!isUrgent) {
        // 자동 발송 (일반 케이스)
        const igRes = await fetch(
          `https://graph.instagram.com/v21.0/${commentId}/replies`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: draft, access_token: account.access_token }),
          }
        )
        const igData = await igRes.json().catch(() => ({}))
        sent = igRes.ok
        platformMsgId = igData.id
        if (!sent) errMsg = JSON.stringify(igData.error || igData)
      }

      const { data: replyLog } = await supabase.from('reply_logs').insert({
        user_id: account.user_id,
        ig_account_id: account.id,
        type: 'comment',
        original_text: text,
        reply_text: draft,
        final_reply: sent ? draft : null,
        platform_id: commentId,
        urgency: cls.urgency,
        sentiment: cls.sentiment,
        send_status: isUrgent ? 'pending' : (sent ? 'sent' : 'failed'),
        is_approved: isUrgent ? null : (sent ? true : null),
        approved_at: sent ? new Date().toISOString() : null,
        context: {
          comment_id: commentId,
          media_id: value.media?.id || null,
          parent_id: value.parent_id || null,
          commenter_handle: commenterHandle,
          commenter_platform_id: String(value.from?.id || ''),
          auto_sent: !isUrgent,
        },
      }).select('id').single()

      await recordOutboundMessage(supabase, {
        userId: account.user_id,
        platform: 'instagram',
        kind: 'comment_reply',
        body: draft,
        recipientHandle: commenterHandle,
        recipientPlatformId: String(value.from?.id || ''),
        status: isUrgent ? 'queued' : (sent ? 'sent' : 'failed'),
        platformMessageId: platformMsgId,
        errorMessage: errMsg,
        sourceRefType: 'reply_logs',
        sourceRefId: replyLog?.id,
      })

      if (commenterHandle) {
        await upsertFollower(supabase, {
          userId: account.user_id,
          platform: 'instagram',
          handle: commenterHandle,
          kind: 'comment',
          sentiment: cls.sentiment,
        })
      }

      if (!isUrgent && sent) {
        const month = new Date().toISOString().slice(0, 7)
        await supabase.rpc('increment_usage', {
          p_user_id: account.user_id,
          p_month: month,
          p_type: 'comment',
        })
      }

      console.log(`[Webhook] Comment ${isUrgent ? 'PENDING(긴급)' : (sent ? 'AUTO-SENT' : 'FAILED')}: "${draft.substring(0, 40)}" (${cls.urgency}/${cls.sentiment})`)
      break
    } catch (e) {
      console.error(`[Webhook] Comment handler error:`, e)
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleMessage(supabase: AdminClient, value: any) {
  const senderId = value.sender?.id
  const text = value.message?.text
  const messageId = value.message?.mid

  if (!senderId || !text || !messageId) return

  // 연동된 계정 중 이 메시지의 수신자 찾기
  const { data: accounts } = await supabase
    .from('ig_accounts')
    .select('id, user_id, ig_user_id, access_token')

  if (!accounts?.length) return

  for (const account of accounts) {
    if (account.ig_user_id === senderId) continue

    const withinLimit = await checkUserLimit(supabase, account.user_id)
    if (!withinLimit) {
      console.log(`[Webhook] User ${account.user_id} over plan limit (DM), skipping`)
      continue
    }

    try {
      const draft = await generateReply(account.user_id, text, supabase, 'dm')
      if (!draft || draft === 'SKIP') continue

      const senderHandle = value.sender?.username || String(senderId)
      const cls = classifyText(text)
      const isUrgent = cls.urgency === 'urgent' || cls.urgency === 'high' || cls.isBizProposal
      let sent = false
      let platformMsgId: string | undefined
      let errMsg: string | undefined

      if (!isUrgent) {
        const igRes = await fetch(
          `https://graph.instagram.com/v21.0/me/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${account.access_token}`,
            },
            body: JSON.stringify({ recipient: { id: senderId }, message: { text: draft } }),
          }
        )
        const igData = await igRes.json().catch(() => ({}))
        sent = igRes.ok
        platformMsgId = igData.message_id
        if (!sent) errMsg = JSON.stringify(igData.error || igData)
      }

      const { data: replyLog } = await supabase.from('reply_logs').insert({
        user_id: account.user_id,
        ig_account_id: account.id,
        type: 'dm',
        original_text: text,
        reply_text: draft,
        final_reply: sent ? draft : null,
        platform_id: String(senderId),
        urgency: cls.urgency,
        sentiment: cls.sentiment,
        send_status: isUrgent ? 'pending' : (sent ? 'sent' : 'failed'),
        is_approved: isUrgent ? null : (sent ? true : null),
        approved_at: sent ? new Date().toISOString() : null,
        context: {
          sender_platform_id: String(senderId),
          sender_handle: senderHandle,
          source_message_id: messageId,
          auto_sent: !isUrgent,
        },
      }).select('id').single()

      await recordOutboundMessage(supabase, {
        userId: account.user_id,
        platform: 'instagram',
        kind: 'dm',
        body: draft,
        recipientHandle: senderHandle,
        recipientPlatformId: String(senderId),
        status: isUrgent ? 'queued' : (sent ? 'sent' : 'failed'),
        platformMessageId: platformMsgId,
        errorMessage: errMsg,
        sourceRefType: 'reply_logs',
        sourceRefId: replyLog?.id,
      })

      if (senderHandle) {
        await upsertFollower(supabase, {
          userId: account.user_id,
          platform: 'instagram',
          handle: senderHandle,
          kind: 'dm',
          sentiment: cls.sentiment,
        })
      }

      await maybeCreateRevenueProposal(supabase, {
        userId: account.user_id,
        sourceChannel: 'instagram_dm',
        fromPlatformId: String(senderId),
        fromHandle: senderHandle,
        text,
      })

      if (!isUrgent && sent) {
        const month = new Date().toISOString().slice(0, 7)
        await supabase.rpc('increment_usage', {
          p_user_id: account.user_id,
          p_month: month,
          p_type: 'dm',
        })
      }

      console.log(`[Webhook] DM ${isUrgent ? 'PENDING(긴급)' : (sent ? 'AUTO-SENT' : 'FAILED')}: "${draft.substring(0, 40)}" (${cls.urgency}/${cls.sentiment})`)
      break
    } catch (e) {
      console.error(`[Webhook] DM draft error:`, e)
    }
  }
}

async function generateReply(
  userId: string,
  text: string,
  supabase: AdminClient,
  type: 'comment' | 'dm' = 'comment'
): Promise<string> {
  // 유저의 말투 프로필 + 브랜드 컨텍스트 + 금지어
  const { data: tone } = await supabase
    .from('tone_profiles')
    .select('learned_style, banned_words, brand_context')
    .eq('user_id', userId)
    .maybeSingle()

  const toneGuide = tone?.learned_style
    ? `\n\n유저의 말투 스타일: ${JSON.stringify(tone.learned_style)}`
    : ''
  const brandGuide = tone?.brand_context
    ? `\n\n내 계정 정보 (관련 문의에 정확히 안내):\n${tone.brand_context}`
    : ''
  const bannedList = Array.isArray(tone?.banned_words) ? tone.banned_words : []
  const bannedGuide = bannedList.length
    ? `\n\n절대 사용 금지 표현 (다른 단어로 대체): ${bannedList.join(', ')}`
    : ''

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: type === 'dm'
        ? `당신은 K-뷰티 인플루언서의 Instagram DM 응대를 대신합니다.
규칙:
- 친근하고 따뜻한 1:1 대화 말투
- 이모지 1-2개, 3문장 이내
- 계정 정보 참고해 정확히 안내, 구매 링크는 "프로필 링크" 안내
- 악성/스팸이면 "SKIP"만 반환
- 가격 직접 언급 금지
- 개인정보 요청 금지${toneGuide}${brandGuide}${bannedGuide}`
        : `당신은 K-뷰티 인플루언서의 SNS 댓글 응대를 대신합니다.
규칙:
- 친근하고 따뜻한 말투
- 이모지 1-2개, 2문장 이내
- 문의가 있으면 계정 정보 참고해 정확히 안내
- 악성/스팸이면 "SKIP"만 반환
- 가격 직접 언급 금지${toneGuide}${brandGuide}${bannedGuide}`,
      messages: [{ role: 'user', content: type === 'dm' ? `DM: "${text}"` : `댓글: "${text}"` }],
    }),
  })

  const data = await res.json()

  // AI 토큰·비용 로그 (webhook은 건당 비용이므로 가장 중요)
  await logAIUsage({
    userId,
    feature: type === 'dm' ? 'dm_gen' : 'reply_gen',
    model: 'claude-sonnet-4-20250514',
    usage: data.usage || {},
    refType: 'reply_logs',
  })

  return data.content?.[0]?.text?.trim() || ''
}
