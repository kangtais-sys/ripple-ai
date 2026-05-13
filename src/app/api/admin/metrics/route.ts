import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth-helper'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { isAdminEmail } from '@/lib/admin'
import { getEssentialMetrics } from '@/lib/admin-metrics'

export const dynamic = 'force-dynamic'

// admin 메트릭 API — 필수 메트릭만 (빠름)
// 무거운 서비스별 통계는 /api/admin/metrics/services 로 분리
export async function GET(req: NextRequest) {
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

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
    }, { status: 403 })
  }

  const metrics = await getEssentialMetrics()
  return NextResponse.json(
    { ok: true, metrics, email: userData.user.email },
    { headers: { 'Cache-Control': 'private, max-age=30' } }
  )
}
