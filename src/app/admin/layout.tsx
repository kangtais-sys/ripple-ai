import { createClient } from '@/lib/supabase/server'
import { isAdminEmail, getAdminEmails } from '@/lib/admin'

export const metadata = {
  title: 'Ssobi Admin',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const sb = await createClient()
  const {
    data: { user },
  } = await sb.auth.getUser()

  // 미인증 — 로그인 권유
  if (!user) {
    return (
      <div className="min-h-screen bg-[#0F1319] text-[#E5E7EB] font-[Pretendard,sans-serif] flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <div className="text-3xl font-black tracking-tight">로그인이 필요해요</div>
          <p className="text-[14px] text-white/60 leading-relaxed">
            Ssobi Admin 에 접근하려면 먼저 로그인해주세요.
          </p>
          <a href="/app" className="inline-block bg-[#00C896] hover:bg-[#00A87E] text-white font-bold px-6 py-3 rounded-lg transition">
            로그인하러 가기 →
          </a>
        </div>
      </div>
    )
  }

  // 인증됐지만 admin 아님 — 디버그 정보 + 등록 방법 안내
  if (!isAdminEmail(user.email)) {
    const allowList = getAdminEmails()
    return (
      <div className="min-h-screen bg-[#0F1319] text-[#E5E7EB] font-[Pretendard,sans-serif] flex items-center justify-center p-6">
        <div className="max-w-lg space-y-5 bg-white/[0.03] border border-white/5 rounded-2xl p-8">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-red-400 mb-2">접근 거부</div>
            <div className="text-2xl font-black tracking-tight">관리자 권한이 없어요</div>
          </div>
          <div className="bg-black/40 rounded-lg p-4 space-y-2 font-mono text-[12.5px]">
            <div><span className="text-white/40">너 이메일:</span> <span className="text-amber-300">{user.email || '(없음)'}</span></div>
            <div><span className="text-white/40">허용된 admin:</span> <span className="text-emerald-300">{allowList.join(', ')}</span></div>
          </div>
          <p className="text-[13px] text-white/60 leading-relaxed">
            너 이메일이 허용 목록에 없으면 코드의 <code className="text-amber-300 bg-black/40 px-1.5 py-0.5 rounded text-[11.5px]">src/lib/admin.ts</code> 의
            <code className="text-amber-300 bg-black/40 px-1.5 py-0.5 rounded text-[11.5px] ml-1">HARDCODED_ADMINS</code> 또는
            Vercel env <code className="text-amber-300 bg-black/40 px-1.5 py-0.5 rounded text-[11.5px]">ADMIN_EMAILS</code> 에 추가하세요.
          </p>
          <a href="/app" className="inline-block bg-white/10 hover:bg-white/20 text-white font-semibold px-5 py-2.5 rounded-lg transition text-[13px]">
            ← 앱으로 돌아가기
          </a>
        </div>
      </div>
    )
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
