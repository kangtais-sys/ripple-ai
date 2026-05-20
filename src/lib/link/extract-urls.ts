// src/lib/link/extract-urls.ts
// 블록에서 URL + label 뽑기
// 블록 타입: link / event / bigbanner / grid / quicklinks / socials / section / spacer ...

export type ExtractedUrl = { url: string; label?: string; blockId?: string }

export function extractUrlsFromBlocks(blocks: any[]): ExtractedUrl[] {
  const out: ExtractedUrl[] = []
  const seen = new Set<string>()

  const push = (url: any, label?: any, blockId?: any) => {
    if (typeof url !== 'string') return
    if (!/^https?:\/\//i.test(url)) return
    if (seen.has(url)) return
    seen.add(url)
    out.push({
      url,
      label: typeof label === 'string' ? label : undefined,
      blockId: typeof blockId === 'string' ? blockId : undefined,
    })
  }

  for (const block of blocks ?? []) {
    if (!block || typeof block !== 'object') continue
    const id = block.id

    switch (block.type) {
      case 'link':
      case 'bigbanner':
      case 'event':
        push(block.url, block.title ?? block.label, id)
        break
      case 'grid':
      case 'quicklinks':
        for (const item of block.items ?? []) {
          push(item.url, item.title ?? item.label, id)
        }
        break
      case 'socials':
        // socials는 보통 SNS 프로필 — 학습 가치 낮음. skip.
        break
      default:
        // 알 수 없는 타입 — url 필드 있으면 일단 시도
        if (block.url) push(block.url, block.title, id)
    }
  }

  return out
}
