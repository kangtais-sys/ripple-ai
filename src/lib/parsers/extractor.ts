// src/lib/parsers/extractor.ts
import { quickParse } from './quick'

export type ExtractorSource = 'jina' | 'firecrawl' | 'quick'

export interface ExtractedContent {
  text: string
  source: ExtractorSource
  meta?: {
    title?: string
    description?: string
    image?: string
    price?: number
    [k: string]: any
  }
}

interface ExtractOpts {
  timeoutMs?: number
  maxBytes?: number
}

/**
 * 도메인별 우선순위 정책:
 * - 한국 쇼핑몰 (*.kr, cafe24): Jina Reader 우선 (Firecrawl이 iframe 본문 못 잡음)
 * - 일반: Firecrawl 우선 (markdown 품질 좋음)
 * - Instagram/TikTok 등 봇 차단 사이트: quickParse만 시도 (403 빠르게 fail)
 */
function pickStrategy(url: string): ExtractorSource[] {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return ['quick']
  }

  // 봇 차단 사이트는 시도 자체를 줄임
  if (
    host.includes('instagram.com') ||
    host.includes('tiktok.com') ||
    host.includes('youtube.com') ||
    host.includes('pf.kakao.com')
  ) {
    return ['jina'] // Jina는 일부 케이스 통과. 실패하면 그냥 포기.
  }

  // 한국 쇼핑몰
  if (host.endsWith('.kr') || host.includes('cafe24') || host.includes('imweb')) {
    return ['jina', 'firecrawl', 'quick']
  }

  return ['firecrawl', 'jina', 'quick']
}

export async function extractContent(
  url: string,
  opts: ExtractOpts = {},
): Promise<ExtractedContent> {
  const strategies = pickStrategy(url)
  const errors: string[] = []

  for (const strategy of strategies) {
    try {
      if (strategy === 'jina') {
        const result = await fetchViaJina(url, opts)
        if (result.text && result.text.length >= 50) return result
        errors.push(`jina:too_short(${result.text?.length ?? 0})`)
      } else if (strategy === 'firecrawl') {
        const result = await fetchViaFirecrawl(url, opts)
        if (result.text && result.text.length >= 50) return result
        errors.push(`firecrawl:too_short(${result.text?.length ?? 0})`)
      } else {
        const result = await fetchViaQuickParse(url, opts)
        if (result.text && result.text.length >= 50) return result
        errors.push(`quick:too_short(${result.text?.length ?? 0})`)
      }
    } catch (e: any) {
      errors.push(`${strategy}:${e?.message ?? 'unknown'}`)
    }
  }

  throw new Error(`all_extractors_failed: ${errors.join(' | ')}`)
}

// ─────────────────────────────────────────────────────────────
// Jina Reader — 무료, 빠름, markdown 깔끔
// 호출법: GET https://r.jina.ai/{url}
// 인증 없어도 분당 20회. JINA_API_KEY 있으면 분당 200회.
// ─────────────────────────────────────────────────────────────
async function fetchViaJina(
  url: string,
  opts: ExtractOpts,
): Promise<ExtractedContent> {
  const jinaUrl = `https://r.jina.ai/${url}`
  const headers: Record<string, string> = {
    Accept: 'application/json', // JSON 응답 받으면 메타도 같이 옴
    'X-Return-Format': 'markdown',
  }
  if (process.env.JINA_API_KEY) {
    headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`
  }

  const res = await fetch(jinaUrl, {
    headers,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 12000),
  })

  if (!res.ok) {
    throw new Error(`jina_http_${res.status}`)
  }

  const json = (await res.json()) as {
    code?: number
    data?: { content?: string; title?: string; description?: string }
  }

  if (json.code && json.code !== 200) {
    throw new Error(`jina_code_${json.code}`)
  }

  let text = json.data?.content ?? ''
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024
  if (text.length > maxBytes) text = text.slice(0, maxBytes)

  return {
    text,
    source: 'jina',
    meta: {
      title: json.data?.title,
      description: json.data?.description,
    },
  }
}

// ─────────────────────────────────────────────────────────────
// Firecrawl — 유료, JS 렌더링 가능, 일부 사이트에 강함
// ─────────────────────────────────────────────────────────────
async function fetchViaFirecrawl(
  url: string,
  opts: ExtractOpts,
): Promise<ExtractedContent> {
  if (!process.env.FIRECRAWL_API_KEY) {
    throw new Error('firecrawl_no_key')
  }

  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true,
      timeout: opts.timeoutMs ?? 12000,
    }),
    signal: AbortSignal.timeout((opts.timeoutMs ?? 12000) + 3000),
  })

  if (!res.ok) {
    throw new Error(`firecrawl_http_${res.status}`)
  }

  const json = (await res.json()) as {
    success?: boolean
    data?: {
      markdown?: string
      metadata?: { title?: string; description?: string; ogImage?: string }
    }
    error?: string
  }

  if (!json.success) {
    throw new Error(`firecrawl_error_${json.error ?? 'unknown'}`)
  }

  let text = json.data?.markdown ?? ''
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024
  if (text.length > maxBytes) text = text.slice(0, maxBytes)

  return {
    text,
    source: 'firecrawl',
    meta: {
      title: json.data?.metadata?.title,
      description: json.data?.metadata?.description,
      image: json.data?.metadata?.ogImage,
    },
  }
}

// ─────────────────────────────────────────────────────────────
// quickParse — 기존 코드 재사용. OG meta + JSON-LD + 본문 텍스트만.
// 최후의 보루. JS 렌더링 안 됨.
// ─────────────────────────────────────────────────────────────
async function fetchViaQuickParse(
  url: string,
  opts: ExtractOpts,
): Promise<ExtractedContent> {
  const parsed = await quickParse(url)

  const parts: string[] = []
  if (parsed.title) parts.push(`# ${parsed.title}`)
  if (parsed.description) parts.push(parsed.description)
  if (parsed.text) parts.push(parsed.text)
  if (parsed.price) parts.push(`가격: ${parsed.price}`)

  const text = parts.join('\n\n')

  return {
    text,
    source: 'quick',
    meta: {
      title: parsed.title,
      description: parsed.description,
      image: parsed.imageUrl,
      price: parsed.price,
    },
  }
}
