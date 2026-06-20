// GET /api/me — 현재 유저 요약 (profile + subscription + points + onboarding 상태)
// 호출 시 profiles.last_active_at 자동 갱신 (세션당 1회 수준)
//
// 인증: Bearer(앱 localStorage 토큰) 우선 + 쿠키 fallback (getUserFromRequest).
//   이전엔 쿠키 전용이라 이메일 로그인(Supabase CDN=localStorage) 유저가 401 났음.

import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = adminClient()

  // 병렬 조회 (admin 클라이언트 + 명시적 user_id 스코프)
  const [profileQ, subQ, balanceQ, authQ] = await Promise.all([
    sb.from('profiles').select('*').eq('id', u.id).maybeSingle(),
    sb.from('subscriptions').select('*').eq('user_id', u.id).maybeSingle(),
    sb.rpc('get_points_balance', { p_user_id: u.id }),
    sb.auth.admin.getUserById(u.id),
  ])

  // last_active_at 갱신 (조용히)
  sb.from('profiles')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', u.id)
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
      id: u.id,
      email: authQ.data?.user?.email ?? null,
    },
    profile,
    subscription,
    points,
    is_newbie: isNewbie,
  })
}
