'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function DashboardPage() {
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        window.location.href = '/login'
        return
      }
      // 세션 있으면 app.html로 이동 (repli_v3 원본)
      window.location.href = '/app.html'
    })
  }, [supabase])

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Pretendard, sans-serif',
      background: '#F9FAFB',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: -1.2, color: '#1A1F27' }}>
          Repli<span style={{ color: '#00C896' }}>.</span>
        </div>
        <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 8 }}>로딩 중...</div>
      </div>
    </div>
  )
}
