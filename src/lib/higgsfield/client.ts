// Higgsfield REST API client
//
// 인증: Authorization: Key {API_KEY}:{API_SECRET}
// Env: HIGGSFIELD_AUTH = "KEY:SECRET" (single var, 콜론 결합 그대로)
//
// 사용 패턴:
//   import { submit, getStatus, subscribe, downloadAndStore } from '@/lib/higgsfield/client'
//   import { HF_MODELS } from '@/lib/higgsfield/models'
//
//   // 즉시 결과 (이미지, ~30초 이내) — Vercel 함수 maxDuration 60s 이내 가능
//   const result = await subscribe(HF_MODELS.image.soul, { prompt: '...', aspect_ratio: '1:1' })
//
//   // 비동기 (영상 1~5분) — webhook 필수
//   const job = await submit(HF_MODELS.video.kling, { image_url, duration: 5 },
//     'https://ssobi.ai/api/higgsfield/webhook')

const BASE_URL = 'https://platform.higgsfield.ai'

function getAuthHeader(): string {
  const auth = process.env.HIGGSFIELD_AUTH
  if (!auth) throw new Error('HIGGSFIELD_AUTH env 미설정 — cloud.higgsfield.ai 에서 KEY:SECRET 발급 후 등록 필요')
  return `Key ${auth}`
}

export interface SubmitResponse {
  status: 'queued' | 'processing'
  request_id: string
  status_url?: string
  cancel_url?: string
}

export interface StatusResponse {
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
  request_id: string
  /** Image 결과 (text-to-image) */
  images?: Array<{ url: string; width?: number; height?: number }>
  /** Video 결과 (image-to-video) */
  video?: { url: string; duration_seconds?: number }
  /** Audio 결과 (해당 모델) */
  audio?: { url: string }
  /** 에러 정보 */
  error?: string
  message?: string
}

export interface WebhookPayload extends StatusResponse {
  // Higgsfield 가 보내는 webhook body 도 StatusResponse 와 동일 형태로 가정
  // (공식 문서에 정확한 spec 없어서 status 결과 받는 것과 동일하게 처리)
}

/**
 * 요청 제출 — 비동기. request_id 만 받고 즉시 반환.
 * webhook_url 주면 완료 시 Higgsfield 가 POST 콜백.
 */
export async function submit(
  modelId: string,
  args: Record<string, unknown>,
  webhookUrl?: string
): Promise<SubmitResponse> {
  const body: Record<string, unknown> = { ...args }
  if (webhookUrl) body.webhook_url = webhookUrl

  const res = await fetch(`${BASE_URL}/${modelId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: getAuthHeader(),
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Higgsfield submit failed (${res.status}): ${errText.slice(0, 300)}`)
  }
  return (await res.json()) as SubmitResponse
}

/** 단일 상태 조회 */
export async function getStatus(requestId: string): Promise<StatusResponse> {
  const res = await fetch(`${BASE_URL}/requests/${requestId}/status`, {
    headers: { Authorization: getAuthHeader() },
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Higgsfield status failed (${res.status}): ${errText.slice(0, 300)}`)
  }
  return (await res.json()) as StatusResponse
}

/**
 * 제출 + 완료될 때까지 폴링 (sync). 이미지처럼 빠른 모델에 사용.
 * 영상 (1분+) 에는 사용 금지 — Vercel 함수 timeout. submit + webhook 사용.
 *
 * options:
 *   pollIntervalMs: 폴 간격 (기본 2.5s)
 *   maxWaitMs: 최대 대기 (기본 55s — Vercel 60s 한도 안전 마진)
 */
export async function subscribe(
  modelId: string,
  args: Record<string, unknown>,
  options: { pollIntervalMs?: number; maxWaitMs?: number } = {}
): Promise<StatusResponse> {
  const submitRes = await submit(modelId, args)
  const interval = options.pollIntervalMs ?? 2500
  const maxWait = options.maxWaitMs ?? 55000
  const start = Date.now()

  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, interval))
    const status = await getStatus(submitRes.request_id)
    if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
      return status
    }
  }
  throw new Error(`Higgsfield subscribe timeout after ${maxWait}ms (request_id: ${submitRes.request_id})`)
}

/**
 * 결과 이미지·영상을 Higgsfield CDN 에서 가져와서 Supabase Storage 로 옮김.
 *   Higgsfield 결과 URL 은 만료 가능성 있어서 우리 인프라로 옮기는 게 안전.
 *
 * @returns Supabase Storage 의 public URL + path + bytes
 */
export async function downloadToBuffer(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Higgsfield 자산 다운로드 실패 (${res.status}): ${url}`)
  const contentType = res.headers.get('content-type') || 'application/octet-stream'
  const arrayBuf = await res.arrayBuffer()
  return { buffer: Buffer.from(arrayBuf), contentType }
}

/**
 * 환경변수 설정 여부 체크 — 호출 전 검증용
 */
export function isHiggsfieldConfigured(): boolean {
  return !!process.env.HIGGSFIELD_AUTH
}
