// GET /api/me — 현재 유저 요약 (profile + subscription + points + onboarding 상태)
// 호출 시 profiles.last_active_at 자동 갱신 (세션당 1회 수준)

import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // 병렬 조회
  const [profileQ, subQ, balanceQ] = await Promise.all([
    sb.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    sb.from('subscriptions').select('*').eq('user_id', user.id).maybeSingle(),
    sb.rpc('get_points_balance', { p_user_id: user.id }),
  ])

  // last_active_at 갱신 (조용히)
  sb.from('profiles')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', user.id)
    .then(() => {})

  const profile = profileQ.data || null
  const subscription = subQ.data || null
  const points = (balanceQ.data as number) || 0

  // newbie (첫날 모드) 자동 판정
  const isNewbie =
    !!profile &&
    (!profile.ig_linked_at || !profile.tone_learned_at || !profile.ref_set_at)

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
    },
    profile,
    subscription,
    points,
    is_newbie: isNewbie,
  })
}
