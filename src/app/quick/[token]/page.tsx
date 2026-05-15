// /quick/[token] — 모바일 1-탭 응대 승인 페이지
// 솔라피 알림톡 클릭 → 이 페이지 → [발송] / [수정 후 발송] / [무시]

import QuickClient from './client'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <QuickClient token={token} />
}
