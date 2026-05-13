// Zernio REST API 클라이언트
// docs: https://docs.zernio.com
// auth: ZERNIO_API_KEY (sk_...) — Authorization: Bearer

const BASE_URL = 'https://zernio.com/api/v1'

export type ZernioPlatform =
  | 'instagram'
  | 'threads'
  | 'facebook'
  | 'twitter'
  | 'tiktok'
  | 'youtube'
  | 'linkedin'
  | 'pinterest'
  | 'reddit'
  | 'bluesky'

export interface ZernioMediaItem {
  type: 'image' | 'video'
  url: string
}

export interface ZernioPlatformTarget {
  platform: ZernioPlatform
  accountId: string
  customContent?: string
}

export interface ZernioPostInput {
  content?: string
  mediaItems?: ZernioMediaItem[]
  platforms: ZernioPlatformTarget[]
  publishNow?: boolean
  scheduledFor?: string  // ISO 8601
  timezone?: string
  tags?: string[]
  hashtags?: string[]
  isDraft?: boolean
  title?: string
}

export interface ZernioPostResult {
  _id: string
  status: string
  scheduledFor?: string
  platforms: Array<{
    platform: ZernioPlatform
    accountId: string
    status: string
    postUrl?: string
    error?: string
  }>
}

export interface ZernioAccount {
  _id: string
  platform: ZernioPlatform
  username: string
  displayName?: string
  profileId: string
  isActive: boolean
}

function apiKey(): string {
  const k = process.env.ZERNIO_API_KEY
  if (!k) throw new Error('ZERNIO_API_KEY env missing')
  return k
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Zernio API ${res.status} ${path}: ${text.slice(0, 500)}`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Zernio API ${path}: invalid JSON — ${text.slice(0, 200)}`)
  }
}

/** GET /accounts — 연결된 모든 SNS 계정 (profile 필터 가능) */
export async function listAccounts(profileId?: string): Promise<ZernioAccount[]> {
  const q = profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''
  const r = await request<{ accounts?: ZernioAccount[] } | ZernioAccount[]>(`/accounts${q}`)
  if (Array.isArray(r)) return r
  return r.accounts || []
}

/** POST /posts — 발행 (즉시 또는 예약) */
export async function createPost(input: ZernioPostInput): Promise<ZernioPostResult> {
  return await request<{ post: ZernioPostResult } | ZernioPostResult>('/posts', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((r) => ('post' in r ? r.post : r))
}

export function isZernioConfigured(): boolean {
  return !!process.env.ZERNIO_API_KEY
}
