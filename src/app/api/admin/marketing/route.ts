import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth-helper'
import { isAdminEmail } from '@/lib/admin'
import { CHANNEL_SPECS, type ChannelKey, validatePayload } from '@/lib/marketing-publishers'
import { createMarketingShortLink, appendAttributionLink } from '@/lib/attribution'

// Bearer 토큰 (app.html localStorage 세션) + 쿠키 (Next.js SSR) 둘 다 지원
async function assertAdmin(req: Request) {
  const u = await getUserFromRequest(req)
  if (!u) return null
  // 이메일 조회 — admin client 로 auth.users 에서
  const sb = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data } = await sb.auth.admin.getUserById(u.id)
  if (!data?.user || !isAdminEmail(data.user.email)) return null
  return data.user
}

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// GET — 최근 마케팅 글 목록 + 콘텐츠별 KPI (클릭/가입 수)
export async function GET(req: NextRequest) {
  const u = await assertAdmin(req)
  if (!u) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = admin()
  const [{ data: posts }, { data: kpis }] = await Promise.all([
    sb.from('marketing_posts')
      .select('id, content, image_urls, channels, scheduled_at, status, results, published_at, error, created_at, persona_id, topic_pillar, short_code')
      .order('created_at', { ascending: false })
      .limit(50),
    sb.rpc('marketing_post_kpis'),
  ])

  const kpiMap = new Map<string, { click_count: number; signup_count: number }>()
  for (const k of (kpis || []) as Array<{ post_id: string; click_count: number; signup_count: number }>) {
    kpiMap.set(k.post_id, { click_count: k.click_count, signup_count: k.signup_count })
  }
  const enriched = (posts || []).map((p) => ({
    ...p,
    click_count: kpiMap.get(p.id)?.click_count || 0,
    signup_count: kpiMap.get(p.id)?.signup_count || 0,
  }))

  return NextResponse.json({ posts: enriched })
}

// POST — 새 마케팅 글 큐 등록
export async function POST(req: NextRequest) {
  const u = await assertAdmin(req)
  if (!u) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const content: string = (body.content || '').trim()
  const imageUrls: string[] = Array.isArray(body.image_urls) ? body.image_urls.filter(Boolean) : []
  const channels: ChannelKey[] = Array.isArray(body.channels) ? body.channels : []
  const scheduledAt: string = body.scheduled_at || new Date().toISOString()

  if (!content) return NextResponse.json({ error: 'content_required' }, { status: 400 })
  if (channels.length === 0) return NextResponse.json({ error: 'channels_required' }, { status: 400 })

  // 채널별 spec 검증
  for (const ch of channels) {
    const v = validatePayload(ch, { content, imageUrls })
    if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 })
  }

  const sb = admin()
  const { data, error } = await sb
    .from('marketing_posts')
    .insert({
      content,
      image_urls: imageUrls,
      channels,
      scheduled_at: scheduledAt,
      created_by: u.id,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // attribution short_link 자동 발급 + 본문에 추적 링크 삽입
  let shortCode: string | null = null
  try {
    shortCode = await createMarketingShortLink(
      sb,
      data.id as string,
      u.id,
      'https://ssobi.ai',
      `Manual · ${channels.join(',')}`,
    )
    const newContent = appendAttributionLink(content, shortCode)
    await sb.from('marketing_posts').update({ content: newContent }).eq('id', data.id)
  } catch (e) {
    console.error('[admin/marketing] short_link failed:', e)
  }

  return NextResponse.json({ ok: true, id: data.id, short_code: shortCode })
}

// DELETE — pending 또는 실패글 삭제
export async function DELETE(req: NextRequest) {
  const u = await assertAdmin(req)
  if (!u) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const { error } = await admin()
    .from('marketing_posts')
    .delete()
    .eq('id', id)
    .in('status', ['pending', 'failed', 'cancelled'])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// 채널 spec 조회용 (UI 가 character limit 등 표시)
export async function OPTIONS() {
  return NextResponse.json({ specs: CHANNEL_SPECS })
}
