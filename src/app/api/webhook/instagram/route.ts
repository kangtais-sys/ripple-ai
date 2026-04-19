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

  // Admin client (bypasses RLS for webhook processing)
  const supabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    const entries = body.entry || []

    for (const entry of entries) {
      const changes = entry.changes || []

      for (const change of changes) {
        if (change.field === 'comments') {
          await handleComment(supabase, change.value)
        }
        if (change.field === 'messages') {
          await handleMessage(supabase, change.value)
        }
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

  if (!text || !commentId) return

  const igUserId = String(value.from?.id || '')
  // media owner의 IG user ID로 찾아야 함 - 실제로는 media.owner 사용
  // 여기서는 webhook subscription의 IG 계정 기준으로 매칭

  // 연동된 모든 계정에서 이 미디어의 소유자 찾기
  const { data: accounts } = await supabase
    .from('ig_accounts')
    .select('id, user_id, ig_user_id, access_token')

  if (!accounts?.length) return

  for (const account of accounts) {
    if (account.ig_user_id === igUserId) continue

    // 플랜 한도 체크
    const withinLimit = await checkUserLimit(supabase, account.user_id)
    if (!withinLimit) {
      console.log(`[Webhook] User ${account.user_id} over plan limit, skipping`)
      continue
    }

    try {
      const draft = await generateReply(account.user_id, text, supabase)
      if (!draft || draft === 'SKIP') continue

      // ⚠️ Meta 심사 대응: 자동 발송 제거. 드래프트로 저장하고 유저 승인 대기.
      // 유저가 "실시간 관리"에서 [승인·발송] 누르면 /api/replies/[id]/approve 호출.
      const commenterHandle = value.from?.username || String(value.from?.id || '')
      const cls = classifyText(text)

      const { data: replyLog } = await supabase.from('reply_logs').insert({
        user_id: account.user_id,
        ig_account_id: account.id,
        type: 'comment',
        original_text: text,
        reply_text: draft,         // AI 초안
        platform_id: commentId,    // 답글 달 대상 comment_id
        urgency: cls.urgency,
        sentiment: cls.sentiment,
        send_status: 'pending',    // 승인 대기
        is_approved: null,
        context: {
          comment_id: commentId,
          media_id: value.media?.id || null,
          parent_id: value.parent_id || null,
          commenter_handle: commenterHandle,
          commenter_platform_id: String(value.from?.id || ''),
        },
      }).select('id').single()

      // outbound 로그 — 대기 상태
      await recordOutboundMessage(supabase, {
        userId: account.user_id,
        platform: 'instagram',
        kind: 'comment_reply',
        body: draft,
        recipientHandle: commenterHandle,
        recipientPlatformId: String(value.from?.id || ''),
        status: 'queued',
        sourceRefType: 'reply_logs',
        sourceRefId: replyLog?.id,
      })

      // 팔로워 CRM 업데이트 (발송과 무관하게 접촉 기록)
      if (commenterHandle) {
        await upsertFollower(supabase, {
          userId: account.user_id,
          platform: 'instagram',
          handle: commenterHandle,
          kind: 'comment',
          sentiment: cls.sentiment,
        })
      }

      console.log(`[Webhook] Draft queued for comment ${commentId}: "${draft.substring(0, 40)}" (${cls.urgency}/${cls.sentiment})`)
      break // 첫 매칭 계정만 처리
    } catch (e) {
      console.error(`[Webhook] Comment draft error:`, e)
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

      // ⚠️ 자동 발송 제거 — 드래프트 저장 후 유저 승인 대기
      const senderHandle = value.sender?.username || String(senderId)
      const cls = classifyText(text)

      const { data: replyLog } = await supabase.from('reply_logs').insert({
        user_id: account.user_id,
        ig_account_id: account.id,
        type: 'dm',
        original_text: text,
        reply_text: draft,
        platform_id: String(senderId),
        urgency: cls.urgency,
        sentiment: cls.sentiment,
        send_status: 'pending',
        is_approved: null,
        context: {
          sender_platform_id: String(senderId),
          sender_handle: senderHandle,
          source_message_id: messageId,
        },
      }).select('id').single()

      await recordOutboundMessage(supabase, {
        userId: account.user_id,
        platform: 'instagram',
        kind: 'dm',
        body: draft,
        recipientHandle: senderHandle,
        recipientPlatformId: String(senderId),
        status: 'queued',
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

      // 비즈 DM 자동 분류 → revenue_proposals 적재
      await maybeCreateRevenueProposal(supabase, {
        userId: account.user_id,
        sourceChannel: 'instagram_dm',
        fromPlatformId: String(senderId),
        fromHandle: senderHandle,
        text,
      })

      console.log(`[Webhook] DM draft queued for ${senderId}: "${draft.substring(0, 40)}" (${cls.urgency}/${cls.sentiment})`)
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
  // 유저의 말투 프로필 가져오기
  const { data: tone } = await supabase
    .from('tone_profiles')
    .select('learned_style')
    .eq('user_id', userId)
    .single()

  const toneGuide = tone?.learned_style
    ? `\n\n유저의 말투 스타일: ${JSON.stringify(tone.learned_style)}`
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
- 제품 문의 → 자세한 안내 가능, 구매 링크는 "프로필 링크" 안내
- 악성/스팸이면 "SKIP"만 반환
- 가격 직접 언급 금지
- 개인정보 요청 금지${toneGuide}`
        : `당신은 K-뷰티 인플루언서의 SNS 댓글 응대를 대신합니다.
규칙:
- 친근하고 따뜻한 말투
- 이모지 1-2개, 2문장 이내
- 악성/스팸이면 "SKIP"만 반환
- 가격 직접 언급 금지${toneGuide}`,
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
