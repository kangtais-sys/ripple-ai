'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type ChannelKey = 'instagram' | 'threads' | 'facebook' | 'x'

interface ChannelInfo {
  key: ChannelKey
  label: string
  maxChars: number
  requiresImage: boolean
  note: string
}

const CHANNELS: ChannelInfo[] = [
  { key: 'instagram', label: 'Instagram', maxChars: 2200, requiresImage: true,  note: '이미지 필수' },
  { key: 'threads',   label: 'Threads',   maxChars: 500,  requiresImage: false, note: '500자 제한' },
  { key: 'facebook',  label: 'Facebook',  maxChars: 63206, requiresImage: false, note: '무제한' },
  { key: 'x',         label: 'X',         maxChars: 280,  requiresImage: false, note: '280자, API 미연동' },
]

interface Post {
  id: string
  content: string
  image_urls: string[]
  channels: ChannelKey[]
  scheduled_at: string
  status: string
  results?: Record<string, { ok: boolean; id?: string; error?: string }>
  published_at: string | null
  error: string | null
  created_at: string
}

function statusBadge(status: string) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    pending:    { bg: 'bg-amber-500/10',  fg: 'text-amber-300',  label: '대기' },
    publishing: { bg: 'bg-blue-500/10',   fg: 'text-blue-300',   label: '발행중' },
    published:  { bg: 'bg-emerald-500/10',fg: 'text-emerald-300',label: '발행됨' },
    partial:    { bg: 'bg-orange-500/10', fg: 'text-orange-300', label: '부분 성공' },
    failed:     { bg: 'bg-red-500/10',    fg: 'text-red-300',    label: '실패' },
    cancelled:  { bg: 'bg-white/10',      fg: 'text-white/40',   label: '취소' },
  }
  const s = map[status] || map.pending
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${s.bg} ${s.fg} uppercase tracking-wider`}>{s.label}</span>
}

export default function MarketingClient() {
  const [content, setContent] = useState('')
  const [imageInput, setImageInput] = useState('')
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [channels, setChannels] = useState<Set<ChannelKey>>(new Set(['instagram', 'threads', 'facebook']))
  const [scheduleNow, setScheduleNow] = useState(true)
  const [scheduledAt, setScheduledAt] = useState('')
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => { loadPosts() }, [])

  // app.html 의 localStorage 세션을 Bearer 헤더로 전달 (SSR 쿠키 우회)
  async function authHeaders(): Promise<HeadersInit> {
    const sb = createClient()
    const { data } = await sb.auth.getSession()
    const token = data.session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  async function loadPosts() {
    try {
      const h = await authHeaders()
      const res = await fetch('/api/admin/marketing', { headers: h })
      if (!res.ok) return
      const j = await res.json()
      setPosts(j.posts || [])
    } catch {}
  }

  function toggleChannel(ch: ChannelKey) {
    const next = new Set(channels)
    if (next.has(ch)) next.delete(ch)
    else next.add(ch)
    setChannels(next)
  }

  function addImage() {
    const url = imageInput.trim()
    if (!url) return
    setImageUrls([...imageUrls, url])
    setImageInput('')
  }

  function removeImage(idx: number) {
    setImageUrls(imageUrls.filter((_, i) => i !== idx))
  }

  async function submit() {
    if (!content.trim()) { setMsg('본문을 입력해주세요'); return }
    if (channels.size === 0) { setMsg('채널을 1개 이상 선택'); return }

    // 채널별 길이 체크
    for (const ch of channels) {
      const info = CHANNELS.find(c => c.key === ch)
      if (!info) continue
      if (content.length > info.maxChars) {
        setMsg(`${info.label}: ${content.length}/${info.maxChars}자 초과`); return
      }
      if (info.requiresImage && imageUrls.length === 0) {
        setMsg(`${info.label}: 이미지 필수`); return
      }
    }

    setLoading(true); setMsg(null)
    try {
      const h = await authHeaders()
      const res = await fetch('/api/admin/marketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({
          content,
          image_urls: imageUrls,
          channels: Array.from(channels),
          scheduled_at: scheduleNow ? new Date().toISOString() : new Date(scheduledAt).toISOString(),
        }),
      })
      const j = await res.json()
      if (!res.ok) { setMsg(j.error || '실패'); return }
      setMsg('큐에 등록됐어요')
      setContent(''); setImageUrls([]); setScheduledAt('')
      await loadPosts()
    } finally {
      setLoading(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('이 글 삭제할까?')) return
    const h = await authHeaders()
    await fetch(`/api/admin/marketing?id=${id}`, { method: 'DELETE', headers: h })
    await loadPosts()
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight mb-1">마케팅 발행</h1>
        <p className="text-[13px] text-white/50">Ssobi 공식 SNS 채널 자동 발행 · 5분마다 큐 처리</p>
      </div>

      {/* 작성 폼 */}
      <section className="rounded-2xl bg-white/[0.03] border border-white/5 p-6 space-y-4">
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/60">새 게시물</h2>

        <div>
          <div className="flex justify-between mb-2">
            <label className="text-[12px] font-semibold text-white/70">본문</label>
            <span className="text-[11px] text-white/40">{content.length}자</span>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="이번 주 Ssobi 핵심 메시지..."
            rows={6}
            className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-3 text-[14px] text-white placeholder-white/30 focus:border-[#00C896] focus:outline-none resize-y"
          />
          <div className="mt-1.5 flex flex-wrap gap-2 text-[10.5px]">
            {CHANNELS.filter(c => channels.has(c.key)).map(c => {
              const over = content.length > c.maxChars
              return (
                <span key={c.key} className={`px-2 py-0.5 rounded ${over ? 'bg-red-500/15 text-red-300' : 'bg-white/5 text-white/50'}`}>
                  {c.label} {content.length}/{c.maxChars}
                </span>
              )
            })}
          </div>
        </div>

        <div>
          <label className="text-[12px] font-semibold text-white/70 mb-2 block">이미지 URL</label>
          <div className="flex gap-2 mb-2">
            <input
              value={imageInput}
              onChange={(e) => setImageInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addImage() } }}
              placeholder="https://..."
              className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[13px] text-white placeholder-white/30 focus:border-[#00C896] focus:outline-none"
            />
            <button onClick={addImage} className="bg-white/10 hover:bg-white/20 px-3 py-2 rounded-lg text-[12px] font-semibold transition">추가</button>
          </div>
          <div className="space-y-1.5">
            {imageUrls.map((u, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px] text-white/60 bg-black/20 rounded-lg px-3 py-1.5">
                <span className="flex-1 truncate">{u}</span>
                <button onClick={() => removeImage(i)} className="text-red-400 hover:text-red-300">✕</button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[12px] font-semibold text-white/70 mb-2 block">채널</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {CHANNELS.map(c => {
              const on = channels.has(c.key)
              return (
                <button
                  key={c.key}
                  onClick={() => toggleChannel(c.key)}
                  className={`text-left px-3 py-2.5 rounded-lg border transition ${on ? 'border-[#00C896] bg-[#00C896]/10' : 'border-white/10 bg-black/20 hover:border-white/20'}`}
                >
                  <div className={`text-[13px] font-bold ${on ? 'text-[#00C896]' : 'text-white/80'}`}>{c.label}</div>
                  <div className="text-[10.5px] text-white/40 mt-0.5">{c.note}</div>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label className="text-[12px] font-semibold text-white/70 mb-2 block">발행 시각</label>
          <div className="flex items-center gap-3 mb-2">
            <label className="flex items-center gap-1.5 text-[12px] cursor-pointer">
              <input type="radio" checked={scheduleNow} onChange={() => setScheduleNow(true)} />
              <span>지금 (5분 내)</span>
            </label>
            <label className="flex items-center gap-1.5 text-[12px] cursor-pointer">
              <input type="radio" checked={!scheduleNow} onChange={() => setScheduleNow(false)} />
              <span>예약</span>
            </label>
          </div>
          {!scheduleNow && (
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[13px] text-white focus:border-[#00C896] focus:outline-none"
            />
          )}
        </div>

        {msg && <div className="text-[12.5px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-2">{msg}</div>}

        <button
          onClick={submit}
          disabled={loading}
          className="w-full bg-[#00C896] hover:bg-[#00A87E] disabled:opacity-50 text-white font-bold py-3 rounded-lg transition"
        >
          {loading ? '등록 중...' : '큐에 등록'}
        </button>
      </section>

      {/* 목록 */}
      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/60 mb-3">최근 큐 ({posts.length})</h2>
        {posts.length === 0 ? (
          <div className="text-[13px] text-white/40 py-8 text-center border border-dashed border-white/10 rounded-2xl">아직 등록된 게시물이 없어요</div>
        ) : (
          <div className="space-y-2">
            {posts.map(p => (
              <div key={p.id} className="rounded-xl bg-white/[0.03] border border-white/5 p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    {statusBadge(p.status)}
                    <span className="text-[11px] text-white/40">{new Date(p.created_at).toLocaleString('ko-KR')}</span>
                  </div>
                  {(p.status === 'pending' || p.status === 'failed' || p.status === 'cancelled') && (
                    <button onClick={() => remove(p.id)} className="text-[11px] text-red-400 hover:text-red-300">삭제</button>
                  )}
                </div>
                <div className="text-[13px] text-white/80 whitespace-pre-wrap leading-relaxed mb-2">{p.content}</div>
                <div className="flex flex-wrap gap-1.5">
                  {p.channels.map(ch => {
                    const result = p.results?.[ch]
                    const okSym = !result ? '' : result.ok ? '✓' : '✕'
                    const tone = !result ? 'text-white/60 bg-white/5' : result.ok ? 'text-emerald-300 bg-emerald-500/10' : 'text-red-300 bg-red-500/10'
                    return (
                      <span key={ch} className={`text-[10.5px] font-semibold px-2 py-0.5 rounded ${tone}`}>{ch} {okSym}</span>
                    )
                  })}
                </div>
                {p.error && <div className="text-[10.5px] text-red-300 mt-2 font-mono">{p.error}</div>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
