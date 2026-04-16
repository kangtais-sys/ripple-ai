import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, plan, created_at')
    .eq('id', user.id)
    .single()

  return (
    <div>
      <div className="py-5 pb-4">
        <div className="text-[18px] font-extrabold text-[#1A1F27]">내 정보</div>
      </div>

      <div className="bg-white rounded-[20px] p-5 border border-[#F0F2F5] space-y-4">
        <div>
          <div className="text-[10px] font-semibold text-[#94A3B8] mb-1">이름</div>
          <div className="text-[14px] font-bold text-[#1A1F27]">{profile?.display_name || '-'}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold text-[#94A3B8] mb-1">이메일</div>
          <div className="text-[14px] font-bold text-[#1A1F27]">{user.email}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold text-[#94A3B8] mb-1">플랜</div>
          <div className="text-[14px] font-bold text-[#1A1F27] capitalize">{profile?.plan || 'free'}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold text-[#94A3B8] mb-1">가입일</div>
          <div className="text-[14px] font-bold text-[#1A1F27]">
            {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('ko-KR') : '-'}
          </div>
        </div>
      </div>

      <form action="/api/auth/signout" method="POST" className="mt-4">
        <button className="w-full py-3 rounded-2xl border border-[#F0F2F5] text-[13px] font-semibold text-[#94A3B8] hover:text-[#FF4D4D] hover:border-[#FF4D4D]/30 transition">
          로그아웃
        </button>
      </form>
    </div>
  )
}
