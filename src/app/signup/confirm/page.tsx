'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function ConfirmContent() {
  const params = useSearchParams()
  const email = params.get('email') || ''

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#00C896]/10 text-[#00C896] text-3xl mb-6">
          ✉
        </div>
        <h1 className="text-2xl font-bold text-[#1A1F27] mb-2">이메일을 확인해주세요</h1>
        <p className="text-sm text-gray-500 mb-1">
          <span className="font-medium text-[#1A1F27]">{email}</span>
        </p>
        <p className="text-sm text-gray-500 mb-6">
          으로 확인 메일을 보냈습니다.<br />
          메일의 링크를 클릭하면 가입이 완료됩니다.
        </p>
        <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-400 space-y-1 mb-6">
          <p>메일이 안 보이면 스팸함을 확인해주세요.</p>
          <p>발신자: Repli. (noreply@mail.app.supabase.io)</p>
        </div>
        <Link href="/login" className="text-sm text-[#00C896] font-medium hover:underline">
          로그인 페이지로 이동
        </Link>
      </div>
    </div>
  )
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center"><p className="text-gray-400">로딩 중...</p></div>}>
      <ConfirmContent />
    </Suspense>
  )
}
