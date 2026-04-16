import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()

  // 로그인 유저 확인
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
  const offset = (page - 1) * limit

  // 전체 건수
  const { count } = await supabase
    .from('reply_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)

  // 페이지네이션된 응대 내역 (최신순)
  const { data: replies, error } = await supabase
    .from('reply_logs')
    .select('type, original_text, reply_text, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    replies: replies || [],
    total: count || 0,
    page,
  })
}
