import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { ATTR_COOKIE_NAME, captureAttribution } from '@/lib/attribution'

// Supabase 이메일 인증 + Google OAuth 콜백
//   성공 시 attribution 쿠키 → profiles.signup_source_* 기록
export async function GET(request: NextRequest) {
  const searchParams = await request.nextUrl.searchParams
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      // attribution 쿠키 캡처 (idempotent — 이미 있으면 skip)
      const attrCode = request.cookies.get(ATTR_COOKIE_NAME)?.value
      if (attrCode) {
        try {
          const admin = createAdmin(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { persistSession: false } }
          )
          await captureAttribution(admin, data.user.id, attrCode)
        } catch (e) {
          console.error('[Auth Callback] Attribution capture failed:', e)
        }
      }
      return NextResponse.redirect(new URL(next, request.url))
    }

    if (error) console.error('[Auth Callback] Error:', error.message)
  }

  return NextResponse.redirect(new URL('/login?error=auth_failed', request.url))
}
