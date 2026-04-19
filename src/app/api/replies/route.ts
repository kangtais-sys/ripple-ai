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
  // status 필터: pending | sent | all
  const statusFilter = searchParams.get('status') || 'all'

  let q = supabase
    .from('reply_logs')
    .select('id, type, original_text, reply_text, final_reply, is_approved, send_status, urgency, sentiment, platform_id, ig_account_id, created_at, approved_at', { count: 'exact' })
    .eq('user_id', user.id)

  if (statusFilter === 'pending') {
    q = q.eq('send_status', 'pending').is('is_approved', null)
  } else if (statusFilter === 'sent') {
    q = q.eq('send_status', 'sent')
  } else if (statusFilter === 'skipped') {
    q = q.eq('send_status', 'skipped')
  }

  const { data: replies, error, count } = await q
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
