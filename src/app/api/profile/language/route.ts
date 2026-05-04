// POST /api/profile/language — 앱 표시 언어 설정 (i18n)
//   body: { language: 'ko' | 'en' | 'ja' }
//   GET — 현재 언어 + 자동 감지 추천 (Accept-Language 헤더 기반)
import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth-helper'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const SUPPORTED = ['ko', 'en', 'ja'] as const
type Lang = typeof SUPPORTED[number]

function detectFromHeader(accept: string | null): Lang {
  if (!accept) return 'ko'
  const lower = accept.toLowerCase()
  if (lower.startsWith('ko') || lower.includes(',ko')) return 'ko'
  if (lower.startsWith('ja') || lower.includes(',ja')) return 'ja'
  if (lower.startsWith('en') || lower.includes(',en')) return 'en'
  return 'ko'
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req).catch(() => null)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { language?: string }
  if (!body.language || !SUPPORTED.includes(body.language as Lang)) {
    return NextResponse.json({ ok: false, error: 'invalid_language' }, { status: 400 })
  }

  const sb = await createClient()
  const { error } = await sb.from('profiles').update({ app_language: body.language }).eq('id', user.id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, language: body.language })
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req).catch(() => null)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const sb = await createClient()
  const { data } = await sb.from('profiles').select('app_language').eq('id', user.id).maybeSingle()
  const detected = detectFromHeader(req.headers.get('accept-language'))

  return NextResponse.json({
    ok: true,
    language: data?.app_language || detected,
    detected,
  })
}
