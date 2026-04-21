import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(new URL('/app?ig_error=no_code', request.url))
  }

  try {
    // 1. code → short-lived token
    // Instagram Login 토큰 교환은 반드시 Instagram App ID/Secret 사용 (FB App ID 아님)
    const igAppId = process.env.INSTAGRAM_APP_ID || '1746122143490239'   // 하드코딩 폴백
    const igAppSecret = process.env.INSTAGRAM_APP_SECRET
    if (!igAppSecret) {
      console.error('[IG OAuth] INSTAGRAM_APP_SECRET env missing — Vercel에 추가 필요')
      return NextResponse.redirect(new URL('/app?ig_error=secret_missing', request.url))
    }
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/instagram/callback`
    const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: igAppId,
        client_secret: igAppSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
    })
    const tokenData = await tokenRes.json()
    console.log('[IG OAuth] Token response:', JSON.stringify(tokenData).substring(0, 500))

    if (!tokenData.access_token) {
      console.error('[IG OAuth] Token error:', tokenData)
      const reason = tokenData.error_type || tokenData.error?.message || 'token_failed'
      return NextResponse.redirect(new URL('/app?ig_error=' + encodeURIComponent(reason), request.url))
    }

    // 2. short-lived → long-lived token (60일)
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${igAppSecret}&access_token=${tokenData.access_token}`
    )
    const longData = await longRes.json()
    const accessToken = longData.access_token || tokenData.access_token
    const expiresIn = longData.expires_in || 3600
    console.log('[IG OAuth] Long-lived token obtained, expires in:', expiresIn)

    // 3. 유저 정보 가져오기
    const meRes = await fetch(
      `https://graph.instagram.com/v21.0/me?fields=user_id,username&access_token=${accessToken}`
    )
    const meData = await meRes.json()
    console.log('[IG OAuth] Me data:', JSON.stringify(meData).substring(0, 200))

    if (!meData.username) {
      console.error('[IG OAuth] Me error:', meData)
      return NextResponse.redirect(new URL('/app.html?ig_error=profile_failed', request.url))
    }

    // 4. 유저 식별: 쿠키(ssobi_ig_oauth_uid) 우선, 없으면 세션 쿠키
    let userId: string | null = null
    const oauthUid = request.cookies.get('ssobi_ig_oauth_uid')?.value
    if (oauthUid) {
      userId = oauthUid
    } else {
      // Fallback: Supabase SSR 세션 쿠키 시도
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) userId = user.id
    }

    if (!userId) {
      console.error('[IG OAuth] no user_id (cookie missing AND no session)')
      return NextResponse.redirect(new URL('/app?ig_error=not_logged_in', request.url))
    }

    // Admin 클라이언트로 저장 (RLS 우회 — user_id는 쿠키에서 확인한 값)
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

    // profiles row 없으면 생성 (데모/초기화 이후 FK 위반 방지)
    const { data: existingProfile } = await admin
      .from('profiles').select('id').eq('id', userId).maybeSingle()
    if (!existingProfile) {
      const { error: pErr } = await admin.from('profiles').insert({ id: userId })
      if (pErr) {
        console.error('[IG OAuth] profiles insert error:', pErr)
        return NextResponse.redirect(new URL('/app?ig_error=' + encodeURIComponent('profile_insert:' + pErr.message), request.url))
      }
    }

    const { error: dbError } = await admin.from('ig_accounts').upsert({
      user_id: userId,
      ig_user_id: meData.user_id || String(tokenData.user_id),
      ig_username: meData.username,
      access_token: accessToken,
      token_expires_at: expiresAt,
    }, { onConflict: 'user_id,ig_user_id' })

    if (dbError) {
      console.error('[IG OAuth] DB error:', dbError)
      return NextResponse.redirect(new URL('/app?ig_error=' + encodeURIComponent('db:' + dbError.message), request.url))
    }

    await admin.from('profiles').update({ ig_linked_at: new Date().toISOString() }).eq('id', userId)

    // Webhook 구독 활성화: POST /{ig-user-id}/subscribed_apps
    //   이걸 안 부르면 Meta 가 comments/messages 이벤트를 우리 앱으로 보내지 않음
    const igUserIdForSub = meData.user_id || String(tokenData.user_id)
    try {
      const subRes = await fetch(
        `https://graph.instagram.com/v21.0/${igUserIdForSub}/subscribed_apps?subscribed_fields=comments,messages&access_token=${accessToken}`,
        { method: 'POST' }
      )
      const subJson = await subRes.json().catch(() => ({}))
      console.log(`[IG OAuth] subscribed_apps result (@${meData.username}):`, subJson)
      if (!subJson.success) {
        console.warn('[IG OAuth] webhook 구독 실패 — 유저 재연동 필요할 수 있음')
      }
    } catch (subErr) {
      console.error('[IG OAuth] subscribed_apps exception:', subErr)
    }

    console.log(`[IG OAuth] Connected @${meData.username} for user ${userId}`)

    // 사용한 임시 쿠키 제거
    const res = NextResponse.redirect(new URL(`/app?ig_connected=${meData.username}`, request.url))
    res.cookies.set('ssobi_ig_oauth_uid', '', { maxAge: 0, path: '/' })
    return res
  } catch (error) {
    console.error('[IG OAuth] Error:', error)
    return NextResponse.redirect(new URL('/app.html?ig_error=unknown', request.url))
  }
}
