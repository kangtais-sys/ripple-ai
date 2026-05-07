// GET /api/cron/trend-research  (Vercel Cron · 매일 14:00 UTC = 23:00 KST)
//
// 2026-05-07 신 아키텍처 — 카테고리별 병렬 호출:
//   1) Tavily 카테고리별 검색 (18 cat × 3 query = 54 호출, 병렬, ~30s)
//   2) 18 카테고리 각자 Haiku 호출 (병렬, ~10s) — max_tokens 1800/cat
//   3) 종합 → topics_by_category (각 5개)
//   4) 별도 Haiku 호출 1번 → recommended_topics 3개 (전체에서 가장 hot)
//   5) daily_trends upsert (date_kst 기준)
//
// 이전 방식 vs 신 방식:
//   이전: Sonnet 1번 호출에 90개 토픽 요청 → max_tokens/timeout 빈번
//   신: Haiku 19번 (18 cat + 1 recommended) 병렬 → 각 작아서 안정
//   비용: 동일 (~$0.04/일), 속도 4배, 신뢰성 압도적
//
// 옛 RSS pool (collectAllTrends) 도 같이 수집해서 daily_trends.raw_feed_snapshot 에 저장 (히스토리)

import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { collectAllTrends, rankTopN } from '@/lib/trend-collectors'
import { searchAllCategories } from '@/lib/category-tavily'
import { generateAllCategoryTopics, type CategoryTopic } from '@/lib/category-claude'

export const runtime = 'nodejs'
export const maxDuration = 300

const ALL_CATEGORIES = [
  'beauty','fashion','food','cafe','travel','interior','fitness','money',
  'book','baby','pet','kpop','movie','music','psych','mystery','life','trend',
]

export async function GET(req: NextRequest) {
  const startedAt = Date.now()

  // Cron secret 검증
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // KST 날짜
  const now = new Date()
  const kst = new Date(now.getTime() + (9 * 60 - now.getTimezoneOffset()) * 60 * 1000)
  const dateKst = kst.toISOString().slice(0, 10)

  // 1+2) RSS pool + Tavily 카테고리별 검색 — 병렬 (둘 다 Claude 무관)
  const [rssRes, catSearchMap] = await Promise.all([
    collectAllTrends().catch(() => ({ items: [], stats: {} as Record<string, number> })),
    searchAllCategories(dateKst).catch(() => ({} as Record<string, never>)),
  ])
  const top20 = rankTopN(rssRes.items, 20)

  // 3) 18 카테고리 각자 Haiku 호출 (병렬)
  //    한 카테고리 검색 결과 비어있어도 학습 지식 fallback
  const searchInput: Record<string, ReturnType<typeof Object.values>[0]> = {}
  ALL_CATEGORIES.forEach(c => {
    searchInput[c] = (catSearchMap as Record<string, unknown>)[c] || []
  })
  const topicsByCategory = await generateAllCategoryTopics(searchInput as never)

  // topics_by_category 가 모두 비어있으면 silent fail 차단
  const totalTopics = Object.values(topicsByCategory).reduce((sum, arr) => sum + (arr?.length || 0), 0)
  if (totalTopics === 0) {
    return NextResponse.json({
      ok: false,
      reason: 'all_categories_failed',
      stats: rssRes.stats,
      catSearch: Object.fromEntries(Object.keys(searchInput).map(c => [c, (searchInput[c] as unknown[]).length])),
      duration_s: ((Date.now() - startedAt) / 1000).toFixed(1),
    }, { status: 200 })
  }

  // 4) recommended_topics 3개 — 모든 카테고리에서 hook_score 상위 + 다양성
  //    별도 Claude 호출 안 함 (이미 18번 했음). 각 카테고리에서 hook_score 9+ 만 추려서 다양성 보장
  const recommendedPool: Array<CategoryTopic & { category: string }> = []
  Object.keys(topicsByCategory).forEach(cat => {
    (topicsByCategory[cat] || []).forEach(t => {
      if ((t.hook_score || 0) >= 9) recommendedPool.push({ ...t, category: cat })
    })
  })
  // 카테고리별 1개씩 최대 → 다양성
  const recommendSeen = new Set<string>()
  const recommended = recommendedPool
    .sort((a, b) => (b.hook_score || 0) - (a.hook_score || 0))
    .filter(t => {
      if (recommendSeen.has(t.category)) return false
      recommendSeen.add(t.category)
      return true
    })
    .slice(0, 3)
    .map(t => ({
      topic: t.topic,
      category: t.category,
      why: t.why,
      preview_hook: t.preview_hook,
      body_preview: t.body_preview,
      source: t.source,
    }))

  // 5) DB upsert
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { error } = await sb
    .from('daily_trends')
    .upsert({
      date_kst: dateKst,
      generated_at: new Date().toISOString(),
      top5: [],  // deprecated, kept for backward compat
      recommended_topics: recommended,
      topics_by_category: topicsByCategory,
      raw_feed_snapshot: top20,
      meta: {
        stats: rssRes.stats,
        cat_search_counts: Object.fromEntries(Object.keys(searchInput).map(c => [c, (searchInput[c] as unknown[]).length])),
        total_topics: totalTopics,
        model: 'claude-haiku-4-5-20251001',
        architecture: 'per-category-parallel-v1',
        duration_s: ((Date.now() - startedAt) / 1000).toFixed(1),
      },
    }, { onConflict: 'date_kst' })

  if (error) {
    return NextResponse.json({
      ok: false, reason: 'db_error', detail: error.message,
      total_topics: totalTopics,
      duration_s: ((Date.now() - startedAt) / 1000).toFixed(1),
    })
  }

  return NextResponse.json({
    ok: true,
    date_kst: dateKst,
    recommended_count: recommended.length,
    topics_by_category_counts: Object.fromEntries(
      Object.keys(topicsByCategory).map(c => [c, topicsByCategory[c]?.length || 0])
    ),
    total_topics: totalTopics,
    duration_s: ((Date.now() - startedAt) / 1000).toFixed(1),
  })
}
