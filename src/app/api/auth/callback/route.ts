import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Supabase 이메일 인증 + Google OAuth 콜백
export async function GET(request: NextRequest) {
  const searchParams = await request.nextUrl.searchParams
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(new URL(next, request.url))
    }

    console.error('[Auth Callback] Error:', error.message)
  }

  return NextResponse.redirect(new URL('/login?error=auth_failed', request.url))
}
