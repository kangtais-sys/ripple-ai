import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { generateDraftsForPersona } from '@/lib/persona-generator'

export const maxDuration = 60

// 일일 페르소나 draft 생성 cron — 매일 KST 09:00
//   활성 페르소나마다 Claude 호출해서 draft N개 생성
//   사용자가 admin/marketing 검수 큐에서 1초 승인

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: personas } = await sb
    .from('marketing_personas')
    .select('id, name')
    .eq('active', true)

  if (!personas?.length) {
    return NextResponse.json({ ok: true, processed: 0, note: 'no active personas' })
  }

  const results: Array<{ persona_id: string; name: string; ok: boolean; inserted?: number; error?: string }> = []
  for (const p of personas) {
    const r = await generateDraftsForPersona(p.id as string)
    results.push({ persona_id: p.id as string, name: p.name as string, ...r })
  }

  const totalInserted = results.reduce((s, r) => s + (r.inserted || 0), 0)
  return NextResponse.json({ ok: true, processed: personas.length, total_inserted: totalInserted, results })
}
