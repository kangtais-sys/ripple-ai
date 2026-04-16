'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="min-h-screen bg-[#F9FAFB] max-w-[430px] mx-auto relative" style={{ fontFamily: "'Pretendard', sans-serif" }}>
      {/* 메인 콘텐츠 — 탭바 높이만큼 하단 여백 */}
      <main className="px-5 pb-[120px]">
        {children}
      </main>

      {/* 하단 탭바 */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] h-[68px] bg-white border-t border-[#F0F2F5] flex items-stretch z-50 pb-[env(safe-area-inset-bottom)]">
        <TabBtn href="/dashboard" label="홈" active={pathname === '/dashboard'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </TabBtn>
        <TabBtn href="/dashboard/tone" label="소셜 활동" active={pathname.startsWith('/dashboard/tone') || pathname.startsWith('/dashboard/logs')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M13 10V3L4 14h7v7l9-11h-7z" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </TabBtn>
        <TabBtn href="/dashboard/connect" label="관리" active={pathname.startsWith('/dashboard/connect')} badge>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </TabBtn>
        <TabBtn href="/dashboard/plan" label="이용권" active={pathname.startsWith('/dashboard/plan')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </TabBtn>
        <TabBtn href="/dashboard/profile" label="내 정보" active={pathname.startsWith('/dashboard/profile')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </TabBtn>
      </nav>
    </div>
  )
}

function TabBtn({ href, label, active, badge, children }: { href: string; label: string; active: boolean; badge?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`flex-1 flex flex-col items-center justify-center gap-1 relative no-underline ${active ? 'text-[#1A1F27]' : 'text-[#94A3B8]'}`}
      style={{ fontSize: '10px', fontWeight: 700, textDecoration: 'none' }}
    >
      <div className="w-[22px] h-[22px]">{children}</div>
      <span>{label}</span>
      {badge && <div className="absolute top-[10px] right-[calc(50%-14px)] w-[5px] h-[5px] rounded-full bg-[#FF4D4D] border-[1.5px] border-white" />}
    </Link>
  )
}
