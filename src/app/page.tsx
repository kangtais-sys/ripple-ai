import { redirect } from 'next/navigation'

export default function Home() {
  // app.html이 자체적으로 Supabase 세션 체크 후 홈/온보딩 분기
  redirect('/app.html')
}
