import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { isAdminEmail } from '@/lib/admin'
import { CHANNEL_SPECS, type ChannelKey, validatePayload } from '@/lib/marketing-publishers'

async function assertAdmin() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user || !isAdminEmail(user.email)) return null
  return user
}

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// GET — 최근 마케팅 글 목록
export async function GET() {
  const u = await assertAdmin()
  if (!u) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data } = await admin()
    .from('marketing_posts')
    .select('id, content, image_urls, channels, scheduled_at, status, results, published_at, error, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  return NextResponse.json({ posts: data || [] })
}

// POST — 새 마케팅 글 큐 등록
export async function POST(req: NextRequest) {
  const u = await assertAdmin()
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

  const { data, error } = await admin()
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
  return NextResponse.json({ ok: true, id: data.id })
}

// DELETE — pending 또는 실패글 삭제
export async function DELETE(req: NextRequest) {
  const u = await assertAdmin()
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
