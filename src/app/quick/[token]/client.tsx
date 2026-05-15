'use client'

import { useEffect, useState } from 'react'

interface PendingData {
  id: string
  channel: 'dm' | 'comment'
  original_message: string
  ai_draft: string
  intent: string | null
  window_expires_at: string
  status: string
}

interface FanData {
  ig_username: string | null
  display_name: string | null
}

interface FetchResponse {
  pending: PendingData
  fan?: FanData | null
  expired: boolean
}

function formatRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return '만료됨'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  if (h > 0) return `${h}시간 ${m}분 남음`
  if (m > 0) return `${m}분 ${s}초 남음`
  return `${s}초 남음`
}

export default function QuickClient({ token }: { token: string }) {
  const [data, setData] = useState<FetchResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<'sent' | 'ignored' | null>(null)
  const [remaining, setRemaining] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/quick/${token}`)
        const j = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(j.error || 'failed')
          setLoading(false)
          return
        }
        setData(j)
        setDraft(j.pending?.ai_draft || '')
        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setError(String(e))
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    if (!data?.pending?.window_expires_at) return
    const tick = () => setRemaining(formatRemaining(data.pending.window_expires_at))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [data?.pending?.window_expires_at])

  async function submit(action: 'send' | 'edit_send' | 'ignore') {
    if (sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/quick/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          final_message: action === 'edit_send' ? draft : undefined,
        }),
      })
      const j = await res.json()
      if (!res.ok) {
        setError(j.error || 'failed')
        return
      }
      setResult(action === 'ignore' ? 'ignored' : 'sent')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB' }}>
        <div style={{ color: '#6B7280', fontSize: 14 }}>로딩 중...</div>
      </div>
    )
  }

  if (error || !data?.pending) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB', padding: 24 }}>
        <div style={{ maxWidth: 400, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8, color: '#1A1F27' }}>승인 페이지를 열 수 없어요</div>
          <div style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6 }}>
            {error === 'not_found' ? '링크가 만료되었거나 잘못된 주소예요.' : error || '알 수 없는 오류'}
          </div>
        </div>
      </div>
    )
  }

  if (data.expired) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB', padding: 24 }}>
        <div style={{ maxWidth: 400, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⏰</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8, color: '#1A1F27' }}>응대 시간이 만료됐어요</div>
          <div style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6 }}>
            인스타그램은 24시간 안에만 답장할 수 있어요. 이 메시지는 더 이상 발송할 수 없습니다.
          </div>
        </div>
      </div>
    )
  }

  if (result === 'sent') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB', padding: 24 }}>
        <div style={{ maxWidth: 400, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✓</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8, color: '#00A87E' }}>발송 완료</div>
          <div style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6 }}>
            팬한테 답장 잘 갔어요. 다음 응대를 기다릴게요.
          </div>
        </div>
      </div>
    )
  }
  if (result === 'ignored') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB', padding: 24 }}>
        <div style={{ maxWidth: 400, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: .4 }}>—</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8, color: '#6B7280' }}>무시했어요</div>
          <div style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6 }}>
            이 응대는 보내지 않습니다.
          </div>
        </div>
      </div>
    )
  }

  const isUrgent = data.pending.intent === 'urgent'
  const fanLabel = data.fan?.ig_username ? `@${data.fan.ig_username}` : '팬'

  return (
    <div style={{
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
      padding: '16px 16px 32px',
      maxWidth: 480,
      margin: '0 auto',
    }}>
      {/* 카운트다운 */}
      <div style={{
        background: isUrgent ? '#FEE2E2' : '#FFF7ED',
        color: isUrgent ? '#991B1B' : '#9A3412',
        padding: '12px 16px',
        borderRadius: 12,
        fontSize: 13,
        fontWeight: 800,
        textAlign: 'center',
        marginBottom: 16,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}>
        ⏰ {remaining}
        {isUrgent && <span style={{ marginLeft: 8 }}>· 긴급</span>}
      </div>

      {/* 원 메시지 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#6B7280', letterSpacing: 1, marginBottom: 8 }}>
          {data.pending.channel === 'dm' ? 'DM' : '댓글'} · {fanLabel}
        </div>
        <div style={{
          background: '#fff',
          border: '1px solid #E5E7EB',
          borderRadius: 12,
          padding: 14,
          fontSize: 14,
          lineHeight: 1.55,
          color: '#1A1F27',
          whiteSpace: 'pre-wrap',
        }}>
          {data.pending.original_message}
        </div>
      </div>

      {/* AI 답안 (편집 가능) */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#6B7280', letterSpacing: 1, marginBottom: 8 }}>
          AI 답안 (수정 가능)
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          style={{
            width: '100%',
            background: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: 12,
            padding: 14,
            fontSize: 14,
            lineHeight: 1.55,
            color: '#1A1F27',
            fontFamily: 'inherit',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* 버튼 */}
      <button
        onClick={() => submit(draft === data.pending.ai_draft ? 'send' : 'edit_send')}
        disabled={sending || !draft.trim()}
        style={{
          width: '100%',
          background: '#00C896',
          color: '#fff',
          fontWeight: 800,
          fontSize: 16,
          padding: '16px',
          borderRadius: 12,
          border: 'none',
          cursor: sending ? 'not-allowed' : 'pointer',
          opacity: sending || !draft.trim() ? 0.5 : 1,
          marginBottom: 10,
        }}
      >
        {sending ? '발송 중...' : '✓ 지금 발송'}
      </button>

      <button
        onClick={() => submit('ignore')}
        disabled={sending}
        style={{
          width: '100%',
          background: 'transparent',
          color: '#6B7280',
          fontWeight: 700,
          fontSize: 13,
          padding: '12px',
          border: 'none',
          cursor: sending ? 'not-allowed' : 'pointer',
        }}
      >
        무시
      </button>
    </div>
  )
}
