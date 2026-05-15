// 텍스트 → 청크 분할 (RAG 임베딩용)
//
// 기본 정책:
// - 청크 크기: ~500 chars (한·영 모두 잘 작동)
// - 오버랩: 80 chars (문맥 끊기지 않게)
// - 문단·문장 경계 우선 (자연스러운 분할)

const DEFAULT_CHUNK_SIZE = 500
const DEFAULT_OVERLAP = 80

export interface Chunk {
  content: string
  index: number
}

/**
 * 텍스트를 청크 배열로 분할.
 * 문단 → 문장 → 강제 분할 순서로 시도.
 */
export function chunkText(
  text: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  overlap: number = DEFAULT_OVERLAP,
): Chunk[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length === 0) return []
  if (clean.length <= chunkSize) return [{ content: clean, index: 0 }]

  const chunks: Chunk[] = []
  let start = 0
  let idx = 0

  while (start < clean.length) {
    let end = Math.min(start + chunkSize, clean.length)

    // 가능하면 문장 경계 (., !, ?, 。) 에서 자르기
    if (end < clean.length) {
      const segment = clean.slice(start, end)
      const lastSentence = Math.max(
        segment.lastIndexOf('. '),
        segment.lastIndexOf('! '),
        segment.lastIndexOf('? '),
        segment.lastIndexOf('。'),
        segment.lastIndexOf('\n'),
      )
      if (lastSentence > chunkSize * 0.5) {
        end = start + lastSentence + 1
      }
    }

    const content = clean.slice(start, end).trim()
    if (content.length > 0) {
      chunks.push({ content, index: idx++ })
    }
    start = end - overlap
    if (start >= clean.length) break
  }

  return chunks
}

/**
 * 가격 정보 추출 (한·영 통화).
 * 발견 시 { amount, currency } 반환, 못 찾으면 null.
 */
export function extractPrice(text: string): { amount: number; currency: string } | null {
  // 한국어: ₩48,000 / 48,000원 / 4만8천원
  const krMatch = text.match(/₩\s?(\d[\d,]*)|(\d[\d,]*)\s?원/)
  if (krMatch) {
    const raw = (krMatch[1] || krMatch[2]).replace(/,/g, '')
    const amount = parseInt(raw, 10)
    if (!isNaN(amount) && amount > 0) return { amount, currency: 'KRW' }
  }

  // 영어: $48 / $48.00 / USD 48
  const usdMatch = text.match(/\$\s?(\d[\d,]*(?:\.\d+)?)|USD\s?(\d[\d,]*(?:\.\d+)?)/i)
  if (usdMatch) {
    const raw = (usdMatch[1] || usdMatch[2]).replace(/,/g, '')
    const amount = parseFloat(raw)
    if (!isNaN(amount) && amount > 0) return { amount, currency: 'USD' }
  }

  return null
}

/**
 * URL 에서 도메인 추출 (subdomain 포함, www 제거)
 */
export function extractDomain(url: string): string | null {
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

/**
 * 도메인 → 카테고리 추론
 */
export function categorizeByDomain(domain: string | null): string {
  if (!domain) return 'other'
  if (/(smartstore|oliveyoung|cafe24|shopify|coupang|amazon|naver\.com\/shopping|wemakeprice|ticketmonster)/i.test(domain)) return 'product'
  if (/(youtube|tiktok|naver\.tv|twitch|vlive)/i.test(domain)) return 'content'
  if (/(class101|inflearn|kmooc|udemy|coursera|fastcampus)/i.test(domain)) return 'class'
  if (/(linktr\.ee|infolink|litt\.link|beacons|bento|lnk\.bio)/i.test(domain)) return 'linkbio'
  if (/(blog\.|tistory|brunch|medium)/i.test(domain)) return 'blog'
  if (/(instagram|threads|facebook|twitter|x\.com)/i.test(domain)) return 'sns'
  return 'other'
}
