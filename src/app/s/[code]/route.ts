// /s/[code] — Supabase RPC track_short_click 호출 후 302 리다이렉트
import { NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

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

  if (!target || typeof target !== 'string') {
    return NextResponse.redirect('https://ssobi.ai/?err=not_found', 302)
  }
  return NextResponse.redirect(target, 302)
}

async function hashString(s: string) {
  const buf = new TextEncoder().encode(s)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('')
}
