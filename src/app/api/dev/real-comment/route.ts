// 검수 시연용: 진짜 IG comment_id 를 받아 simulated:false 로 pending 행 생성
// → 기존 /api/replies/[id]/approve 파이프라인으로 실제 POST /replies 발송
// devSimulate(simulated:true)와 분리된 별도 트랙. DM 은 의도적으로 미지원.

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { classifyText, recordOutboundMessage, upsertFollower } from '@/lib/webhook-helpers'
import { logAIUsage } from '@/lib/ai-usage'

export async function POST(req: Request) {
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

  const sb = admin

  const body = await req.json().catch(() => ({})) as {
    comment_id?: string
    text?: string
    from_handle?: string
  }

  const commentId = (body.comment_id || '').trim()
  const text = (body.text || '').trim()
  const fromHandle = (body.from_handle || 'real_commenter').trim()

  if (!commentId) {
    return NextResponse.json({ error: 'comment_id is required' }, { status: 400 })
  }
  if (!/^\d{6,}$/.test(commentId)) {
    return NextResponse.json({ error: 'comment_id must be a numeric IG id (no demo_*)' }, { status: 400 })
  }
  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }

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

  const { data: tone } = await sb
    .from('tone_profiles')
    .select('learned_style, banned_words, brand_context')
    .eq('user_id', user.id)
    .maybeSingle()

  const toneGuide = tone?.learned_style
    ? `\n\n유저의 말투 스타일: ${JSON.stringify(tone.learned_style)}`
    : ''
  const brandGuide = tone?.brand_context
    ? `\n\n내 계정 정보 (관련 문의에 정확히 안내):\n${tone.brand_context}`
    : ''
  const bannedList = Array.isArray(tone?.banned_words) ? tone.banned_words : []
  const bannedGuide = bannedList.length
    ? `\n\n절대 사용 금지 표현: ${bannedList.join(', ')}`
    : ''

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 200,
      system: `CRITICAL LANGUAGE RULE: Detect the language of the incoming comment and reply in EXACTLY that language. If the comment is in English, your reply MUST be in English only. If Korean, Korean only. If Japanese, Japanese only. The learned style examples below are reference for TONE only, never copy their language.

당신은 이 계정의 SNS 댓글 응대를 학습된 말투와 브랜드 정보로 대신합니다.
규칙:
- 학습된 톤 우선, 2문장 이내
- 이모지는 학습된 패턴에 맞춰 자연스럽게
- 문의가 있으면 계정 정보 참고해 정확히 안내
- 가격 직접 언급 금지${toneGuide}${brandGuide}${bannedGuide}`,
      messages: [{ role: 'user', content: `Comment: "${text}"` }],
    }),
  })

  const claudeData = await claudeRes.json()
  const draft = claudeData.content?.[0]?.text?.trim() || ''

  if (!draft || draft === 'SKIP') {
    return NextResponse.json({ error: 'AI가 초안 생성 실패' }, { status: 500 })
  }

  await logAIUsage({
    userId: user.id,
    feature: 'reply_gen',
    model: 'claude-sonnet-4-5-20250929',
    usage: claudeData.usage || {},
    refType: 'reply_logs',
  })

  const cls = classifyText(text)

  // 항상 pending — 자동 발송 금지. 사용자가 카드에서 [승인·발송] 명시적으로 눌러야 진짜 IG API 호출됨.
  const { data: replyLog } = await sb
    .from('reply_logs')
    .insert({
      user_id: user.id,
      ig_account_id: account.id,
      type: 'comment',
      original_text: text,
      reply_text: draft,
      final_reply: null,
      platform_id: commentId,
      urgency: cls.urgency,
      sentiment: cls.sentiment,
      send_status: 'pending',
      is_approved: null,
      approved_at: null,
      context: {
        comment_id: commentId,
        commenter_handle: fromHandle,
        commenter_platform_id: null,
        simulated: false,
        source: 'real-comment-dev',
      },
    })
    .select('id')
    .single()

  await recordOutboundMessage(sb, {
    userId: user.id,
    platform: 'instagram',
    kind: 'comment_reply',
    body: draft,
    recipientHandle: fromHandle,
    status: 'queued',
    sourceRefType: 'reply_logs',
    sourceRefId: replyLog?.id,
  })

  await upsertFollower(sb, {
    userId: user.id,
    platform: 'instagram',
    handle: fromHandle,
    kind: 'comment',
    sentiment: cls.sentiment,
  })

  return NextResponse.json({
    ok: true,
    reply_log_id: replyLog?.id,
    draft,
    classification: cls,
    comment_id: commentId,
    simulated: false,
  })
}
