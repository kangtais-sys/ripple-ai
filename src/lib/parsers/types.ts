// 외부 URL 학습 파서 — 공통 타입

export interface ParsedLink {
  label: string
  url: string
  sub?: string          // 부가 설명
  imageUrl?: string
}

export interface ParsedProfile {
  name?: string
  bio?: string
  avatarUrl?: string
  handle?: string
}

export interface ParseResult {
  ok: boolean
  type: 'linkbio' | 'product' | 'content' | 'generic' | 'blocked' | 'image_page'
  profile?: ParsedProfile
  links?: ParsedLink[]    // linkbio 일 때 다수 링크
  title?: string
  description?: string
  imageUrl?: string
  text?: string          // 본문 (generic·product)
  price?: number
  currency?: string
  domain: string
  service?: string       // 'linktree' | 'infolink' | 'smartstore' 등
  error?: string
}
