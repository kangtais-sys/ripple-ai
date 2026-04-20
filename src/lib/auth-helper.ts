// Supabase JS CDN (localStorage 세션) + @supabase/ssr (쿠키 세션) 동시 지원
// Bearer 토큰 우선, 없으면 쿠키 fallback
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

export async function getUserFromRequest(req: Request): Promise<{ id: string } | null> {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const { data } = await admin.auth.getUser(token)
    if (data.user) return { id: data.user.id }
  }

  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (user) return { id: user.id }

  return null
}

export function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
