import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(new URL('/dashboard/connect?error=no_code', request.url))
  }

  try {
    // 1. code → short-lived token
    const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.META_APP_ID!,
        client_secret: process.env.META_APP_SECRET!,
        grant_type: 'authorization_code',
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/instagram`,
        code,
      }),
    })
    const tokenData = await tokenRes.json()

    if (!tokenData.access_token) {
      console.error('[IG OAuth] Token error:', tokenData)
      return NextResponse.redirect(new URL('/dashboard/connect?error=token_failed', request.url))
    }

    // 2. short-lived → long-lived token (60일)
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${process.env.META_APP_SECRET}&access_token=${tokenData.access_token}`
    )
    const longData = await longRes.json()
    const accessToken = longData.access_token || tokenData.access_token
    const expiresIn = longData.expires_in || 3600

    // 3. 유저 정보 가져오기
    const meRes = await fetch(
      `https://graph.instagram.com/v21.0/me?fields=user_id,username&access_token=${accessToken}`
    )
    const meData = await meRes.json()

    if (!meData.username) {
      console.error('[IG OAuth] Me error:', meData)
      return NextResponse.redirect(new URL('/dashboard/connect?error=profile_failed', request.url))
    }

    // 4. Supabase에 저장
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

    await supabase.from('ig_accounts').upsert({
      user_id: user.id,
      ig_user_id: meData.user_id || String(tokenData.user_id),
      ig_username: meData.username,
      access_token: accessToken,
      token_expires_at: expiresAt,
    }, { onConflict: 'user_id,ig_user_id' })

    return NextResponse.redirect(new URL('/dashboard/connect?success=true', request.url))
  } catch (error) {
    console.error('[IG OAuth] Error:', error)
    return NextResponse.redirect(new URL('/dashboard/connect?error=unknown', request.url))
  }
}
