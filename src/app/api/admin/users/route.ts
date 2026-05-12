import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth-helper'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { isAdminEmail } from '@/lib/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// admin 전용 — 가입자 전체 리스트 + 사용량·플랜·베타 상태 통합
//   profiles + auth.users (이메일·last_sign_in_at) + ig_accounts (연동 여부)
//   + usage_logs (이번 달 응대 건수)

export async function GET(req: NextRequest) {
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // admin 권한 체크
  const { data: callerData } = await admin.auth.admin.getUserById(u.id)
  if (!callerData?.user || !isAdminEmail(callerData.user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // 1) auth.users 전체 (admin API)
  const { data: authData } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const authUsers = authData?.users || []
  const authMap = new Map(authUsers.map((u) => [u.id, u]))

  // 2) profiles
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, display_name, email, plan, beta, beta_started_at, beta_ends_at, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  // 3) ig_accounts (연동 여부 + IG username)
  const { data: igRows } = await admin
    .from('ig_accounts')
    .select('user_id, ig_username')
  const igMap = new Map<string, string[]>()
  for (const r of igRows || []) {
    const k = r.user_id as string
    if (!igMap.has(k)) igMap.set(k, [])
    igMap.get(k)!.push(r.ig_username as string)
  }

  // 4) 이번 달 usage_logs (응대 건수)
  const monthStr = new Date().toISOString().slice(0, 7)
  const { data: usageRows } = await admin
    .from('usage_logs')
    .select('user_id, comment_count, dm_count')
    .eq('month', monthStr)
  const usageMap = new Map<string, { comments: number; dms: number }>()
  for (const r of usageRows || []) {
    usageMap.set(r.user_id as string, {
      comments: (r.comment_count as number) || 0,
      dms: (r.dm_count as number) || 0,
    })
  }

  // 5) 통합
  const users = (profiles || []).map((p) => {
    const a = authMap.get(p.id as string)
    const u = usageMap.get(p.id as string) || { comments: 0, dms: 0 }
    return {
      id: p.id,
      email: p.email || a?.email || null,
      display_name: p.display_name,
      plan: p.plan,
      beta: p.beta,
      beta_started_at: p.beta_started_at,
      beta_ends_at: p.beta_ends_at,
      created_at: p.created_at,
      last_sign_in_at: a?.last_sign_in_at || null,
      ig_usernames: igMap.get(p.id as string) || [],
      monthly_comments: u.comments,
      monthly_dms: u.dms,
    }
  })

  return NextResponse.json({ ok: true, users, total: users.length })
}
