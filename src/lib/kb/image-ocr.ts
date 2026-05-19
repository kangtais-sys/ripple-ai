// 이미지 OCR — Claude Haiku Vision
// 한국 쇼핑몰 본문 이미지 (전성분·사용법·사이즈표 등) 안 텍스트 추출
//
// 비용: 이미지당 ~₩3 (Haiku 4.5)
// 시간: 이미지당 ~3-8초

const VISION_PROMPT = `이 이미지에서 응대에 도움 되는 텍스트만 추출해줘.

추출 대상:
- 전성분 (정제수, 글리세린, ...)
- 가격·할인·옵션·구성
- 사이즈표·소재·세탁법
- 사용법·주의사항
- 환불·교환·배송 정책
- 고객센터 연락처
- 인증 정보 (식약처, KC 등)

제외할 것:
- 의미 없는 마케팅 헤드라인 ("최고", "BEST" 같은 단발)
- 장식 텍스트·로고

추출할 의미 있는 텍스트가 없으면 정확히 "NO_TEXT" 라고 답해. 한국어 그대로 추출.`

export interface OcrResult {
  url: string
  text: string
  error?: string
}

// 단일 이미지 OCR
export async function ocrImage(imageUrl: string): Promise<string> {
  // 1) 이미지 download
  const imgRes = await fetch(imageUrl, {
    signal: AbortSignal.timeout(10000),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ssobi-ocr/1.0)' },
  })
  if (!imgRes.ok) throw new Error(`fetch ${imgRes.status}`)
  const buf = await imgRes.arrayBuffer()
  const mediaType = (imgRes.headers.get('content-type') || 'image/png').split(';')[0].trim()
  if (!mediaType.startsWith('image/')) throw new Error(`not image: ${mediaType}`)
  if (buf.byteLength > 5 * 1024 * 1024) throw new Error(`too large: ${buf.byteLength}`)
  if (buf.byteLength < 1024) return '' // tiny placeholder

  const base64 = Buffer.from(buf).toString('base64')

  // 2) Claude Haiku Vision
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: VISION_PROMPT },
        ],
      }],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`vision ${res.status}: ${errText.slice(0, 200)}`)
  }
  const data = await res.json()
  const text = (data.content?.[0]?.text || '').trim()
  if (!text || text === 'NO_TEXT' || text.includes('NO_TEXT')) return ''
  if (text.length < 10) return ''
  return text
}

// 여러 이미지 병렬 OCR — batch
export async function ocrImages(urls: string[], opts?: { concurrency?: number; max?: number }): Promise<OcrResult[]> {
  const concurrency = opts?.concurrency ?? 4
  const max = opts?.max ?? 50
  const targets = Array.from(new Set(urls)).slice(0, max)
  const results: OcrResult[] = []
  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency)
    const batchResults = await Promise.allSettled(batch.map(async url => {
      try {
        const text = await ocrImage(url)
        return { url, text }
      } catch (e) {
        return { url, text: '', error: e instanceof Error ? e.message : String(e) }
      }
    }))
    for (const r of batchResults) {
      if (r.status === 'fulfilled') results.push(r.value)
    }
  }
  return results
}

// 페이지의 본문 영역 이미지 URL 추출 (cafe24 NNEditor, prdDetail, 일반 본문)
// abs URL 로 정규화
export function extractContentImages(html: string, baseUrl: string): string[] {
  const urls = new Set<string>()
  // <img src="..."> 또는 ec-data-src/data-src (lazy)
  const re = /(?:src|ec-data-src|data-src)\s*=\s*["']([^"']+\.(?:png|jpg|jpeg|gif|webp))["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    let u = m[1].trim()
    // 본문 이미지 패턴 — NNEditor / upload / editor / detail / web/product (extra 상세)
    const isContentImg = /\/(NNEditor|editor|upload\/|web\/product\/(?:big|extra)|product\/.*detail|prdDetail)/i.test(u)
    if (!isContentImg) continue
    if (u.startsWith('//')) u = 'https:' + u
    else if (u.startsWith('/')) {
      try {
        const base = new URL(baseUrl)
        u = base.origin + u
      } catch { continue }
    } else if (!/^https?:\/\//i.test(u)) continue
    urls.add(u)
  }
  return Array.from(urls)
}
