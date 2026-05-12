// Ssobi 본인 SNS 채널 발행 — 채널별 publisher 통합
//
// 환경변수 (Vercel env 에서 주입):
//   Instagram (Ssobi 공식 IG 계정):
//     SSOBI_IG_USER_ID          — IG Business Account ID
//     SSOBI_IG_ACCESS_TOKEN     — Page Access Token (Long-lived)
//   Threads (Ssobi 공식 Threads):
//     SSOBI_THREADS_USER_ID
//     SSOBI_THREADS_ACCESS_TOKEN
//   Facebook Page (Ssobi 공식 페이지):
//     SSOBI_FB_PAGE_ID
//     SSOBI_FB_PAGE_TOKEN
//
// 토큰이 없는 채널은 publishToChannel 호출 시 즉시 missing_token 에러 반환.
// 운영자가 메타 비즈니스 콘솔에서 토큰 발급 후 Vercel env 에 추가하면 활성화.

export type ChannelKey = 'instagram' | 'threads' | 'facebook' | 'x'

export interface PublishResult {
  ok: boolean
  id?: string         // 발행 후 채널측 post ID
  url?: string        // 보기 URL (있다면)
  error?: string
}

export interface PublishPayload {
  content: string
  imageUrls: string[]
}

const META_VERSION = 'v23.0'  // Meta Graph API 버전

// ════ Instagram ════
async function publishInstagram(p: PublishPayload): Promise<PublishResult> {
  const userId = process.env.SSOBI_IG_USER_ID
  const token = process.env.SSOBI_IG_ACCESS_TOKEN
  if (!userId || !token) return { ok: false, error: 'missing_token: SSOBI_IG_*' }
  if (p.imageUrls.length === 0) return { ok: false, error: 'instagram_requires_image' }

  try {
    // 1) 미디어 컨테이너 생성 (단일 이미지) — carousel 은 추후
    const imageUrl = p.imageUrls[0]
    const createUrl = `https://graph.facebook.com/${META_VERSION}/${userId}/media`
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        image_url: imageUrl,
        caption: p.content,
        access_token: token,
      }),
    })
    const createJson = await createRes.json()
    if (!createRes.ok || !createJson.id) {
      return { ok: false, error: `ig_container_failed: ${JSON.stringify(createJson)}` }
    }

    // 2) 발행
    const publishUrl = `https://graph.facebook.com/${META_VERSION}/${userId}/media_publish`
    const publishRes = await fetch(publishUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        creation_id: createJson.id,
        access_token: token,
      }),
    })
    const publishJson = await publishRes.json()
    if (!publishRes.ok || !publishJson.id) {
      return { ok: false, error: `ig_publish_failed: ${JSON.stringify(publishJson)}` }
    }
    return { ok: true, id: publishJson.id }
  } catch (e) {
    return { ok: false, error: `ig_exception: ${String(e)}` }
  }
}

// ════ Threads ════
//   2024.6 Publishing API. 텍스트 단독 가능, 이미지 첨부 시 IG 유사 (container → publish)
async function publishThreads(p: PublishPayload): Promise<PublishResult> {
  const userId = process.env.SSOBI_THREADS_USER_ID
  const token = process.env.SSOBI_THREADS_ACCESS_TOKEN
  if (!userId || !token) return { ok: false, error: 'missing_token: SSOBI_THREADS_*' }

  try {
    // 1) container 생성
    const mediaType = p.imageUrls.length > 0 ? 'IMAGE' : 'TEXT'
    const createBody = new URLSearchParams({
      media_type: mediaType,
      text: p.content,
      access_token: token,
    })
    if (mediaType === 'IMAGE') createBody.set('image_url', p.imageUrls[0])

    const createRes = await fetch(`https://graph.threads.net/${META_VERSION}/${userId}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: createBody,
    })
    const createJson = await createRes.json()
    if (!createRes.ok || !createJson.id) {
      return { ok: false, error: `threads_container_failed: ${JSON.stringify(createJson)}` }
    }

    // 2) publish (Threads 는 container 생성 후 ~30s 대기 권장)
    await new Promise((r) => setTimeout(r, 1500))
    const publishRes = await fetch(
      `https://graph.threads.net/${META_VERSION}/${userId}/threads_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          creation_id: createJson.id,
          access_token: token,
        }),
      }
    )
    const publishJson = await publishRes.json()
    if (!publishRes.ok || !publishJson.id) {
      return { ok: false, error: `threads_publish_failed: ${JSON.stringify(publishJson)}` }
    }
    return { ok: true, id: publishJson.id }
  } catch (e) {
    return { ok: false, error: `threads_exception: ${String(e)}` }
  }
}

