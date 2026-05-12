// Admin layout — 좌측 사이드바 네비게이션
//   대시보드 / 회원관리 / 비용관리 / 마케팅 자동화 (페르소나·콘텐츠·자산)
//
// 인증·권한 체크는 각 page client component 에서 처리
//   (app.html 의 supabase-js localStorage 세션 호환)

import type { Metadata } from 'next'
import AdminShell from './shell'

export const metadata: Metadata = {
  title: 'Ssobi Admin',
  robots: { index: false, follow: false },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>
}
