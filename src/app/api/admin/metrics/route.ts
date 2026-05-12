import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth-helper'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { isAdminEmail } from '@/lib/admin'
import { getAdminMetrics } from '@/lib/admin-metrics'

export const dynamic = 'force-dynamic'

// admin 메트릭 API — Bearer 토큰 또는 쿠키 둘 다 지원
//   /admin 페이지가 client component 라 fetch 로 호출
export async function GET(req: NextRequest) {
  // 1) 인증된 user id 확보
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // 2) 이메일 조회 + admin 체크 (admin client 로 auth.users 조회)
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data: userData } = await admin.auth.admin.getUserById(u.id)
  if (!userData?.user || !isAdminEmail(userData.user.email)) {
    return NextResponse.json({
      error: 'forbidden',
      your_email: userData?.user?.email || null,
      allowed: undefined,
    }, { status: 403 })
  }

  // 3) 메트릭 집계
  const metrics = await getAdminMetrics()
  return NextResponse.json({ ok: true, metrics, email: userData.user.email })
}
