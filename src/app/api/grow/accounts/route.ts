// GET /api/grow/accounts
//   키우기 탭 "연동 계정" 카드용 — 모든 채널 (IG/TT/YT) 연동 상태 + 메타데이터 통합 반환
//
// 응답 구조:
// {
//   accounts: [
//     { platform: 'instagram', connected: true, username: '...', account_type: 'BUSINESS',
//       media_count: 124, followers_count: 320000, profile_picture_url: '...',
//       auto_reply_enabled: true },
//     { platform: 'tiktok', connected: false },
//     { platform: 'youtube', connected: false },
//   ]
// }

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth-helper'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

interface GrowAccount {
  platform: 'instagram' | 'tiktok' | 'youtube'
  connected: boolean
  username?: string | null
  account_type?: string | null
  media_count?: number | null
  followers_count?: number | null
  profile_picture_url?: string | null
  auto_reply_enabled?: boolean
}

export async function GET(req: NextRequest) {
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // 1) Instagram — ig_accounts 에서 최신 1행
  const { data: ig } = await sb
    .from('ig_accounts')
    .select('ig_username, account_type, media_count, followers_count, profile_picture_url')
    .eq('user_id', u.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // 2) auto-reply 설정 — profiles 에서
  const { data: prof } = await sb
    .from('profiles')
    .select('auto_reply_enabled')
    .eq('id', u.id)
    .maybeSingle()
  const autoReply = prof?.auto_reply_enabled !== false  // default ON

  const accounts: GrowAccount[] = [
    {
      platform: 'instagram',
      connected: !!ig,
      username: ig?.ig_username || null,
      account_type: ig?.account_type || null,
      media_count: ig?.media_count ?? null,
      followers_count: ig?.followers_count ?? null,
      profile_picture_url: ig?.profile_picture_url || null,
      auto_reply_enabled: autoReply,
    },
    { platform: 'tiktok', connected: false },
    { platform: 'youtube', connected: false },
  ]

  return NextResponse.json({ accounts })
}
