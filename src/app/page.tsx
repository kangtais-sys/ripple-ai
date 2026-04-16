import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="text-[40px] font-black tracking-[-1.5px] text-[#1A1F27] mb-2">Repli<span className="text-[#00C896]">.</span></div>
        <p className="text-gray-500 mb-8">K-뷰티 인플루언서를 위한 SNS 자동 관리</p>
        <div className="space-y-3">
          <Link href="/signup" className="block w-full py-3 rounded-xl bg-[#00C896] text-white font-semibold text-sm hover:bg-[#00B386] transition text-center">
            무료로 시작하기
          </Link>
          <Link href="/login" className="block w-full py-3 rounded-xl border border-gray-200 text-[#1A1F27] font-medium text-sm hover:bg-gray-50 transition text-center">
            로그인
          </Link>
        </div>
      </div>
    </div>
  )
}
