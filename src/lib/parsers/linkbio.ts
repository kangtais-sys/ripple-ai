// 링크인바이오 마이그레이션 파서
//
// 지원 서비스:
// - Linktree (linktr.ee)
// - 인포크링크 (infolink.kr)
// - LiketLink (litt.link)
// - Beacons (beacons.ai)
// - Lnk.bio (lnk.bio)
//
// 각 서비스는 URL 패턴으로 감지 → 전용 파서 호출
// 실패 시 generic OG fallback

import * as cheerio from 'cheerio'
import type { ParseResult, ParsedLink, ParsedProfile } from './types'
import { extractDomain } from '@/lib/kb/chunker'

const USER_AGENT = 'Mozilla/5.0 (compatible; Ssobi-Migrator/1.0; +https://ssobi.ai)'

export function detectLinkbioService(url: string): string | null {
  const domain = extractDomain(url)
  if (!domain) return null
  if (domain === 'linktr.ee' || domain.endsWith('.linktr.ee')) return 'linktree'
  if (domain === 'infolink.kr' || domain.endsWith('.infolink.kr')) return 'infolink'
  if (domain === 'litt.link' || domain.endsWith('.litt.link')) return 'litt'
  if (domain === 'beacons.ai' || domain.endsWith('.beacons.ai')) return 'beacons'
  if (domain === 'lnk.bio' || domain.endsWith('.lnk.bio')) return 'lnkbio'
  if (domain === 'bento.me' || domain.endsWith('.bento.me')) return 'bento'
  return null
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ko-KR,ko;q=0.9,en' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`http_${res.status}`)
  return await res.text()
}

/**
 * Linktree — Next.js SSR, __NEXT_DATA__ JSON 에 데이터 박힘
 */
async function parseLinktree(url: string): Promise<ParseResult> {
  const html = await fetchHtml(url)
  const $ = cheerio.load(html)
  const nextData = $('#__NEXT_DATA__').html()
  const domain = extractDomain(url) || 'linktr.ee'

  if (nextData) {
    try {
      const data = JSON.parse(nextData)
      const pp = data?.props?.pageProps
      const account = pp?.account
      const links = pp?.links || account?.links || []

      const profile: ParsedProfile = {
        name: account?.profileTitle || account?.username,
        bio: account?.description,
        avatarUrl: account?.profilePictureUrl,
        handle: account?.username,
      }
      const parsedLinks: ParsedLink[] = links.map((l: { title?: string; url?: string; subtitle?: string; thumbnailUrl?: string }) => ({
        label: l.title || '',
        url: l.url || '',
        sub: l.subtitle,
        imageUrl: l.thumbnailUrl,
      })).filter((l: ParsedLink) => l.url)

      return {
        ok: true,
        type: 'linkbio',
        profile,
        links: parsedLinks,
        title: profile.name,
        description: profile.bio,
        imageUrl: profile.avatarUrl,
        domain,
        service: 'linktree',
      }
    } catch (e) {
      // fall through to generic
    }
  }

  // Fallback — DOM 직접 파싱 (anchor 수집)
  return parseGenericLinkbio(url, html, 'linktree')
}

/**
 * 인포크링크 — HTML 파싱 (SSR)
 */
async function parseInfolink(url: string): Promise<ParseResult> {
  const html = await fetchHtml(url)
  return parseGenericLinkbio(url, html, 'infolink')
}

async function parseLitt(url: string): Promise<ParseResult> {
  const html = await fetchHtml(url)
  return parseGenericLinkbio(url, html, 'litt')
}

async function parseLnkbio(url: string): Promise<ParseResult> {
  const html = await fetchHtml(url)
  return parseGenericLinkbio(url, html, 'lnkbio')
}

async function parseBeacons(url: string): Promise<ParseResult> {
  const html = await fetchHtml(url)
  return parseGenericLinkbio(url, html, 'beacons')
}

async function parseBento(url: string): Promise<ParseResult> {
  const html = await fetchHtml(url)
  return parseGenericLinkbio(url, html, 'bento')
}

/**
 * Generic 링크인바이오 파서 — 모든 a[href] 수집 + OG 메타
 */
function parseGenericLinkbio(url: string, html: string, service: string): ParseResult {
  const $ = cheerio.load(html)
  const domain = extractDomain(url) || 'unknown'

  const profile: ParsedProfile = {
    name: $('meta[property="og:title"]').attr('content') || $('title').text() || '',
    bio: $('meta[property="og:description"]').attr('content') || '',
    avatarUrl: $('meta[property="og:image"]').attr('content') || '',
  }

  // 외부 도메인 링크만 수집 (자기 자신 제외)
  const baseDomain = extractDomain(url)
  const links: ParsedLink[] = []
  const seen = new Set<string>()

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || ''
    if (!href.startsWith('http')) return
    const linkDomain = extractDomain(href)
    if (linkDomain === baseDomain) return    // 자기 자신 페이지 제외
    if (seen.has(href)) return
    seen.add(href)

    let label = $(el).text().replace(/\s+/g, ' ').trim()
    if (!label) {
      const img = $(el).find('img').attr('alt')
      label = img || linkDomain || ''
    }
    if (!label) return

    links.push({ label: label.slice(0, 120), url: href })
  })

  // 너무 많으면 cap
  const trimmedLinks = links.slice(0, 30)

  return {
    ok: true,
    type: 'linkbio',
    profile,
    links: trimmedLinks,
    title: profile.name,
    description: profile.bio,
    imageUrl: profile.avatarUrl,
    domain,
    service,
  }
}

/**
 * 통합 진입점 — service 감지 후 적절한 파서 호출
 */
export async function parseLinkbio(url: string): Promise<ParseResult> {
  const service = detectLinkbioService(url)
  if (!service) {
    return { ok: false, type: 'generic', domain: extractDomain(url) || 'unknown', error: 'unsupported_service' }
  }

  try {
    switch (service) {
      case 'linktree': return await parseLinktree(url)
      case 'infolink': return await parseInfolink(url)
      case 'litt': return await parseLitt(url)
      case 'lnkbio': return await parseLnkbio(url)
      case 'beacons': return await parseBeacons(url)
      case 'bento': return await parseBento(url)
      default:
        return { ok: false, type: 'generic', domain: extractDomain(url) || 'unknown', error: 'no_parser' }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, type: 'generic', domain: extractDomain(url) || 'unknown', service, error: msg }
  }
}
