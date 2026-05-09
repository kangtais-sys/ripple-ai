// 공개 링크 페이지 /u/[handle] — Supabase에서 link_pages 조회 후 SSR 렌더
//
// 2026-05-09: ISR 캐싱 (revalidate=60) — Edge 에서 60초간 HTML 캐시.
//   사용자가 편집·저장하면 /api/link POST 가 revalidatePath('/u/{handle}') 호출 →
//   캐시 즉시 무효화 → 다음 방문은 새 데이터.
//   조회수 증가는 별도 /api/link/track 엔드포인트가 클라이언트에서 호출 (page 캐싱과 무관).
import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import type { Metadata } from 'next'
import Script from 'next/script'
import LinkPageClient from './client'

export const revalidate = 60
export const dynamicParams = true

// anon 키 사용 — RLS의 "Public reads published link_pages" 정책으로 접근
function publicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// 조회수 트래킹은 ISR 캐싱과 충돌 (캐시 hit 시 SSR 안 돌아서 카운트 누락) →
// /api/link/track 으로 분리. client.tsx 에서 마운트 시 호출.

type PageData = {
  id: string
  handle: string
  hero: Record<string, unknown>
  theme: Record<string, unknown>
  settings: Record<string, unknown>
  blocks: unknown[]
  view_count: number
  published: boolean
}

// unstable_cache 로 명시적 캐싱 — Supabase JS 의 fetch 는 Next.js 자동 캐싱 안 됨.
//   60초 캐시 + 'link:{handle}' 태그로 revalidateTag 가능 (현재는 revalidatePath 사용 중).
const fetchPage = unstable_cache(
  async (handle: string): Promise<PageData | null> => {
    const sb = publicClient()
    const { data } = await sb
      .from('link_pages')
      .select('*')
      .eq('handle', handle)
      .eq('published', true)
      .maybeSingle()
    return (data as PageData) || null
  },
  ['link-page'],
  { revalidate: 60, tags: ['link-page'] }
)

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params
  const page = await fetchPage(handle)
  const title = page ? `@${handle} · Ssobi.` : `@${handle} · Ssobi.`
  const hero = (page?.hero as { slides?: Array<{ title?: string; sub?: string }> })?.slides?.[0]
  const description = hero?.sub || hero?.title || `${handle}님의 링크 페이지`
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `https://ssobi.ai/u/${handle}`,
      type: 'profile',
      images: ['https://ssobi.ai/og-default.png'],
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function PublicLinkPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const page = await fetchPage(handle)
  if (!page) notFound()
  // 조회수: client.tsx 가 useEffect 에서 /api/link/track 호출

  return (
    <>
      {/* @ts-expect-error — blocks는 JSONB[]이므로 클라이언트에서 narrow */}
      <LinkPageClient page={page} />
      <Script id="ssobi-link-analytics" strategy="afterInteractive">
        {`/* 추후 GA4 조회 이벤트 여기서 */`}
      </Script>
    </>
  )
}
