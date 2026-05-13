// POST /api/admin/personas/[id]/zernio
//   Zernio profile_id 저장 + Zernio API 로 연결된 SNS 계정 fetch → marketing_persona_accounts upsert
//
// 흐름:
//   1. admin 이 Zernio 대시보드에서 Ssobi profile 만들고 IG/Threads/FB/X/TT/YT 연동
//   2. POST { zernio_profile_id } 호출
//   3. 우리가 Zernio /accounts?profileId=... 호출 → 연동된 모든 SNS 계정 sync
//   4. marketing_persona_accounts 에 zernio_account_id + username 박음

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'
import { isAdminEmail } from '@/lib/admin'
import { listAccounts, isZernioConfigured, type ZernioPlatform } from '@/lib/zernio/client'

export const dynamic = 'force-dynamic'

// Zernio platform 키 → 우리 채널 키
const ZERNIO_TO_APP: Partial<Record<ZernioPlatform, string>> = {
  instagram: 'instagram',
  threads: 'threads',
  facebook: 'facebook',
  twitter: 'x',
  tiktok: 'tiktok',
  youtube: 'youtube',
}

async function assertAdmin(req: NextRequest) {
  const u = await getUserFromRequest(req)
  if (!u) return null
  const sb = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data } = await sb.auth.admin.getUserById(u.id)
  if (!data?.user || !isAdminEmail(data.user.email)) return null
  return data.user
}

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// POST — Zernio profile_id 저장 + 계정 sync
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isZernioConfigured()) {
    return NextResponse.json({ error: 'ZERNIO_API_KEY_missing' }, { status: 500 })
  }
  const u = await assertAdmin(req)
  if (!u) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { id: personaId } = await ctx.params
  const body = await req.json().catch(() => ({})) as { zernio_profile_id?: string }
  const zernioProfileId = (body.zernio_profile_id || '').trim()
  if (!zernioProfileId) return NextResponse.json({ error: 'zernio_profile_id_required' }, { status: 400 })

  const sb = admin()

  // 1) 페르소나에 zernio_profile_id 박음
  const { error: updErr } = await sb
    .from('marketing_personas')
    .update({ zernio_profile_id: zernioProfileId })
    .eq('id', personaId)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // 2) Zernio 에서 연결된 계정 fetch
  let accounts: Awaited<ReturnType<typeof listAccounts>>
  try {
    accounts = await listAccounts(zernioProfileId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `zernio_fetch_failed: ${msg}` }, { status: 500 })
  }

  // 3) 우리 marketing_persona_accounts 와 sync
  const synced: Array<{ platform: string; username: string; zernio_account_id: string }> = []
  for (const a of accounts) {
    const ourPlatform = ZERNIO_TO_APP[a.platform]
    if (!ourPlatform) continue

    // 같은 (persona_id, platform) 행이 있으면 update, 없으면 insert
    const { data: existing } = await sb
      .from('marketing_persona_accounts')
      .select('id')
      .eq('persona_id', personaId)
      .eq('platform', ourPlatform)
      .maybeSingle()

    if (existing) {
      await sb
        .from('marketing_persona_accounts')
        .update({
          zernio_account_id: a._id,
          username: a.username,
          display_name: a.displayName || null,
          active: a.isActive,
        })
        .eq('id', existing.id)
    } else {
      await sb.from('marketing_persona_accounts').insert({
        persona_id: personaId,
        platform: ourPlatform,
        language: 'ko',  // 디폴트, 추후 admin 에서 수정 가능
        username: a.username,
        display_name: a.displayName || null,
        zernio_account_id: a._id,
        active: a.isActive,
      })
    }
    synced.push({ platform: ourPlatform, username: a.username, zernio_account_id: a._id })
  }

  return NextResponse.json({ ok: true, synced })
}
