// 개발용: 가짜 IG 댓글을 시뮬레이션해서 대기 드래프트 생성
// 본인의 ig_accounts 기반. dev 환경 또는 ?dev=1 세션용.

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { classifyText, recordOutboundMessage, upsertFollower } from '@/lib/webhook-helpers'
import { logAIUsage } from '@/lib/ai-usage'

export async function POST(req: Request) {
  // 1) Authorization: Bearer <access_token> 우선 (Supabase JS CDN = localStorage 세션)
  // 2) 없으면 쿠키 세션 (SSR)
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  let user: { id: string } | null = null
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const { data } = await admin.auth.getUser(token)
    if (data.user) user = { id: data.user.id }
  }
  if (!user) {
    const sb = await createClient()
    const { data: { user: cookieUser } } = await sb.auth.getUser()
    if (cookieUser) user = { id: cookieUser.id }
  }
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = admin  // 이후 쿼리는 admin 으로 (토큰 검증 완료, RLS 우회 OK)

  const body = await req.json().catch(() => ({})) as {
    type?: 'comment' | 'dm'
    text?: string
    from_handle?: string
  }

  const type = body.type === 'dm' ? 'dm' : 'comment'
  const text = body.text || (type === 'dm'
    ? '제품 공구 언제 열려요? 저번에 놓쳐서 이번에는 꼭 받고 싶어요!'
    : '이 제품 어디서 살 수 있어요? 올리브영에는 없던데요 ㅠ')
  const fromHandle = body.from_handle || 'demo_visitor_99'

  // ig_accounts 중 아무거나 하나 (없으면 에러)
  const { data: account } = await sb
    .from('ig_accounts')
    .select('id, ig_user_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (!account) {
    return NextResponse.json({
      error: 'Instagram 계정이 연동되지 않았습니다. 먼저 연결해주세요.',
    }, { status: 400 })
  }

  // 유저 말투 읽기
  const { data: tone } = await sb
    .from('tone_profiles')
    .select('learned_style')
    .eq('user_id', user.id)
    .maybeSingle()

  // Claude 초안 생성
  const toneGuide = tone?.learned_style
    ? `\n\n유저의 말투 스타일: ${JSON.stringify(tone.learned_style)}`
    : ''

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
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
- 가격 직접 언급 금지${toneGuide}`
        : `당신은 K-뷰티 인플루언서의 SNS 댓글 응대를 대신합니다.
규칙:
- 친근하고 따뜻한 말투
- 이모지 1-2개, 2문장 이내
- 가격 직접 언급 금지${toneGuide}`,
      messages: [{ role: 'user', content: type === 'dm' ? `DM: "${text}"` : `댓글: "${text}"` }],
    }),
  })

  const claudeData = await claudeRes.json()
  const draft = claudeData.content?.[0]?.text?.trim() || ''

  if (!draft || draft === 'SKIP') {
    return NextResponse.json({ error: 'AI가 초안 생성 실패' }, { status: 500 })
  }

  await logAIUsage({
    userId: user.id,
    feature: type === 'dm' ? 'dm_gen' : 'reply_gen',
    model: 'claude-sonnet-4-20250514',
    usage: claudeData.usage || {},
    refType: 'reply_logs',
  })

  const cls = classifyText(text)
  const fakeCommentId = 'demo_' + Math.random().toString(36).slice(2, 10)
  const isUrgent = cls.urgency === 'urgent' || cls.urgency === 'high' || cls.isBizProposal

  // 시뮬레이션: 긴급이면 pending, 그 외에는 자동 발송된 것처럼 sent 로 기록
  // (실제 IG API 호출은 가짜 ID라서 생략)
  const now = new Date().toISOString()

  const { data: replyLog } = await sb
    .from('reply_logs')
    .insert({
      user_id: user.id,
      ig_account_id: account.id,
      type,
      original_text: text,
      reply_text: draft,
      final_reply: isUrgent ? null : draft,
      platform_id: fakeCommentId,
      urgency: cls.urgency,
      sentiment: cls.sentiment,
      send_status: isUrgent ? 'pending' : 'sent',
      is_approved: isUrgent ? null : true,
      approved_at: isUrgent ? null : now,
      context: type === 'comment'
        ? {
            comment_id: fakeCommentId,
            commenter_handle: fromHandle,
            commenter_platform_id: 'demo_user_' + fromHandle,
            simulated: true,
            auto_sent: !isUrgent,
          }
        : {
            sender_platform_id: 'demo_user_' + fromHandle,
            sender_handle: fromHandle,
            source_message_id: fakeCommentId,
            simulated: true,
            auto_sent: !isUrgent,
          },
    })
    .select('id')
    .single()

  await recordOutboundMessage(sb, {
    userId: user.id,
    platform: 'instagram',
    kind: type === 'dm' ? 'dm' : 'comment_reply',
    body: draft,
    recipientHandle: fromHandle,
    recipientPlatformId: 'demo_user_' + fromHandle,
    status: isUrgent ? 'queued' : 'sent',
    sourceRefType: 'reply_logs',
    sourceRefId: replyLog?.id,
  })

  await upsertFollower(sb, {
    userId: user.id,
    platform: 'instagram',
    handle: fromHandle,
    kind: type === 'dm' ? 'dm' : 'comment',
    sentiment: cls.sentiment,
  })

  return NextResponse.json({
    ok: true,
    reply_log_id: replyLog?.id,
    draft,
    classification: cls,
  })
}
