'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'

interface NavItem {
  label: string
  href?: string
  icon: string
  children?: Array<{ label: string; href: string }>
}

const NAV: NavItem[] = [
  { label: '대시보드', href: '/admin', icon: '📊' },
  { label: '회원관리', href: '/admin/users', icon: '👥' },
  { label: '비용관리', href: '/admin/billing', icon: '💰' },
  {
    label: '마케팅 자동화',
    icon: '🤖',
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
    <div className="min-h-screen bg-[#0F1319] text-[#E5E7EB] font-[Pretendard,sans-serif] flex">
      {/* Sidebar */}
      <aside className={`${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} fixed md:sticky top-0 left-0 z-20 w-60 md:w-56 h-screen bg-[#0A0D11] border-r border-white/5 flex flex-col transition-transform`}>
        <div className="px-5 py-5 border-b border-white/5">
          <a href="/admin" className="flex items-center gap-2 text-[15px] font-black tracking-tight">
            Ssobi<span className="text-[#00C896]">.</span>{' '}
            <span className="text-white/40 font-normal">Admin</span>
          </a>
        </div>
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          {NAV.map((item) => {
            if (!item.children) {
              const active = isActive(item.href!)
              return (
                <a key={item.href} href={item.href}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-semibold transition mb-1 ${active ? 'bg-[#00C896]/15 text-[#00C896]' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>
                  <span className="text-[14px]">{item.icon}</span>
                  <span>{item.label}</span>
                </a>
              )
            }
            const someChildActive = item.children.some((c) => isActive(c.href))
            return (
              <div key={item.label} className="mb-1">
                <div className={`flex items-center gap-2 px-3 py-2 text-[12px] font-bold uppercase tracking-wider ${someChildActive ? 'text-[#00C896]' : 'text-white/40'}`}>
                  <span className="text-[14px]">{item.icon}</span>
                  <span>{item.label}</span>
                </div>
                <div className="ml-3 mt-0.5 space-y-0.5">
                  {item.children.map((c) => {
                    const active = isActive(c.href)
                    return (
                      <a key={c.href} href={c.href}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition ${active ? 'bg-[#00C896]/15 text-[#00C896]' : 'text-white/55 hover:text-white hover:bg-white/5'}`}>
                        <span className="w-1 h-1 rounded-full bg-current opacity-50"></span>
                        <span>{c.label}</span>
                      </a>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>
        <div className="px-3 py-4 border-t border-white/5">
          <a href="/app" className="block px-3 py-2 rounded-lg text-[12px] text-white/40 hover:text-white hover:bg-white/5 transition">
            ↗ 앱으로
          </a>
        </div>
      </aside>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden fixed inset-0 z-10 bg-black/50"
          aria-label="close"
        />
      )}

      {/* Main */}
      <div className="flex-1 min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-10 bg-[#0F1319]/95 backdrop-blur border-b border-white/5 px-4 py-3 flex items-center gap-3">
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
