// /s/[code] — Supabase RPC track_short_click 호출 + attribution 쿠키 set + 302
import { NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { ATTR_COOKIE_NAME, ATTR_COOKIE_MAX_AGE } from '@/lib/attribution'

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  if (!/^[a-zA-Z0-9]{4,12}$/.test(code)) {
    return NextResponse.redirect('https://ssobi.ai/?err=invalid_code', 302)
  }

  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const referer = req.headers.get('referer') || null
  const ua = req.headers.get('user-agent') || null
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const country = req.headers.get('x-vercel-ip-country') || null
  const ipHash = await hashString(ip + (process.env.WEBHOOK_VERIFY_TOKEN || ''))

  const { data: target } = await admin.rpc('track_short_click', {
    p_code: code,
    p_referer: referer,
    p_user_agent: ua,
    p_country: country,
    p_ip_hash: ipHash,
  })

  const targetUrl = (target && typeof target === 'string') ? target : 'https://ssobi.ai/?err=not_found'
  const res = NextResponse.redirect(targetUrl, 302)

  // 마케팅 post 와 연결된 short_link 면 attribution 쿠키 set
  const { data: link } = await admin
    .from('short_links')
    .select('marketing_post_id')
    .eq('code', code)
    .maybeSingle()
  if (link?.marketing_post_id) {
    res.cookies.set(ATTR_COOKIE_NAME, code, {
      maxAge: ATTR_COOKIE_MAX_AGE,
      path: '/',
      sameSite: 'lax',
      secure: true,
      httpOnly: false,  // client JS 가 디버깅용으로 읽을 수 있게
    })
  }
  return res
}

async function hashString(s: string) {
  const buf = new TextEncoder().encode(s)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('')
}
