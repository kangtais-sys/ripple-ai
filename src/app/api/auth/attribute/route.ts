// POST /api/auth/attribute
//   클라이언트가 가입 직후 호출 → ssobi_attr 쿠키 → profiles.signup_source_* 기록
//
// 호출 방법 (app.html doSignup 직후):
//   await fetch('/api/auth/attribute', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'
import { ATTR_COOKIE_NAME, captureAttribution } from '@/lib/attribution'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const attrCode = req.cookies.get(ATTR_COOKIE_NAME)?.value
  if (!attrCode) return NextResponse.json({ ok: true, captured: false })

  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  const result = await captureAttribution(admin, u.id, attrCode)
  return NextResponse.json({ ok: true, captured: !!result, ...(result || {}) })
}
