import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { isOverLimit } from '@/lib/plans'

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
      const reply = await generateReply(account.user_id, text, supabase)
      if (!reply || reply === 'SKIP') continue

      // Instagram API로 답글 달기
      const igRes = await fetch(
        `https://graph.instagram.com/v21.0/${commentId}/replies`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: reply,
            access_token: account.access_token,
          }),
        }
      )

      const igData = await igRes.json()

      // 로그 저장
      await supabase.from('reply_logs').insert({
        user_id: account.user_id,
        ig_account_id: account.id,
        type: 'comment',
        original_text: text,
        reply_text: reply,
        platform_id: igData.id || commentId,
      })

      // 사용량 카운트
      const month = new Date().toISOString().slice(0, 7)
      await supabase.rpc('increment_usage', {
        p_user_id: account.user_id,
        p_month: month,
        p_type: 'comment',
      })

      console.log(`[Webhook] Replied to comment ${commentId}: "${reply.substring(0, 40)}"`)
      break // 첫 매칭 계정만 처리
    } catch (e) {
      console.error(`[Webhook] Comment reply error:`, e)
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
      const reply = await generateReply(account.user_id, text, supabase, 'dm')
      if (!reply || reply === 'SKIP') continue

      // Instagram Send API로 DM 발송 (24시간 윈도우 내)
      const igRes = await fetch(
        `https://graph.instagram.com/v21.0/me/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${account.access_token}`,
          },
          body: JSON.stringify({
            recipient: { id: senderId },
            message: { text: reply },
          }),
        }
      )

      const igData = await igRes.json()
      const status = igRes.ok ? 'sent' : `error:${igData.error?.message || igRes.status}`

      await supabase.from('reply_logs').insert({
        user_id: account.user_id,
        ig_account_id: account.id,
        type: 'dm',
        original_text: text,
        reply_text: reply,
        platform_id: igData.message_id || messageId,
      })

      const month = new Date().toISOString().slice(0, 7)
      await supabase.rpc('increment_usage', {
        p_user_id: account.user_id,
        p_month: month,
        p_type: 'dm',
      })

      console.log(`[Webhook] DM reply to ${senderId}: "${reply.substring(0, 40)}" → ${status}`)
      break
    } catch (e) {
      console.error(`[Webhook] DM reply error:`, e)
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
  return data.content?.[0]?.text?.trim() || ''
}
