// src/lib/kb/brand-dict.ts
//
// OCR 결과 보정용 brand 사전 — 사용자의 link_pages.blocks 에서 자동 추출.
// LLM 기반 OCR 의 숫자 인식 약점 (예: 500→588/508) 을 fixed phrase 정규화로 보완.
//
// 사용 흐름:
//   const dict = await buildBrandDict(sb, userId)
//   const normalized = applyBrandDict(ocrRawText, dict)

import type { SupabaseClient } from '@supabase/supabase-js'

export interface BrandProduct {
  url: string
  title: string
  price: string
  origPrice?: string
}

export interface BrandDict {
  /** OCR 정규화용 fixed phrases (길이 desc — 긴 phrase 우선 매칭) */
  phrases: string[]
  /** product URL → 정확값 매핑 (cross-check 용) */
  products: BrandProduct[]
}

const EMPTY_DICT: BrandDict = { phrases: [], products: [] }

type AnyRecord = Record<string, unknown>

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

function pushPhrase(set: Set<string>, raw: unknown): void {
  if (typeof raw !== 'string') return
  const cleaned = stripHtml(raw)
  if (cleaned.length >= 2 && cleaned.length <= 200) set.add(cleaned)
}

/**
 * 사용자의 link_pages.blocks 에서 brand 사전 추출.
 * 학습 시점에 호출 (한 번 호출, 결과 캐시 권장).
 */
export async function buildBrandDict(
  sb: SupabaseClient,
  userId: string,
): Promise<BrandDict> {
  const { data: page } = await sb
    .from('link_pages')
    .select('hero, blocks')
    .eq('user_id', userId)
    .maybeSingle()
  if (!page) return EMPTY_DICT

  const phrases = new Set<string>()
  const products: BrandProduct[] = []

  // hero.slides
  const slides = (page.hero as AnyRecord | null)?.slides as AnyRecord[] | undefined
  for (const s of slides ?? []) {
    pushPhrase(phrases, s.brand)
    pushPhrase(phrases, s.title)
    pushPhrase(phrases, s.cta)
    pushPhrase(phrases, s.sub)
  }

  // blocks (재귀: items 까지)
  const blocks = (page.blocks as AnyRecord[] | null) ?? []
  for (const b of blocks) {
    pushPhrase(phrases, b.title)
    pushPhrase(phrases, b.text)
    pushPhrase(phrases, b.sub)
    pushPhrase(phrases, b.eyebrow)
    pushPhrase(phrases, b.label)
    const items = b.items as AnyRecord[] | undefined
    for (const item of items ?? []) {
      pushPhrase(phrases, item.title)
      pushPhrase(phrases, item.label)
      pushPhrase(phrases, item.sub)
      // product 매핑 — URL + price 있는 것만
      const url = typeof item.url === 'string' ? item.url : ''
      const price = typeof item.price === 'string' ? item.price : ''
      const title = typeof item.title === 'string' ? stripHtml(item.title) : ''
      if (url && price) {
        products.push({
          url,
          title,
          price,
          origPrice: typeof item.origPrice === 'string' ? item.origPrice : undefined,
        })
      }
    }
  }

  return {
    phrases: Array.from(phrases).sort((a, b) => b.length - a.length),
    products,
  }
}

/**
 * 정규식 안전한 escape — Regex meta 문자만 변환.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 숫자로 시작하는 fixed phrase (예: "500달톤") 의 숫자 변형을 정확값으로 정규화.
 * 추가로 OCR 흔한 오인식 (O→0, I→1, l→1) 도 같이 처리.
 */
function normalizeNumericVariants(text: string, target: string): string {
  // (1) 같은 자릿수 숫자 변형 정규화
  //   target="500달톤" → /\d{3}달톤/g → "500달톤"
  //   target="500 DALTON" → /\d{3} DALTON/g → "500 DALTON"
  const m = target.match(/^(\d+)(.+)$/)
  if (!m) return text
  const [, num, rest] = m
  const restEsc = escapeRegex(rest)
  let normalized = text

  // 일반 \d{n}rest 매칭 (가장 흔한 케이스 — 588달톤 / 508달톤)
  const reDigits = new RegExp(`\\b\\d{${num.length}}${restEsc}`, 'g')
  normalized = normalized.replace(reDigits, target)

  // OCR 오인식 변형 (O/o → 0, I/l → 1) — 숫자 위치에 영문 들어간 경우
  //   "5OO달톤" / "5oo달톤" 같은 케이스
  const reMixed = new RegExp(`\\b[\\d0OoIl1]{${num.length}}${restEsc}`, 'g')
  normalized = normalized.replace(reMixed, (match) => {
    // 매치된 첫 num.length 만 검증 — 진짜 OCR 오인식인지
    const digitPart = match.slice(0, num.length)
    const looksLikeDigits = /[OoIl]/.test(digitPart) && /^[\d0OoIl1]+$/.test(digitPart)
    return looksLikeDigits ? target : match
  })

  return normalized
}

/**
 * OCR raw text 에 brand 사전 적용.
 * - 길이 desc 순으로 phrase 정규화 (긴 phrase 우선 — substring 충돌 방지)
 * - 숫자로 시작하는 phrase 는 변형 정규화 (588→500, 5OO→500)
 */
export function applyBrandDict(ocrText: string, dict: BrandDict): string {
  if (!ocrText || dict.phrases.length === 0) return ocrText
  let normalized = ocrText
  for (const phrase of dict.phrases) {
    if (/^\d/.test(phrase)) {
      normalized = normalizeNumericVariants(normalized, phrase)
    }
    // 정확 매칭은 별도 처리 안 함 — 이미 같으면 그대로 통과
  }
  return normalized
}
