// Quick crawler — HTTP GET + cheerio (200ms)
// OG 메타 + JSON-LD Product 스키마 + visible text 추출
// 봇 차단 / 텍스트 부족 시 ParseResult.type='blocked' 반환

import * as cheerio from 'cheerio'
import type { ParseResult } from './types'
import { extractPrice, extractDomain } from '@/lib/kb/chunker'
import { extractContentImages } from '@/lib/kb/image-ocr'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export async function quickParse(url: string): Promise<ParseResult> {
  const domain = extractDomain(url) || 'unknown'

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
      // Vercel function timeout 무리없이
      signal: AbortSignal.timeout(8000),
    })

    if (res.status === 403 || res.status === 429) {
      return { ok: false, type: 'blocked', domain, error: `http_${res.status}` }
    }
    if (!res.ok) {
      return { ok: false, type: 'generic', domain, error: `http_${res.status}` }
    }

    const html = await res.text()
    const $ = cheerio.load(html)
    // 본문 이미지 URL 추출 (OCR 후보) — script/style 제거 전에
    const contentImages = extractContentImages(html, url)

    // OG 메타
    const ogTitle = $('meta[property="og:title"]').attr('content') || $('title').text() || ''
    const ogDescription = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || ''
    const ogImage = $('meta[property="og:image"]').attr('content') || ''

    // JSON-LD Product (Schema.org) 시도
    let jsonLdProduct: { name?: string; description?: string; offers?: { price?: number; priceCurrency?: string } } | null = null
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html() || '{}')
        const arr = Array.isArray(json) ? json : [json]
        for (const item of arr) {
          if (item['@type'] === 'Product' || item['@type']?.includes?.('Product')) {
            jsonLdProduct = item
            return false
          }
        }
      } catch {}
    })

    // 본문 텍스트 (script·style·nav·footer 제외)
    $('script, style, nav, footer, header, noscript').remove()
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim()

    // 가격 추출 (JSON-LD 또는 본문 정규식)
    let price: number | undefined
    let currency: string | undefined
    if (jsonLdProduct) {
      const ldProduct = jsonLdProduct as { offers?: { price?: number; priceCurrency?: string } }
      if (ldProduct.offers?.price) {
        price = typeof ldProduct.offers.price === 'string' ? parseFloat(ldProduct.offers.price) : ldProduct.offers.price
        currency = ldProduct.offers.priceCurrency
      }
    }
    if (!price) {
      const found = extractPrice(bodyText.slice(0, 2000))
      if (found) {
        price = found.amount
        currency = found.currency
      }
    }

    // 봇 차단 감지 — 본문 짧고 OG 도 없으면
    const totalContent = (ogTitle + ogDescription + bodyText).trim().length
    if (totalContent < 100 && !ogImage) {
      return { ok: false, type: 'blocked', domain, error: 'content_too_short' }
    }

    // 이미지 페이지 감지 (텍스트 < 200자 + og:image 있음)
    if (bodyText.length < 200 && ogImage) {
      return {
        ok: true,
        type: 'image_page',
        title: ogTitle,
        description: ogDescription,
        imageUrl: ogImage,
        domain,
        text: bodyText,
      }
    }

    // 일반 결과
    const productLike = !!price || (jsonLdProduct as object | null) !== null
    return {
      ok: true,
      type: productLike ? 'product' : 'generic',
      title: ogTitle,
      description: ogDescription,
      imageUrl: ogImage,
      text: bodyText.slice(0, 5000),     // 청크화 전 max
      contentImages,
      price,
      currency,
      domain,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, type: 'generic', domain, error: msg }
  }
}
