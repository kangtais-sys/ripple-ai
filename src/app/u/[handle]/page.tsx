// 공개 링크 페이지 /u/[handle] — Supabase에서 link_pages 조회 후 SSR 렌더
//
// 2026-05-07: dynamic='force-dynamic' 추가 — 유저 편집 즉시 반영
//   기본 Next.js 동작은 정적 캐싱 → 새 편집이 페이지에 안 보이는 버그 발생
import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Script from 'next/script'
import LinkPageClient from './client'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// anon 키 사용 — RLS의 "Public reads published link_pages" 정책으로 접근
function publicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// service_role — view_count·일일 통계 증가 (RLS 우회)
//   서버 컴포넌트 안에서만 사용, 클라이언트에 절대 노출 X
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// 조회수 + 일일 통계 비동기 기록 (페이지 렌더 차단 X)
//   service_role 로 RLS 우회. atomic increment 는 SQL function 없이 read-then-write
//   (동시성 충돌은 매우 낮은 트래픽이라 무시 가능 — 추후 RPC 로 atomic 화 가능)
async function trackPageView(linkPageId: string) {
  try {
    const sb = adminClient()
    // 1) total view_count 증가
    const { data: cur } = await sb
      .from('link_pages')
      .select('view_count')
      .eq('id', linkPageId)
      .maybeSingle()
    const newCount = ((cur?.view_count as number) || 0) + 1
    await sb.from('link_pages').update({ view_count: newCount }).eq('id', linkPageId)
    // 2) 일일 통계 upsert (KST 기준)
    const dateKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    const { data: dayRow } = await sb
      .from('link_page_daily_stats')
      .select('views')
      .eq('link_page_id', linkPageId)
      .eq('date', dateKst)
      .maybeSingle()
    if (dayRow) {
      await sb
        .from('link_page_daily_stats')
        .update({ views: ((dayRow.views as number) || 0) + 1 })
        .eq('link_page_id', linkPageId)
        .eq('date', dateKst)
    } else {
      await sb
        .from('link_page_daily_stats')
        .insert({ link_page_id: linkPageId, date: dateKst, views: 1, unique_visitors: 1 })
    }
  } catch {
    // 통계 기록 실패해도 페이지는 정상 표시
  }
}

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

async function fetchPage(handle: string): Promise<PageData | null> {
  const sb = publicClient()
  const { data } = await sb
    .from('link_pages')
    .select('*')
    .eq('handle', handle)
    .eq('published', true)
    .maybeSingle()
  return (data as PageData) || null
}

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

  // 비동기 조회수 + 일일 통계 기록 (페이지 응답 차단 X)
  //   await 안 함 — 트래킹 실패해도 사용자는 즉시 페이지 봄
  trackPageView(page.id).catch(() => {})

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
