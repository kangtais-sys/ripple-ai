// 공개 링크 페이지 /u/[handle] — Supabase에서 link_pages 조회 후 SSR 렌더
import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Script from 'next/script'
import LinkPageClient from './client'

// anon 키 사용 — RLS의 "Public reads published link_pages" 정책으로 접근
function publicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
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

  // TODO: view_count 증가는 SECURITY DEFINER RPC로 별도 처리 (RLS 때문에
  // anon 클라이언트로 update 불가). 일단 SSR 표시에만 사용.

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
