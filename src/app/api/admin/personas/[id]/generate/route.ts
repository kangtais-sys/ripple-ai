import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFromRequest } from '@/lib/auth-helper'
import { isAdminEmail } from '@/lib/admin'
import { generateDraftsForPersona } from '@/lib/persona-generator'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST — 페르소나 draft 즉시 생성 (수동 트리거)
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUserFromRequest(req)
  if (!u) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sb = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data: ud } = await sb.auth.admin.getUserById(u.id)
  if (!ud?.user || !isAdminEmail(ud.user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const result = await generateDraftsForPersona(id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ ok: true, inserted: result.inserted })
}