// ════ Facebook Page ════
async function publishFacebook(p: PublishPayload): Promise<PublishResult> {
  const pageId = process.env.SSOBI_FB_PAGE_ID
  const token = process.env.SSOBI_FB_PAGE_TOKEN
  if (!pageId || !token) return { ok: false, error: 'missing_token: SSOBI_FB_*' }

  try {
    const body = new URLSearchParams({
      message: p.content,
      access_token: token,
    })
    // 이미지 있으면 /photos, 없으면 /feed
    const endpoint =
      p.imageUrls.length > 0
        ? `https://graph.facebook.com/${META_VERSION}/${pageId}/photos`
        : `https://graph.facebook.com/${META_VERSION}/${pageId}/feed`
    if (p.imageUrls.length > 0) body.set('url', p.imageUrls[0])

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const json = await res.json()
    if (!res.ok || !(json.id || json.post_id)) {
      return { ok: false, error: `fb_failed: ${JSON.stringify(json)}` }
    }
    return { ok: true, id: json.id || json.post_id }
  } catch (e) {
    return { ok: false, error: `fb_exception: ${String(e)}` }
  }
}

// ════ X (Twitter) — 미구현. Basic tier $100/월 가입 후 추가 ════
async function publishX(_p: PublishPayload): Promise<PublishResult> {
  return { ok: false, error: 'x_not_configured: Basic API tier 가입 필요 ($100/월)' }
}

// 공개 진입점
export async function publishToChannel(
  channel: ChannelKey,
  payload: PublishPayload
): Promise<PublishResult> {
  switch (channel) {
    case 'instagram': return publishInstagram(payload)
    case 'threads':   return publishThreads(payload)
    case 'facebook':  return publishFacebook(payload)
    case 'x':         return publishX(payload)
    default: return { ok: false, error: `unknown_channel: ${channel}` }
  }
}

// 채널별 spec — UI 검증·서버 검증 공통
export interface ChannelSpec {
  maxChars: number
  requiresImage: boolean
  supportsImage: boolean
  notes?: string
}

export const CHANNEL_SPECS: Record<ChannelKey, ChannelSpec> = {
  instagram: {
    maxChars: 2200,
    requiresImage: true,
    supportsImage: true,
    notes: '캡션 2,200자, 이미지 필수, 해시태그 30개 권장',
  },
  threads:   { maxChars: 500,    requiresImage: false, supportsImage: true,  notes: '본문 500자, 이미지 선택' },
  facebook:  { maxChars: 63206,  requiresImage: false, supportsImage: true,  notes: '본문 무제한 (63,206자), 이미지 선택' },
  x:         { maxChars: 280,    requiresImage: false, supportsImage: true,  notes: '280자, 이미지 선택, Basic API tier 필요' },
}

export function validatePayload(
  channel: ChannelKey,
  payload: PublishPayload
): { ok: true } | { ok: false; reason: string } {
  const spec = CHANNEL_SPECS[channel]
  if (!spec) return { ok: false, reason: 'unknown_channel' }
  if (payload.content.length > spec.maxChars)
    return { ok: false, reason: `${channel} 글자수 초과: ${payload.content.length}/${spec.maxChars}` }
  if (spec.requiresImage && payload.imageUrls.length === 0)
    return { ok: false, reason: `${channel} 는 이미지 1장 이상 필요` }
  return { ok: true }
}
