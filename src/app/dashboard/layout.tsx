'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="min-h-screen bg-[#F9FAFB] max-w-[430px] mx-auto relative" style={{ fontFamily: "'Pretendard', sans-serif" }}>
      {/* 메인 콘텐츠 */}
      <main className="px-5 pb-[calc(68px+env(safe-area-inset-bottom)+40px)]">
        {children}
      </main>

      {/* 하단 탭바 — repli_v3 스타일 */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white border-t border-[#F0F2F5] flex z-50" style={{ height: 'calc(68px + env(safe-area-inset-bottom))', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <TabBtn href="/dashboard" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-[22px] h-[22px]" strokeWidth={1.8}><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" strokeLinecap="round" strokeLinejoin="round"/></svg>} label="홈" active={pathname === '/dashboard'} />
        <TabBtn href="/dashboard/tone" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-[22px] h-[22px]" strokeWidth={1.8}><path d="M13 10V3L4 14h7v7l9-11h-7z" strokeLinecap="round" strokeLinejoin="round"/></svg>} label="소셜 활동" active={pathname.startsWith('/dashboard/tone') || pathname.startsWith('/dashboard/logs')} />
        <TabBtn href="/dashboard/connect" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-[22px] h-[22px]" strokeWidth={1.8}><path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" strokeLinecap="round" strokeLinejoin="round"/></svg>} label="관리" active={pathname.startsWith('/dashboard/connect')} badge />
        <TabBtn href="/dashboard/plan" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-[22px] h-[22px]" strokeWidth={1.8}><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round"/></svg>} label="이용권" active={pathname.startsWith('/dashboard/plan')} />
        <TabBtn href="/dashboard/profile" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-[22px] h-[22px]" strokeWidth={1.8}><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" strokeLinecap="round" strokeLinejoin="round"/></svg>} label="내 정보" active={pathname.startsWith('/dashboard/profile')} />
      </nav>
    </div>
  )
}

function TabBtn({ href, icon, label, active, badge }: { href: string; icon: React.ReactNode; label: string; active: boolean; badge?: boolean }) {
  return (
    <Link href={href} className={`flex-1 flex flex-col items-center justify-center gap-1 text-[10px] font-bold transition-colors relative ${active ? 'text-[#1A1F27]' : 'text-[#94A3B8]'}`}>
      {icon}
      {label}
      {badge && <div className="absolute top-[9px] right-[calc(50%-12px)] w-[5px] h-[5px] rounded-full bg-[#FF4D4D] border-[1.5px] border-white" />}
    </Link>
  )
}
