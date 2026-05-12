// admin 영역 layout — 인증·권한 체크는 page 에서 client-side 로 처리
// (app.html 의 supabase-js localStorage 세션과 호환되려면 SSR 쿠키 대신
//  client-side fetch 가 필요)
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Ssobi Admin',
  robots: { index: false, follow: false },
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#0F1319] text-[#E5E7EB] font-[Pretendard,sans-serif]">
      <header className="sticky top-0 z-10 bg-[#0F1319]/90 backdrop-blur border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[15px] font-black tracking-tight">
              Ssobi<span className="text-[#00C896]">.</span>{' '}
              <span className="text-white/40 font-normal">Admin</span>
            </span>
          </div>
          <nav className="flex items-center gap-6 text-[13px] font-semibold text-white/60">
            <a href="/admin" className="hover:text-white transition">개요</a>
            <a href="/admin/users" className="hover:text-white transition">가입자</a>
            <a href="/admin/personas" className="hover:text-white transition">페르소나</a>
            <a href="/admin/marketing" className="hover:text-white transition">마케팅</a>
            <a href="/app" className="text-white/40 hover:text-white transition">↗ 앱으로</a>
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  )
}
