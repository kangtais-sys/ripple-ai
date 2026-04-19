// POST /api/replies/[id]/skip — 드래프트 폐기 (발송 안 함)
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { error } = await sb
    .from('reply_logs')
    .update({
      is_approved: false,
      send_status: 'skipped',
      approved_at: new Date().toISOString(),
      approved_by: user.id,
    })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 연결된 outbound_messages도 canceled로
  await sb.from('outbound_messages')
    .update({ status: 'canceled' })
    .eq('source_ref_type', 'reply_logs')
    .eq('source_ref_id', id)

  return NextResponse.json({ ok: true })
}
