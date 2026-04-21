// GET /api/cardnews/:id/image  (public, no auth)
// Instagram Graph API가 이 URL로 이미지를 fetch 해서 업로드함
// card_news_jobs 의 prompt_hook 등을 Satori(ImageResponse)로 1080x1080 PNG 렌더

import { ImageResponse } from 'next/og'
import { createClient as createAdmin } from '@supabase/supabase-js'

export const runtime = 'edge'

type Params = { id: string }

export async function GET(req: Request, ctx: { params: Promise<Params> }) {
  const { id } = await ctx.params
  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data: job } = await admin
    .from('card_news_jobs')
    .select('prompt_hook, prompt_body, topic, template')
    .eq('id', id)
    .maybeSingle()

  const hook = (job?.prompt_hook as string) || (job?.topic as string) || 'Ssobi Cardnews'
  const tpl = (job?.template as string) || 'clean'
  const palette: Record<string, { bg: string; fg: string; accent: string }> = {
    clean:     { bg: '#FFFFFF', fg: '#1A1F27', accent: '#00C896' },
    bold:      { bg: '#1A1F27', fg: '#FFFFFF', accent: '#00C896' },
    mint:      { bg: '#00C896', fg: '#FFFFFF', accent: '#FFFFFF' },
    mag:       { bg: '#FAF7F2', fg: '#1A1F27', accent: '#00C896' },
    mono:      { bg: '#0F1319', fg: '#FFFFFF', accent: '#00C896' },
    editorial: { bg: '#FFF9F0', fg: '#2A1E12', accent: '#00A87E' },
    pastel:    { bg: 'linear-gradient(135deg,#FCE7F3,#E9D5FF)', fg: '#1A1F27', accent: '#8B5CF6' },
    pop:       { bg: '#FFD233', fg: '#1A1F27', accent: '#FF4D4D' },
  }
  const p = palette[tpl] || palette.clean

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 80,
          background: p.bg,
          color: p.fg,
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: 2,
            marginBottom: 32,
            color: p.accent,
            textTransform: 'uppercase',
          }}
        >
          Ssobi
        </div>
        <div
          style={{
            fontSize: hook.length > 30 ? 56 : 76,
            fontWeight: 900,
            lineHeight: 1.25,
            textAlign: 'center',
            letterSpacing: -1,
          }}
        >
          {hook}
        </div>
        <div
          style={{
            marginTop: 48,
            width: 80,
            height: 4,
            background: p.accent,
            borderRadius: 4,
          }}
        />
      </div>
    ),
    { width: 1080, height: 1080 }
  )
}
