import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, plan')
    .eq('id', user.id)
    .single()

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      {/* 상단 헤더 */}
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#00C896] text-white flex items-center justify-center font-bold text-sm">R</div>
          <span className="font-bold text-[#1A1F27]">Repli.</span>
          <span className="text-xs text-gray-400 ml-1">{profile?.plan === 'free' ? 'Free' : profile?.plan}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{profile?.display_name || user.email}</span>
          <form action="/api/auth/signout" method="POST">
            <button className="text-xs text-gray-400 hover:text-gray-600">로그아웃</button>
          </form>
        </div>
      </header>

      {/* 메인 */}
      <main className="max-w-5xl mx-auto p-4">
        {children}
      </main>

      {/* 하단 탭바 (모바일) */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 flex md:hidden">
        <NavTab href="/dashboard" label="홈" />
        <NavTab href="/dashboard/tone" label="말투학습" />
        <NavTab href="/dashboard/logs" label="응대내역" />
        <NavTab href="/dashboard/connect" label="계정연동" />
        <NavTab href="/dashboard/profile" label="내정보" />
      </nav>
    </div>
  )
}

function NavTab({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="flex-1 py-3 text-center text-xs text-gray-500 hover:text-[#00C896] transition">
      {label}
    </Link>
  )
}
