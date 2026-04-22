// Instagram 콘텐츠 발행 헬퍼 (Graph API with Instagram Login)
// 슬라이드 1장 → 단일 이미지. 2장 이상 → 캐러셀(CAROUSEL_ALBUM, 최대 10장).
// 각 슬라이드는 /api/cardnews/:id/image?slide=N 로 렌더됨.

import type { SupabaseClient } from '@supabase/supabase-js'

export type PublishResult = {
  ok: boolean
  mediaId?: string
  error?: string
  status?: number
}

type Slide = { title?: string; text?: string }
type Job = {
  id: string
  user_id: string
  status: string
  prompt_caption: string | null
  prompt_body: Slide[] | null
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
    .select('ig_user_id, access_token, token_expires_at')
    .eq('user_id', job.user_id)
    .order('token_expires_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (!igAcc?.access_token || !igAcc.ig_user_id) {
    await markFailed(admin, job.id, job.meta, 'no_ig_account')
    return { ok: false, error: 'Instagram 계정 미연동' }
  }

  const igUserId = igAcc.ig_user_id as string
  const token = igAcc.access_token as string
  const caption = (job.prompt_caption || '').slice(0, 2200)

  // 슬라이드 개수 결정: 표지(1) + body 배열 길이
  const body = Array.isArray(job.prompt_body) ? job.prompt_body : []
  const totalSlides = Math.min(10, body.length > 0 ? body.length + 1 : 1) // IG 최대 10장

  try {
    let finalCreationId: string

    if (totalSlides === 1) {
      // 단일 이미지 발행
      finalCreationId = await createSingleMedia(igUserId, token, `${appBaseUrl}/api/cardnews/${job.id}/image?slide=0`, caption)
    } else {
      // 캐러셀 발행
      const childIds: string[] = []
      for (let i = 0; i < totalSlides; i++) {
        const childId = await createCarouselChild(igUserId, token, `${appBaseUrl}/api/cardnews/${job.id}/image?slide=${i}`)
        // 각 child 컨테이너 FINISHED 대기
        await pollFinished(childId, token)
        childIds.push(childId)
      }
      // 부모 캐러셀 컨테이너
      finalCreationId = await createCarouselParent(igUserId, token, childIds, caption)
    }

    // 최종 컨테이너 FINISHED 대기
    await pollFinished(finalCreationId, token)

    // POST /media_publish
    const pubRes = await fetch(
      `https://graph.instagram.com/v21.0/${igUserId}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: finalCreationId,
          access_token: token,
        }),
      }
    )
    const pubData = await pubRes.json().catch(() => ({}))
    if (!pubRes.ok || !pubData.id) {
      await markFailed(
        admin, job.id, job.meta,
        `media_publish_failed: ${JSON.stringify(pubData.error || pubData)}`,
        { ig_creation_id: finalCreationId }
      )
      return { ok: false, status: pubRes.status, error: `publish 실패: ${JSON.stringify(pubData.error || pubData)}` }
    }
    const mediaId = pubData.id as string

    const newMeta = { ...(job.meta || {}), ig_media_id: mediaId, ig_creation_id: finalCreationId, slides_published: totalSlides }
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
    const msg = e instanceof PublishError ? e.message : String(e)
    const ctx = e instanceof PublishError ? e.extra : undefined
    await markFailed(admin, job.id, job.meta, msg, ctx)
    return { ok: false, error: msg }
  }
}

class PublishError extends Error {
  extra?: Record<string, unknown>
  constructor(msg: string, extra?: Record<string, unknown>) {
    super(msg)
    this.extra = extra
  }
}

async function createSingleMedia(igUserId: string, token: string, imageUrl: string, caption: string): Promise<string> {
  const res = await fetch(`https://graph.instagram.com/v21.0/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, media_type: 'IMAGE', caption, access_token: token }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.id) {
    throw new PublishError(`media_create_failed: ${JSON.stringify(data.error || data)}`)
  }
  return data.id as string
}

async function createCarouselChild(igUserId: string, token: string, imageUrl: string): Promise<string> {
  const res = await fetch(`https://graph.instagram.com/v21.0/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, is_carousel_item: true, access_token: token }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.id) {
    throw new PublishError(`carousel_child_failed: ${JSON.stringify(data.error || data)}`)
  }
  return data.id as string
}

async function createCarouselParent(igUserId: string, token: string, childIds: string[], caption: string): Promise<string> {
  const res = await fetch(`https://graph.instagram.com/v21.0/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      caption,
      access_token: token,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.id) {
    throw new PublishError(`carousel_parent_failed: ${JSON.stringify(data.error || data)}`)
  }
  return data.id as string
}

async function pollFinished(creationId: string, token: string, attempts = 10, intervalMs = 3000): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs))
    const res = await fetch(
      `https://graph.instagram.com/v21.0/${creationId}?fields=status_code&access_token=${token}`
    )
    const data = await res.json().catch(() => ({}))
    if (data.status_code === 'FINISHED') return
    if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') {
      throw new PublishError(
        `container_status_${data.status_code}: ${JSON.stringify(data)}`,
        { ig_creation_id: creationId }
      )
    }
  }
  throw new PublishError('container_timeout_not_finished', { ig_creation_id: creationId })
}

async function markFailed(
  admin: SupabaseClient,
  jobId: string,
  existingMeta: Record<string, unknown> | null,
  reason: string,
  extraMeta?: Record<string, unknown>
) {
  await admin
    .from('card_news_jobs')
    .update({
      status: 'failed',
      meta: {
        ...(existingMeta || {}),
        ...(extraMeta || {}),
        last_error: reason.slice(0, 500),
      },
    })
    .eq('id', jobId)
}
