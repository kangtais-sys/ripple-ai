// Next.js 이미지 최적화 헬퍼 — background-image URL 에 사용
//
// 작동 원리:
//   원본:    https://ffozahaztbudvsnnkvep.supabase.co/storage/v1/object/public/link-images/.../hero.jpg
//   최적화:  /_next/image?url=ENCODED&w=800&q=75
//
// 효과:
//   1. Vercel 이 원본 fetch → WebP/AVIF 변환 → edge 에 캐싱
//   2. 같은 URL+w 조합은 두 번째 요청부터 edge 에서 (Supabase 미호출)
//   3. minimumCacheTTL 31일 (next.config.ts) 까지 캐시 유지
//   4. Cache-Control 헤더 정상 (no-cache 문제 우회)
//
// Supabase 외 도메인 (외부 핫링크) 은 통과만 (next/image remotePatterns 미허용)

const SUPABASE_HOST = 'ffozahaztbudvsnnkvep.supabase.co'

export function optImg(url: string | undefined | null, width: number = 800, quality: number = 75): string {
  if (!url) return ''
  // Supabase Storage URL 만 최적화. 그 외는 그대로.
  if (!url.includes(SUPABASE_HOST)) return url
  // 이미 /_next/image 통과한 URL 은 중복 방지
  if (url.startsWith('/_next/image')) return url
  const params = new URLSearchParams({
    url,
    w: String(width),
    q: String(quality),
  })
  return `/_next/image?${params.toString()}`
}
