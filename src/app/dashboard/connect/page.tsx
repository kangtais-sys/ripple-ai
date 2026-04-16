'use client'

import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'

interface IgAccount {
  ig_username: string
  created_at: string
}

export default function ConnectPage() {
  const [accounts, setAccounts] = useState<IgAccount[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data } = await supabase.from('ig_accounts').select('ig_username, created_at')
      setAccounts(data || [])
      setLoading(false)
    }
    load()
  }, [])

  function startInstagramOAuth() {
    const appId = process.env.NEXT_PUBLIC_META_APP_ID
    const redirectUri = `${window.location.origin}/api/auth/callback/instagram`
    const scope = 'instagram_business_basic,instagram_manage_comments,instagram_business_manage_messages'
    const url = `https://www.instagram.com/oauth/authorize?enable_fb_login=0&force_authentication=1&client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}`
    window.location.href = url
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-[#1A1F27]">계정 연동</h1>

      {/* 연동된 계정 목록 */}
      {accounts.length > 0 && (
        <div className="space-y-2">
          {accounts.map(a => (
            <div key={a.ig_username} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[#1A1F27]">@{a.ig_username}</p>
                <p className="text-xs text-gray-400">Instagram</p>
              </div>
              <span className="text-xs text-[#00C896] font-medium bg-[#00C896]/10 px-2 py-1 rounded-full">연동됨</span>
            </div>
          ))}
        </div>
      )}

      {/* 연동 버튼 */}
      <button
        onClick={startInstagramOAuth}
        disabled={loading}
        className="w-full py-3 rounded-xl bg-[#00C896] text-white font-semibold text-sm hover:bg-[#00A87E] transition disabled:opacity-50"
      >
        Instagram 비즈니스 계정 연동하기
      </button>

      <div className="bg-gray-50 rounded-xl p-4 space-y-2">
        <p className="text-xs font-semibold text-gray-600">연동 전 확인사항</p>
        <ul className="text-xs text-gray-500 space-y-1 list-disc list-inside">
          <li>Instagram 비즈니스 또는 크리에이터 계정이어야 합니다</li>
          <li>Facebook 페이지와 연결되어 있어야 합니다</li>
          <li>댓글 관리, DM 읽기/쓰기 권한을 허용해주세요</li>
        </ul>
      </div>
    </div>
  )
}
