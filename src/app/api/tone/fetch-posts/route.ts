import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// 연동된 IG 계정의 최근 게시물 캡션을 가져옴
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: accounts } = await supabase
    .from('ig_accounts')
    .select('access_token, ig_username')
    .eq('user_id', user.id)
    .limit(1)

  if (!accounts?.length) {
    return NextResponse.json({ error: 'no_ig_account', captions: [] })
  }

  const token = accounts[0].access_token

  try {
    // 최근 게시물 25개의 캡션 가져오기
    const mediaRes = await fetch(
      `https://graph.instagram.com/v21.0/me/media?fields=caption,timestamp&limit=25&access_token=${token}`
    )
    const mediaData = await mediaRes.json()

    if (!mediaData.data) {
      console.error('[Fetch Posts] Error:', mediaData.error)
      return NextResponse.json({ error: 'ig_api_error', captions: [] })
    }

    const captions = mediaData.data
      .filter((p: { caption?: string }) => p.caption && p.caption.length > 10)
      .map((p: { caption: string }) => p.caption)
      .slice(0, 15)

    return NextResponse.json({ captions, username: accounts[0].ig_username })
  } catch (e) {
    console.error('[Fetch Posts] Error:', e)
    return NextResponse.json({ error: 'fetch_failed', captions: [] })
  }
}
