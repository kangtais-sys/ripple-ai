// Instagram 콘텐츠 발행 헬퍼 (Graph API with Instagram Login)
// 순서: POST /media (creation_id) → POST /media_publish (media_id)
// 단일 이미지 기준. 캐러셀은 MVP 이후 확장.

import type { SupabaseClient } from '@supabase/supabase-js'

export type PublishResult = {
  ok: boolean
  mediaId?: string
  error?: string
  status?: number
}

type Job = {
  id: string
  user_id: string
  status: string
  prompt_caption: string | null
  meta: Record<string, unknown> | null
}

export async function publishCardnewsJob(
  admin: SupabaseClient,
  job: Job,
  appBaseUrl: string
): Promise<PublishResult> {
  // 1) 유저의 IG 계정
  const { data: igAcc } = await admin
    .from('ig_accounts')
    .select('ig_user_id, access_token')
    .eq('user_id', job.user_id)
    .limit(1)
    .maybeSingle()

  if (!igAcc?.access_token || !igAcc.ig_user_id) {
    await markFailed(admin, job.id, 'no_ig_account')
    return { ok: false, error: 'Instagram 계정 미연동' }
  }

  // 2) 이미지 URL (우리 render 엔드포인트가 공개 제공)
  const imageUrl = `${appBaseUrl}/api/cardnews/${job.id}/image`
  const caption = (job.prompt_caption || '').slice(0, 2200) // IG 캡션 한도

  try {
    // 3) POST /media → creation_id
    const createRes = await fetch(
      `https://graph.instagram.com/v21.0/${igAcc.ig_user_id}/media`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imageUrl,
          caption,
          access_token: igAcc.access_token,
        }),
      }
    )
    const createData = await createRes.json().catch(() => ({}))
    if (!createRes.ok || !createData.id) {
      await markFailed(admin, job.id, `media_create_failed: ${JSON.stringify(createData.error || createData)}`)
      return {
        ok: false,
        status: createRes.status,
        error: `media create 실패: ${JSON.stringify(createData.error || createData)}`,
      }
    }
    const creationId = createData.id as string

    // 4) POST /media_publish → media_id (실제 게시물 ID)
    const pubRes = await fetch(
      `https://graph.instagram.com/v21.0/${igAcc.ig_user_id}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: creationId,
          access_token: igAcc.access_token,
        }),
      }
    )
    const pubData = await pubRes.json().catch(() => ({}))
    if (!pubRes.ok || !pubData.id) {
      await markFailed(admin, job.id, `media_publish_failed: ${JSON.stringify(pubData.error || pubData)}`)
      return {
        ok: false,
        status: pubRes.status,
        error: `publish 실패: ${JSON.stringify(pubData.error || pubData)}`,
      }
    }
    const mediaId = pubData.id as string

    // 5) 성공: card_news_jobs 업데이트
    const newMeta = { ...(job.meta || {}), ig_media_id: mediaId, ig_creation_id: creationId }
    await admin
      .from('card_news_jobs')
      .update({
        status: 'published',
        published_at: new Date().toISOString(),
        meta: newMeta,
      })
      .eq('id', job.id)

    return { ok: true, mediaId }
  } catch (e) {
    await markFailed(admin, job.id, String(e))
    return { ok: false, error: String(e) }
  }
}

async function markFailed(admin: SupabaseClient, jobId: string, reason: string) {
  await admin
    .from('card_news_jobs')
    .update({
      status: 'failed',
      meta: { last_error: reason.slice(0, 500) },
    })
    .eq('id', jobId)
}
