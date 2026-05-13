'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'

interface NavItem {
  label: string
  href?: string
  children?: Array<{ label: string; href: string }>
}

const NAV: NavItem[] = [
  { label: '대시보드', href: '/admin' },
  { label: '회원관리', href: '/admin/users' },
  { label: '비용관리', href: '/admin/billing' },
  {
    label: '마케팅 자동화',
    children: [
      { label: '페르소나', href: '/admin/personas' },
      { label: '콘텐츠 큐', href: '/admin/marketing' },
    ],
  },
]

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/admin'
  const [mobileOpen, setMobileOpen] = useState(false)

  function isActive(href: string) {
    if (href === '/admin') return pathname === '/admin'
    return pathname === href || pathname.startsWith(href + '/')
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] text-[#1A1F27] font-[Pretendard,sans-serif] flex">
      {/* Sidebar */}
      <aside className={`${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} fixed md:sticky top-0 left-0 z-20 w-60 md:w-56 h-screen bg-white border-r border-gray-200 flex flex-col transition-transform`}>
        <div className="px-5 py-5 border-b border-gray-200">
          <a href="/admin" className="flex items-center gap-2 text-[15px] font-black tracking-tight text-[#1A1F27]">
            Ssobi<span className="text-[#00C896]">.</span>{' '}
            <span className="text-gray-400 font-normal">Admin</span>
          </a>
        </div>
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          {NAV.map((item) => {
            if (!item.children) {
              const active = isActive(item.href!)
              return (
                <a key={item.href} href={item.href}
                  className={`block px-3 py-2 rounded-lg text-[13px] font-semibold transition mb-1 ${active ? 'bg-[#00C896]/10 text-[#00C896]' : 'text-gray-600 hover:text-[#1A1F27] hover:bg-gray-50'}`}>
                  {item.label}
                </a>
              )
            }
            const someChildActive = item.children.some((c) => isActive(c.href))
            return (
              <div key={item.label} className="mb-1 mt-3">
                <div className={`px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wider ${someChildActive ? 'text-[#00C896]' : 'text-gray-400'}`}>
                  {item.label}
                </div>
                <div className="space-y-0.5">
                  {item.children.map((c) => {
                    const active = isActive(c.href)
                    return (
                      <a key={c.href} href={c.href}
                        className={`block px-3 py-1.5 rounded-lg text-[13px] font-medium transition ${active ? 'bg-[#00C896]/10 text-[#00C896]' : 'text-gray-600 hover:text-[#1A1F27] hover:bg-gray-50'}`}>
                        {c.label}
                      </a>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>
        <div className="px-3 py-4 border-t border-gray-200">
          <a href="/app" className="block px-3 py-2 rounded-lg text-[12px] text-gray-400 hover:text-[#1A1F27] hover:bg-gray-50 transition">
            앱으로 이동
          </a>
        </div>
      </aside>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden fixed inset-0 z-10 bg-black/30"
          aria-label="close"
        />
      )}

      {/* Main */}
      <div className="flex-1 min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setMobileOpen(true)} aria-label="menu" className="p-2 -m-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
            </svg>
          </button>
          <span className="text-[14px] font-black">Ssobi<span className="text-[#00C896]">.</span> Admin</span>
        </div>
        <main className="px-6 py-8 max-w-7xl">{children}</main>
      </div>
    </div>
  )
}
