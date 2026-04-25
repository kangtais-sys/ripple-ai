// PATCH /api/user/preference — 유저 선호 학습 (hook 패턴 / 템플릿)
// body: { hook_type?: 'number'|'fomo'|'reverse'|'main', template?: string }
// 둘 다 선택사항 — 보낸 필드만 업데이트
import { getUserFromRequest, adminClient } from '@/lib/auth-helper'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const VALID_HOOK_TYPES = new Set(['number', 'fomo', 'reverse', 'main'])
const VALID_TEMPLATES = new Set(['clean', 'bold', 'noir', 'luxury', 'mag', 'editorial', 'mono', 'pastel'])

export async function PATCH(req: Request) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    hook_type?: string
    template?: string
  }

  const update: Record<string, string> = {}
  if (typeof body.hook_type === 'string' && VALID_HOOK_TYPES.has(body.hook_type)) {
    update.preferred_hook_type = body.hook_type
  }
  if (typeof body.template === 'string' && VALID_TEMPLATES.has(body.template)) {
    update.preferred_template = body.template
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, reason: 'no_valid_field' }, { status: 400 })
  }

  const sb = adminClient()
  const { error } = await sb
    .from('profiles')
    .update(update)
    .eq('id', user.id)

  if (error) {
    return NextResponse.json({ ok: false, detail: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, updated: Object.keys(update) })
}
