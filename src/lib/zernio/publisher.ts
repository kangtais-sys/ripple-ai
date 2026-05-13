// Zernio 기반 마케팅 publisher
//
// marketing_posts 1건 → Zernio /posts API 1회 호출 → 채널별 결과 results 에 누적
//
// 우리 채널 키 ↔ Zernio platform 키 매핑:
//   instagram → instagram
//   threads   → threads
//   facebook  → facebook
//   x         → twitter
//   tiktok    → tiktok
//   youtube   → youtube

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createPost,
  type ZernioPlatform,
  type ZernioPlatformTarget,
  type ZernioMediaItem,
  type ZernioPostResult,
} from './client'

export type AppChannel = 'instagram' | 'threads' | 'facebook' | 'x' | 'tiktok' | 'youtube'

const APP_TO_ZERNIO: Record<AppChannel, ZernioPlatform> = {
  instagram: 'instagram',
  threads: 'threads',
  facebook: 'facebook',
  x: 'twitter',
  tiktok: 'tiktok',
  youtube: 'youtube',
}

export interface PublishOutcome {
  ok: boolean
  results: Record<AppChannel, { ok: boolean; postUrl?: string; error?: string }>
  zernio_post_id?: string
  error?: string
}

/**
 * marketing_posts 1건 발행.
 *
 * @param sb       service role supabase client
 * @param postId   marketing_posts.id
 * @returns 채널별 결과
 */
export async function publishMarketingPost(
  sb: SupabaseClient,
  postId: string,
): Promise<PublishOutcome> {
  // 1) post 정보 fetch
  const { data: post, error: postErr } = await sb
    .from('marketing_posts')
    .select('id, content, image_urls, channels, persona_id, scheduled_at')
    .eq('id', postId)
    .single()
  if (postErr || !post) {
    return { ok: false, results: {} as PublishOutcome['results'], error: 'post_not_found' }
  }

  const channels = (post.channels as AppChannel[]).filter((c) => c in APP_TO_ZERNIO)
  if (channels.length === 0) {
    return { ok: false, results: {} as PublishOutcome['results'], error: 'no_valid_channels' }
  }

  // 2) 페르소나 + 채널별 Zernio account_id lookup
  if (!post.persona_id) {
    return { ok: false, results: {} as PublishOutcome['results'], error: 'persona_required' }
  }
  const { data: accounts } = await sb
    .from('marketing_persona_accounts')
    .select('platform, zernio_account_id, active')
    .eq('persona_id', post.persona_id)
    .eq('active', true)

  const accountMap = new Map<string, string>()
  for (const a of (accounts || []) as Array<{ platform: string; zernio_account_id: string | null; active: boolean }>) {
    if (a.zernio_account_id) accountMap.set(a.platform, a.zernio_account_id)
  }

  const missing = channels.filter((c) => !accountMap.has(c))
  if (missing.length === channels.length) {
    return {
      ok: false,
      results: Object.fromEntries(missing.map((c) => [c, { ok: false, error: 'no_zernio_account' }])) as PublishOutcome['results'],
      error: 'no_zernio_accounts_configured',
    }
  }

  // 3) Zernio platforms 배열 구성
  const platforms: ZernioPlatformTarget[] = []
  const skippedResults: Record<AppChannel, { ok: boolean; error?: string }> = {} as PublishOutcome['results']
  for (const ch of channels) {
    const accId = accountMap.get(ch)
    if (!accId) {
      skippedResults[ch] = { ok: false, error: 'no_zernio_account' }
      continue
    }
    platforms.push({ platform: APP_TO_ZERNIO[ch], accountId: accId })
  }

  if (platforms.length === 0) {
    return { ok: false, results: skippedResults, error: 'all_channels_skipped' }
  }

  // 4) media items
  const mediaItems: ZernioMediaItem[] = (post.image_urls || []).map((url: string) => ({
    type: 'image' as const,
    url,
  }))

  // 5) Zernio API 호출
  let zernioResult: ZernioPostResult
  try {
    zernioResult = await createPost({
      content: post.content || undefined,
      mediaItems: mediaItems.length > 0 ? mediaItems : undefined,
      platforms,
      publishNow: true,
      timezone: 'Asia/Seoul',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      results: Object.fromEntries(channels.map((c) => [c, { ok: false, error: msg }])) as PublishOutcome['results'],
      error: msg,
    }
  }

  // 6) 결과 매핑 (Zernio platform → AppChannel)
  const ZERNIO_TO_APP: Record<ZernioPlatform, AppChannel | undefined> = {
    instagram: 'instagram',
    threads: 'threads',
    facebook: 'facebook',
    twitter: 'x',
    tiktok: 'tiktok',
    youtube: 'youtube',
    linkedin: undefined,
    pinterest: undefined,
    reddit: undefined,
    bluesky: undefined,
  }
  const results: Record<AppChannel, { ok: boolean; postUrl?: string; error?: string }> = { ...skippedResults } as PublishOutcome['results']
  let anyOk = false
  for (const p of zernioResult.platforms || []) {
    const ch = ZERNIO_TO_APP[p.platform]
    if (!ch) continue
    const ok = !p.error && (p.status === 'published' || p.status === 'success' || p.status === 'sent')
    results[ch] = { ok, postUrl: p.postUrl, error: p.error }
    if (ok) anyOk = true
  }

  return {
    ok: anyOk,
    results,
    zernio_post_id: zernioResult._id,
  }
}
