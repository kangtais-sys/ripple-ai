import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { PLANS, type PlanKey, getUsagePercent } from '@/lib/plans'

// 한도 임박 시 알림 (cron에서 호출)
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const month = new Date().toISOString().slice(0, 7)

  const [{ data: profile }, { data: usage }] = await Promise.all([
    supabase.from('profiles').select('plan').eq('id', user.id).single(),
    supabase.from('usage_logs').select('comment_count, dm_count').eq('user_id', user.id).eq('month', month).single(),
  ])

  const plan = (profile?.plan || 'free') as PlanKey
  const comments = usage?.comment_count || 0
  const dms = usage?.dm_count || 0
  const percent = getUsagePercent(plan, comments, dms)
  const planInfo = PLANS[plan]

  return NextResponse.json({
    plan: planInfo.name,
    used: comments + dms,
    limit: planInfo.limit === Infinity ? '무제한' : planInfo.limit,
    percent,
    warning: percent >= 80,
    overLimit: percent >= 100,
  })
}
