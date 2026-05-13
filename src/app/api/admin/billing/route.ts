// GET /api/admin/billing — 이번 달 사용량 집계 (비용 계산용)

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'
import { isAdminEmail } from '@/lib/admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data: ud } = await sb.auth.admin.getUserById(u.id)
  if (!ud?.user || !isAdminEmail(ud.user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [cardnewsRes, repliesRes, assetsRes] = await Promise.all([
    sb.from('card_news_jobs').select('id', { count: 'exact', head: true }).gte('created_at', startOfMonth),
    sb.from('reply_logs').select('id', { count: 'exact', head: true }).gte('created_at', startOfMonth),
    sb.from('marketing_assets').select('id', { count: 'exact', head: true })
      .eq('generation_status', 'completed').gte('created_at', startOfMonth),
  ])

  return NextResponse.json(
    {
      email: ud.user.email,
      usage: {
        cardnews_jobs_this_month: cardnewsRes.count || 0,
        reply_logs_this_month: repliesRes.count || 0,
        higgsfield_assets_this_month: assetsRes.count || 0,
        higgsfield_credits_balance: null,
      },
    },
    { headers: { 'Cache-Control': 'private, max-age=60' } }
  )
}
