// GET /api/admin/metrics/services — 링크·카드뉴스·응대 통계 (느림, 분리 호출)

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth-helper'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { isAdminEmail } from '@/lib/admin'
import { getServiceMetrics } from '@/lib/admin-metrics'

export const dynamic = 'force-dynamic'

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
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const metrics = await getServiceMetrics()
  return NextResponse.json(
    { ok: true, metrics },
    { headers: { 'Cache-Control': 'private, max-age=60' } }
  )
}
