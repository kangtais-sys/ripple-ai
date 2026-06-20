// src/inngest/workers/learn-ig-persona.ts
// IG 연동 직후 자동 말투·캐릭터 학습 (서버사이드 — 유저가 탭 닫아도 진행)
//   trigger: 'learn/ig.connected' (콜백에서 발사)
//   토큰은 이벤트에 싣지 않고 ig_accounts 에서 읽음.
//   결과를 tone_profiles 에 저장 → generate.ts 가 즉시 응대에 사용.
//   profiles.tone_learned_at 마킹 = UI '학습 완료' 신호.

import { inngest } from '../client'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { fetchIgProfileAndPosts, analyzePersona } from '@/lib/kb/persona-learn'

let _admin: SupabaseClient | null = null
const admin = (): SupabaseClient => {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 0 } } },
    )
  }
  return _admin
}

export const learnIgPersonaWorker = inngest.createFunction(
  {
    id: 'learn-ig-persona',
    name: 'IG 페르소나 자동학습',
    retries: 2,
    concurrency: { limit: 3 },
    triggers: { event: 'learn/ig.connected' },
  },
  async ({ event, step, logger }) => {
    const { userId } = event.data
    const sb = admin()

    // 1) IG 토큰 + 메타 읽기 (이벤트에 토큰 안 실음)
    const igAcc = await step.run('load-ig-account', async () => {
      const { data } = await sb
        .from('ig_accounts')
        .select('access_token, ig_username, account_type, media_count')
        .eq('user_id', userId)
        .maybeSingle()
      if (!data?.access_token) throw new Error('no_ig_account')
      return data
    })

    // 2) bio + 최근 10 게시물
    const fetched = await step.run('fetch-ig', async () => {
      return await fetchIgProfileAndPosts(igAcc.access_token, 10)
    })

    if (!fetched.captions && !fetched.bio) {
      logger.warn('[ig-persona] no content to analyze', { userId, username: igAcc.ig_username })
      return { ok: false, reason: 'no_content' }
    }

    // 3) Claude Sonnet 분석 (말투 + 캐릭터 + 검증예시)
    const analysis = await step.run('analyze', async () => {
      return await analyzePersona({
        bio: fetched.bio,
        captions: fetched.captions,
        igUsername: igAcc.ig_username,
        accountType: igAcc.account_type,
        mediaCount: igAcc.media_count,
      })
    })

    // 4) tone_profiles 저장 (자동 적용 — generate.ts 가 즉시 사용)
    await step.run('save-tone', async () => {
      const { error } = await sb.from('tone_profiles').upsert({
        user_id: userId,
        learned_style: analysis.tone ?? null,
        persona_summary: analysis.persona?.summary || null,
        persona_details: analysis.persona?.details || null,
        validation_examples: analysis.examples || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      if (error) throw new Error(`save_failed: ${error.message}`)
    })

    // 5) 학습 완료 마킹 (UI '완료' 신호 — 학습탭/온보딩에서 폴링)
    await step.run('mark-learned', async () => {
      await sb.from('profiles').update({ tone_learned_at: new Date().toISOString() }).eq('id', userId)
    })

    logger.info('[ig-persona] done', { userId, username: igAcc.ig_username, captions: fetched.captionCount })
    return { ok: true, captionCount: fetched.captionCount }
  },
)
