// POST /api/auto-reply/toggle — 자동 응대 토글 (글로벌 + 채널별)
//   body: { enabled?: boolean, channels?: { ig_comment?: boolean, ig_dm?: boolean, ... } }
//   둘 중 하나만 보내면 그 부분만 업데이트
import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth-helper'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req).catch(() => null)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    enabled?: boolean
    channels?: Record<string, boolean>
  }

  const sb = await createClient()
  const update: Record<string, unknown> = {}
  if (typeof body.enabled === 'boolean') update.auto_reply_enabled = body.enabled
  if (body.channels && typeof body.channels === 'object') {
    // 기존 채널 맵 + 새 값 머지
    const { data: cur } = await sb
      .from('profiles')
      .select('auto_reply_channels')
      .eq('id', user.id)
      .maybeSingle()
    const merged = { ...(cur?.auto_reply_channels || {}), ...body.channels }
    update.auto_reply_channels = merged
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: 'no_fields' }, { status: 400 })
  }

  const { error } = await sb.from('profiles').update(update).eq('id', user.id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  // 업데이트 후 현재 상태 반환
  const { data: profile } = await sb
    .from('profiles')
    .select('auto_reply_enabled, auto_reply_channels')
    .eq('id', user.id)
    .maybeSingle()

  return NextResponse.json({
    ok: true,
    enabled: profile?.auto_reply_enabled ?? true,
    channels: profile?.auto_reply_channels ?? {},
  })
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req).catch(() => null)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const sb = await createClient()
  const { data: profile } = await sb
    .from('profiles')
    .select('auto_reply_enabled, auto_reply_channels, app_language')
    .eq('id', user.id)
    .maybeSingle()

  return NextResponse.json({
    ok: true,
    enabled: profile?.auto_reply_enabled ?? true,
    channels: profile?.auto_reply_channels ?? { ig_comment: true, ig_dm: true },
    language: profile?.app_language ?? 'ko',
  })
}
