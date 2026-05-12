import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin'

export const metadata = {
  title: 'Ssobi Admin',
  robots: { index: false, follow: false },
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const sb = await createClient()
  const {
    data: { user },
  } = await sb.auth.getUser()

  if (!user || !isAdminEmail(user.email)) {
    redirect('/app')
  }

  return (
    <div className="min-h-screen bg-[#0F1319] text-[#E5E7EB] font-[Pretendard,sans-serif]">
      <header className="sticky top-0 z-10 bg-[#0F1319]/90 backdrop-blur border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[15px] font-black tracking-tight">Ssobi<span className="text-[#00C896]">.</span> <span className="text-white/40 font-normal">Admin</span></span>
          </div>
          <nav className="flex items-center gap-6 text-[13px] font-semibold text-white/60">
            <a href="/admin" className="hover:text-white transition">개요</a>
            <a href="/admin/marketing" className="hover:text-white transition">마케팅</a>
            <a href="/app" className="text-white/40 hover:text-white transition">↗ 앱으로</a>
          </nav>
          <div className="text-[11px] text-white/40">{user.email}</div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  )
}
