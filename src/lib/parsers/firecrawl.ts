// Firecrawl v1 클라이언트
//
// docs: https://docs.firecrawl.dev/api-reference/endpoint/scrape
// 비용: $0.001/page (무료 500크레딧으로 시작)
// 환경변수: FIRECRAWL_API_KEY  (fc-xxxxxxxx)
//
// quickParse 가 못 긁는 페이지 (스마트스토어/네이버블로그 = JS 렌더링,
// Cafe24·올리브영 = 봇 차단) 를 Firecrawl 이 처리.
//
// 응답:
//  - markdown: 본문 텍스트 (텍스트 임베딩용)
//  - images:   본문 이미지 URL 절대경로 (OCR 대상)
//  - title/description: metadata
//  - blocked:  403/429 등 봇 차단 → status='blocked'

const FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v1/scrape'
const SCRAPE_TIMEOUT_MS = 30_000
const MAX_IMAGES = 40

export interface FirecrawlResult {
  ok: boolean
  markdown?: string
  images?: string[]
  title?: string
  description?: string
  error?: string
  blocked?: boolean
}

export function isFirecrawlConfigured(): boolean {
  return !!process.env.FIRECRAWL_API_KEY
}

export async function firecrawlScrape(url: string): Promise<FirecrawlResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) return { ok: false, error: 'FIRECRAWL_API_KEY missing' }

  try {
    const res = await fetch(FIRECRAWL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'html'],
        onlyMainContent: true,
        timeout: SCRAPE_TIMEOUT_MS,
      }),
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS + 5_000),
    })

    if (res.status === 402) {
      return { ok: false, error: 'firecrawl_quota_exceeded' }
    }
    if (res.status === 403 || res.status === 429) {
      return { ok: false, blocked: true, error: `upstream_${res.status}` }
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      return { ok: false, error: `firecrawl_${res.status}: ${txt.slice(0, 200)}` }
    }

    const json = await res.json() as {
      success?: boolean
      data?: {
        markdown?: string
        html?: string
        metadata?: { title?: string; description?: string; statusCode?: number }
      }
      error?: string
    }

    if (!json.success || !json.data) {
      return { ok: false, error: json.error || 'firecrawl_empty' }
    }

    const data = json.data
    const statusCode = data.metadata?.statusCode
    if (statusCode === 403 || statusCode === 429) {
      return { ok: false, blocked: true, error: `target_${statusCode}` }
    }

    const markdown = (data.markdown || '').trim()
    if (!markdown && !data.html) {
      return { ok: false, blocked: true, error: 'empty_content' }
    }

    return {
      ok: true,
      markdown,
      images: extractImageUrls(data.html || '', data.markdown || '', url).slice(0, MAX_IMAGES),
      title: data.metadata?.title,
      description: data.metadata?.description,
    }
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      return { ok: false, blocked: true, error: 'firecrawl_timeout' }
    }
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

// HTML <img src> + markdown ![](url) 모두 수집 → 절대 URL 로 변환 → dedup
// data: URL 과 .svg(아이콘) 제외
function extractImageUrls(html: string, markdown: string, baseUrl: string): string[] {
  const urls = new Set<string>()
  const base = (() => { try { return new URL(baseUrl) } catch { return null } })()

  const push = (raw: string | undefined) => {
    if (!raw) return
    const trimmed = raw.trim().replace(/^["']|["']$/g, '')
    if (!trimmed || trimmed.startsWith('data:')) return
    if (/\.(svg)(\?|$)/i.test(trimmed)) return
    try {
      const abs = base ? new URL(trimmed, base).toString() : trimmed
      if (!/^https?:\/\//i.test(abs)) return
      urls.add(abs)
    } catch {}
  }

  const imgTag = /<img\b[^>]*?\bsrc\s*=\s*("([^"]+)"|'([^']+)'|([^\s>]+))/gi
  for (const m of html.matchAll(imgTag)) {
    push(m[2] || m[3] || m[4])
  }

  const mdImg = /!\[[^\]]*\]\(([^)\s]+)/g
  for (const m of markdown.matchAll(mdImg)) {
    push(m[1])
  }

  return Array.from(urls)
}
