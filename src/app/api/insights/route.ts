// GET /api/insights — 유저의 IG Business 계정 인사이트
// 계정 레벨(팔로워, 프로필 방문수, 도달수) + 최근 미디어별 지표
// 권한: instagram_business_manage_insights
import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { NextRequest, NextResponse } from 'next/server'

type MediaInsight = {
  id: string
  caption: string | null
  media_type: string
  timestamp: string
  like_count: number
  comments_count: number
  reach?: number
  impressions?: number
}

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = adminClient()
  const { data: account } = await sb
    .from('ig_accounts')
    .select('ig_user_id, access_token')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (!account?.access_token) {
    return NextResponse.json({ error: 'Instagram 미연동' }, { status: 400 })
  }

  const token = account.access_token
  const igUserId = account.ig_user_id

  try {
    // 1) 계정 프로필 (팔로워, 미디어 수)
    const profRes = await fetch(
      `https://graph.instagram.com/v21.0/${igUserId}?fields=followers_count,follows_count,media_count&access_token=${token}`
    )
    const profile = await profRes.json()

    // 2) 계정 레벨 인사이트 (최근 7일)
    const today = new Date()
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
    const since = Math.floor(weekAgo.getTime() / 1000)
    const until = Math.floor(today.getTime() / 1000)

    const metricsUrl = `https://graph.instagram.com/v21.0/${igUserId}/insights` +
      `?metric=impressions,reach,profile_views,website_clicks` +
      `&period=day&since=${since}&until=${until}&access_token=${token}`
    const metricsRes = await fetch(metricsUrl)
    const metrics = await metricsRes.json()

    // 3) 최근 미디어 5개 + 각 지표
    const mediaRes = await fetch(
      `https://graph.instagram.com/v21.0/${igUserId}/media?fields=id,caption,media_type,timestamp,like_count,comments_count&limit=5&access_token=${token}`
    )
    const mediaList = await mediaRes.json()

    const media: MediaInsight[] = []
    for (const m of (mediaList.data || [])) {
      const item: MediaInsight = {
        id: m.id,
        caption: m.caption || null,
        media_type: m.media_type,
        timestamp: m.timestamp,
        like_count: m.like_count || 0,
        comments_count: m.comments_count || 0,
      }
      // 미디어별 insights (reach, impressions)
      try {
        const mInsRes = await fetch(
          `https://graph.instagram.com/v21.0/${m.id}/insights?metric=reach,impressions&access_token=${token}`
        )
        const mIns = await mInsRes.json()
        for (const row of (mIns.data || [])) {
          const v = row.values?.[0]?.value
          if (row.name === 'reach') item.reach = v
          if (row.name === 'impressions') item.impressions = v
        }
      } catch { /* skip */ }
      media.push(item)
    }

    // 7일 합산
    const sumMetric = (name: string) => {
      const row = (metrics.data || []).find((d: { name: string }) => d.name === name)
      if (!row) return 0
      return (row.values || []).reduce((sum: number, v: { value: number }) => sum + (v.value || 0), 0)
    }

    return NextResponse.json({
      profile: {
        followers_count: profile.followers_count || 0,
        follows_count: profile.follows_count || 0,
        media_count: profile.media_count || 0,
      },
      last_7_days: {
        impressions: sumMetric('impressions'),
        reach: sumMetric('reach'),
        profile_views: sumMetric('profile_views'),
        website_clicks: sumMetric('website_clicks'),
      },
      media,
    })
  } catch (e) {
    return NextResponse.json({ error: 'insights fetch failed', detail: String(e) }, { status: 502 })
  }
}
