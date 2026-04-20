import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// 루트 / 접속 시 세션 체크:
// 로그인 유저 → /app (app.html)
// 비로그인 → /landing (landing.html)
export default async function Home() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (user) redirect('/app')
  redirect('/landing')
}
