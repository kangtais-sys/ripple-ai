// 이미지 OCR — Claude Haiku Vision
// 한국 쇼핑몰 본문 이미지 (전성분·사용법·사이즈표 등) 안 텍스트 추출
//
// 비용: 이미지당 ~₩3 (Haiku 4.5)
// 시간: 이미지당 ~3-8초

const SYSTEM_PROMPT = `한국 쇼핑몰 상품 페이지 이미지의 텍스트를 정확히 OCR 추출하는 전문가.

**필수 규칙**:
1. 못 읽는 글자는 절대 추측하지 말 것 → "[불명]" 표시
2. 한국어 의류·화장품 도메인 흔한 표현을 정확히 인식

**자주 나오는 한국어 표현 (오탈자 금지)**:

세탁 방법:
- "그늘 건조", "햇볕 건조", "자연 건조"
- "단독 세탁", "찬물 세탁", "미온수 세탁"
- "기계 건조 금지", "드라이클리닝", "손세탁"
- "표백제 사용 금지", "다림질 가능"

소재:
- "면100%", "폴리에스터", "나일론", "스판덱스"
- "코튼", "린넨", "레이온", "비스코스"
- "박음선", "원단", "신축성", "관리법"

화장품 성분:
- "전성분", "정제수", "글리세린", "히알루론산"
- "나이아신아마이드", "아데노신", "콜라겐", "펩타이드"

정책 용어:
- "단순 변심", "교환 가능", "환불 정책"
- "주문제작", "프리오더", "공동구매"
- "수령 후 N일 이내"

연락처:
- "카카오톡 채널 @핸들"
- "고객센터 070-xxxx-xxxx"

**제외 대상**:
- 마케팅 헤드라인 ("최고", "BEST", "HOT")
- 장식·로고 텍스트
- 의미 없는 단발 영어`

const VISION_PROMPT = `이 이미지에서 응대에 필요한 정보만 추출해줘.

추출:
- 전성분 / 가격 / 옵션 / 사이즈표
- 소재 / 세탁법 / 사용법 / 주의사항
- 환불·교환·배송 정책 / 고객센터

추출할 의미 있는 텍스트가 없으면 정확히 "NO_TEXT" 만 답해.
한국어 그대로, 오탈자 없이.`

export interface OcrResult {
  url: string
  text: string
  error?: string
}

// magic bytes 로 실제 image type 판별 (content-type 헤더가 부정확한 케이스 대응)
function detectImageType(buf: ArrayBuffer): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | null {
  const b = new Uint8Array(buf, 0, Math.min(16, buf.byteLength))
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  return null
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
  if (buf.byteLength > 3 * 1024 * 1024) throw new Error(`too large: ${buf.byteLength}`)
  if (buf.byteLength < 5 * 1024) return '' // 5KB 미만 placeholder/icon 스킵

  // magic bytes 로 실제 type 판별 (content-type 헤더 무시)
  const mediaType = detectImageType(buf)
  if (!mediaType) throw new Error('unknown image format')

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
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
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
    // 불필요 이미지 제외 (로고·배너·아이콘·이모티콘)
    if (/\/(logo|banner|icon|favicon|btn_|ico_|category\/|skin\/)/i.test(u)) continue
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
