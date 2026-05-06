// GET /api/cron/refresh-recommendations  (Vercel Cron · 매일 06:00 KST = 21:00 UTC 전일)
// 목적: daily_trends.top5 + recommended_topics 를 유저별 onboarding_topics 로 재랭킹 → user_daily_recs upsert
//   - AI 호출 없음 (키워드 매칭만) → 유저 1000명 처리해도 수 초
//   - 매칭 0건이면 daily_trends.recommended_topics 그대로 보존
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 300

// onboarding_topics 슬러그 → 매칭 키워드
const TOPIC_KEYWORDS: Record<string, string[]> = {
  beauty:   ['뷰티','스킨케어','크림','에센스','토너','선크림','파운데이션','립','쿠션','화장품','시술','피부','모공','각질','여드름','성분'],
  food:     ['음식','맛집','식당','요리','레시피','디저트','빵','베이커리','메뉴'],
  travel:   ['여행','휴가','제주','부산','강릉','경주','해외','일본','유럽','태국','미국'],
  fashion:  ['패션','코디','옷','신발','가방','악세','스타일','룩'],
  interior: ['인테리어','방꾸미기','공간','홈','가구','소품','홈카페'],
  book:     ['책','독서','소설','에세이','자기계발','베스트셀러','북스타그램'],
  baby:     ['아이','아기','육아','임산부','신생아','이유식','출산'],
  fit:      ['운동','헬스','필라테스','요가','러닝','홈트','다이어트','스트레칭'],
  money:    ['절약','돈','재테크','월급','적금','투자','가계부','용돈','알뜰','가성비','저렴'],
  life:     ['꿀팁','팁','방법','루틴','정리','살림','생활','청소'],
  cafe:     ['카페','커피','라떼','아메리카노','음료','홈카페'],
  trend:    ['트렌드','유행','요즘','인기','MZ','Z세대','밈','핫','신상'],
}

type Topic = {
  topic?: string
  category?: string
  why?: string
  preview_hook?: string
}

function scoreTopic(topic: Topic, userTopics: string[]): number {
  if (!topic?.topic) return 0
  const haystack = `${topic.topic} ${topic.category || ''} ${topic.why || ''}`
  let score = 0
  for (const slug of userTopics) {
    const kws = TOPIC_KEYWORDS[slug] || []
    for (const kw of kws) {
      if (haystack.includes(kw)) { score += 1; break }
    }
  }
  return score
}

async function processUser(
  sb: SupabaseClient,
  userId: string,
  userTopics: string[],
  dateKst: string,
  pool: { recs: Topic[]; top5: Topic[]; byCategory: Topic[] }
) {
  // 후보 풀: recommended_topics (3) + top5 (5) + topics_by_category 평탄화 (18 × 10 = 180)
  //   유저별 매칭 점수 매겨 상위 15개 (mirra 급 풍부함)
  const candidates: Topic[] = [
    ...pool.recs,
    ...pool.top5.map(t => ({
      topic: (t as { title?: string }).title || t.topic,
      category: t.category,
      why: undefined,
      preview_hook: undefined,
    })),
    ...pool.byCategory,
  ].filter(t => !!t.topic)

  // dedupe by topic
  const seen = new Set<string>()
  const dedup: Topic[] = []
  for (const t of candidates) {
    const key = (t.topic || '').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    dedup.push(t)
  }

  // 점수 매겨 정렬 → 상위 15개
  const scored = dedup
    .map(t => ({ t, score: scoreTopic(t, userTopics) }))
    .sort((a, b) => b.score - a.score)

  // 매칭된 게 있으면 매칭 우선 + 매칭 0짜리도 fill 해서 15개 맞춤 (다양성 보장)
  const matched = scored.filter(s => s.score > 0).map(s => s.t)
  const unmatched = scored.filter(s => s.score === 0).map(s => s.t)
  const final = [...matched, ...unmatched].slice(0, 15)

  await sb.from('user_daily_recs').upsert({
    user_id: userId,
    date_kst: dateKst,
    generated_at: new Date().toISOString(),
    topics: final,
    meta: {
      onboarding_topics: userTopics,
      matched: matched.length,
      total: final.length,
      mode: matched.length > 0 ? 'matched' : 'fallback',
    },
  }, { onConflict: 'user_id,date_kst' })
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // KST 오늘
  const now = new Date()
  const kstNow = new Date(now.getTime() + (9 * 60 - now.getTimezoneOffset()) * 60 * 1000)
  const dateKst = kstNow.toISOString().slice(0, 10)

  // 1) 오늘의 daily_trends 풀 — topics_by_category 까지 가져와서 후보 폭 확대
  const { data: today } = await sb
    .from('daily_trends')
    .select('date_kst, top5, recommended_topics, topics_by_category')
    .lte('date_kst', dateKst)
    .order('date_kst', { ascending: false })
    .limit(1)
    .maybeSingle()

  // topics_by_category 평탄화 — 각 토픽에 카테고리 자동 첨부
  const byCategory: Topic[] = []
  const tbc = (today?.topics_by_category as Record<string, Array<Record<string, unknown>>>) || {}
  Object.keys(tbc).forEach(cat => {
    const arr = Array.isArray(tbc[cat]) ? tbc[cat] : []
    arr.forEach(t => {
      if (t && typeof t === 'object' && typeof t.topic === 'string') {
        byCategory.push({
          topic: t.topic as string,
          category: cat,
          why: typeof t.why === 'string' ? t.why : undefined,
          preview_hook: typeof t.preview_hook === 'string' ? t.preview_hook : undefined,
        })
      }
    })
  })

  const pool = {
    recs: (today?.recommended_topics as Topic[]) || [],
    top5: (today?.top5 as Topic[]) || [],
    byCategory,
  }

  if (pool.recs.length === 0 && pool.top5.length === 0 && pool.byCategory.length === 0) {
    return NextResponse.json({ ok: false, reason: 'no_daily_trends' })
  }

  // 2) 온보딩 완료 유저 전체 (배치)
  const { data: users, error: usersErr } = await sb
    .from('profiles')
    .select('id, onboarding_topics')
    .not('onboarding_completed_at', 'is', null)

  if (usersErr) {
    return NextResponse.json({ ok: false, reason: 'users_fetch', detail: usersErr.message })
  }

  let processed = 0
  let failed = 0
  for (const u of users || []) {
    const topics = Array.isArray(u.onboarding_topics) ? u.onboarding_topics : []
    try {
      await processUser(sb, u.id, topics, dateKst, pool)
      processed++
    } catch {
      failed++
    }
  }

  return NextResponse.json({
    ok: true,
    date_kst: dateKst,
    processed,
    failed,
    pool_size: { recs: pool.recs.length, top5: pool.top5.length, byCategory: pool.byCategory.length },
  })
}
