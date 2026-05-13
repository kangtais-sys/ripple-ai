'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

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
  persona_id?: string | null
  topic_pillar?: string | null
  short_code?: string | null
  click_count?: number
  signup_count?: number
}

function statusBadge(status: string) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    draft:      { bg: 'bg-violet-50',  fg: 'text-violet-700',  label: 'draft' },
    pending:    { bg: 'bg-amber-50',   fg: 'text-amber-700',   label: '대기' },
    publishing: { bg: 'bg-blue-50',    fg: 'text-blue-700',    label: '발행중' },
    published:  { bg: 'bg-emerald-50', fg: 'text-emerald-700', label: '발행됨' },
    partial:    { bg: 'bg-orange-50',  fg: 'text-orange-700',  label: '부분 성공' },
    failed:     { bg: 'bg-red-50',     fg: 'text-red-700',     label: '실패' },
    cancelled:  { bg: 'bg-gray-100',   fg: 'text-gray-500',    label: '취소' },
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
  const [advancedMode, setAdvancedMode] = useState(false)  // URL 입력은 수동 모드에서만

  useEffect(() => { loadPosts() }, [])

  async function authHeaders(): Promise<HeadersInit> {
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
        <h1 className="text-2xl font-black tracking-tight mb-1">콘텐츠 큐</h1>
        <p className="text-[13px] text-gray-500">페르소나 자동 생성 + 수동 작성. 5분마다 큐 처리 후 발행</p>
      </div>

      <section className="rounded-2xl bg-white border border-gray-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-gray-600">수동 작성</h2>
          <button
            onClick={() => setAdvancedMode(!advancedMode)}
            className="text-[11px] text-gray-500 hover:text-[#1A1F27] font-medium"
          >
            {advancedMode ? '간단 모드로' : '고급 모드 (URL 직접 입력)'}
          </button>
        </div>

        <div>
          <div className="flex justify-between mb-2">
            <label className="text-[12px] font-semibold text-gray-700">본문</label>
            <span className="text-[11px] text-gray-500">{content.length}자</span>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="이번 주 Ssobi 핵심 메시지..."
            rows={6}
            className="w-full bg-white border border-gray-300 rounded-lg px-4 py-3 text-[14px] text-[#1A1F27] placeholder-gray-400 focus:border-[#00C896] focus:outline-none resize-y"
          />
          <div className="mt-1.5 flex flex-wrap gap-2 text-[10.5px]">
            {CHANNELS.filter(c => channels.has(c.key)).map(c => {
              const over = content.length > c.maxChars
              return (
                <span key={c.key} className={`px-2 py-0.5 rounded ${over ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                  {c.label} {content.length}/{c.maxChars}
                </span>
              )
            })}
          </div>
        </div>

        {/* 이미지 — 간단 모드에선 썸네일만, 고급 모드에서만 URL 입력 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[12px] font-semibold text-gray-700">이미지</label>
            {!advancedMode && (
              <span className="text-[10.5px] text-gray-400">자동 생성 (페르소나 파이프라인)</span>
            )}
          </div>
          {advancedMode && (
            <div className="flex gap-2 mb-2">
              <input
                value={imageInput}
                onChange={(e) => setImageInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addImage() } }}
                placeholder="https://..."
                className="flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-[13px] text-[#1A1F27] placeholder-gray-400 focus:border-[#00C896] focus:outline-none"
              />
              <button onClick={addImage} className="bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-lg text-[12px] font-semibold text-gray-700 transition">추가</button>
            </div>
          )}
          {imageUrls.length > 0 ? (
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {imageUrls.map((u, i) => (
                <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-gray-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt={`img-${i}`} className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 hover:bg-black/80 text-white text-[10px] font-bold flex items-center justify-center"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            !advancedMode && (
              <div className="text-[11.5px] text-gray-400 py-4 text-center border border-dashed border-gray-300 rounded-lg">
                이미지 없음 · 페르소나 자동 파이프라인이 채워줍니다
              </div>
            )
          )}
        </div>

        <div>
          <label className="text-[12px] font-semibold text-gray-700 mb-2 block">채널</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {CHANNELS.map(c => {
              const on = channels.has(c.key)
              return (
                <button
                  key={c.key}
                  onClick={() => toggleChannel(c.key)}
                  className={`text-left px-3 py-2.5 rounded-lg border transition ${on ? 'border-[#00C896] bg-[#00C896]/10' : 'border-gray-300 bg-white hover:border-gray-400'}`}
                >
                  <div className={`text-[13px] font-bold ${on ? 'text-[#00C896]' : 'text-gray-700'}`}>{c.label}</div>
                  <div className="text-[10.5px] text-gray-500 mt-0.5">{c.note}</div>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label className="text-[12px] font-semibold text-gray-700 mb-2 block">발행 시각</label>
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
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-[13px] text-[#1A1F27] focus:border-[#00C896] focus:outline-none"
            />
          )}
        </div>

        {msg && <div className="text-[12.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">{msg}</div>}

        <button
          onClick={submit}
          disabled={loading}
          className="w-full bg-[#00C896] hover:bg-[#00A87E] disabled:opacity-50 text-white font-bold py-3 rounded-lg transition"
        >
          {loading ? '등록 중...' : '큐에 등록'}
        </button>
      </section>

      <MarketingList posts={posts} onChange={loadPosts} onRemove={remove} />
    </div>
  )
}

function MarketingList({ posts, onChange, onRemove }: { posts: Post[]; onChange: () => Promise<void> | void; onRemove: (id: string) => Promise<void> | void }) {
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [filter, setFilter] = useState<'all' | 'draft' | 'pending' | 'published' | 'failed'>('all')

  async function approve(id: string, scheduleNow: boolean) {
    const sbLocal = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const { data } = await sbLocal.auth.getSession()
    const token = data.session?.access_token
    if (!token) { alert('세션 만료'); return }
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/marketing_posts?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${token}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        status: 'pending',
        scheduled_at: scheduleNow ? new Date().toISOString() : new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    })
    if (!res.ok) { alert('승인 실패'); return }
    await onChange()
  }

  const filtered = posts.filter((p) => filter === 'all' || p.status === filter)
  const counts = {
    all: posts.length,
    draft: posts.filter((p) => p.status === 'draft').length,
    pending: posts.filter((p) => p.status === 'pending').length,
    published: posts.filter((p) => p.status === 'published').length,
    failed: posts.filter((p) => p.status === 'failed' || p.status === 'partial').length,
  }

  return (
    <section>
      <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-gray-600">큐 ({posts.length})</h2>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-0.5 text-[11.5px]">
            <button onClick={() => setView('list')}
              className={`px-3 py-1 rounded-md font-semibold transition ${view === 'list' ? 'bg-white text-[#1A1F27] shadow-sm' : 'text-gray-500'}`}>
              리스트
            </button>
            <button onClick={() => setView('calendar')}
              className={`px-3 py-1 rounded-md font-semibold transition ${view === 'calendar' ? 'bg-white text-[#1A1F27] shadow-sm' : 'text-gray-500'}`}>
              캘린더
            </button>
          </div>
          {view === 'list' && (
            <div className="flex gap-1 text-[11.5px]">
              {(['all', 'draft', 'pending', 'published', 'failed'] as const).map((k) => (
                <button key={k} onClick={() => setFilter(k)}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition ${filter === k ? 'bg-[#00C896] text-white' : 'bg-white border border-gray-200 text-gray-500 hover:text-[#1A1F27]'}`}>
                  {k === 'all' ? '전체' : k === 'draft' ? `draft (${counts.draft})` : k} {filter !== k && counts[k] > 0 ? `(${counts[k]})` : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {view === 'calendar' ? (
        <CalendarView posts={posts} />
      ) : filtered.length === 0 ? (
        <div className="text-[13px] text-gray-400 py-8 text-center border border-dashed border-gray-300 rounded-2xl">
          {filter === 'draft' ? 'draft 없음 — /admin/personas 에서 draft 생성하거나 cron 09:00 대기' : '게시물 없음'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <PostCard key={p.id} p={p} onApprove={approve} onRemove={onRemove} />
          ))}
        </div>
      )}
    </section>
  )
}

function CalendarView({ posts }: { posts: Post[] }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const firstDay = new Date(year, month, 1)
  const startWeekday = firstDay.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  // 날짜별 post 그룹핑 (YYYY-MM-DD key)
  const postsByDate = new Map<string, Post[]>()
  for (const p of posts) {
    const d = new Date(p.scheduled_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const arr = postsByDate.get(key) || []
    arr.push(p)
    postsByDate.set(key, arr)
  }

  function prevMonth() { setCursor(new Date(year, month - 1, 1)); setSelectedDate(null) }
  function nextMonth() { setCursor(new Date(year, month + 1, 1)); setSelectedDate(null) }
  function thisMonth() {
    const d = new Date()
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1))
    setSelectedDate(null)
  }

  const cells: Array<{ day: number; key: string } | null> = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ day: d, key })
  }
  while (cells.length % 7 !== 0) cells.push(null)

  const todayKey = (() => {
    const t = new Date()
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  })()

  const selectedPosts = selectedDate ? (postsByDate.get(selectedDate) || []) : []

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[15px] font-black tracking-tight">
            {year}년 {month + 1}월
          </h3>
          <div className="flex items-center gap-1">
            <button onClick={prevMonth} className="w-7 h-7 rounded-md hover:bg-gray-100 text-gray-600 text-[14px]">‹</button>
            <button onClick={thisMonth} className="px-2 h-7 rounded-md hover:bg-gray-100 text-[11px] text-gray-600 font-semibold">오늘</button>
            <button onClick={nextMonth} className="w-7 h-7 rounded-md hover:bg-gray-100 text-gray-600 text-[14px]">›</button>
          </div>
        </div>
        <div className="grid grid-cols-7 text-[10.5px] font-bold uppercase tracking-wider text-gray-400 mb-1">
          {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
            <div key={d} className={`text-center py-1.5 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : ''}`}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((c, i) => {
            if (!c) return <div key={i} className="aspect-square" />
            const dayPosts = postsByDate.get(c.key) || []
            const isToday = c.key === todayKey
            const isSelected = c.key === selectedDate
            const weekday = i % 7
            return (
              <button
                key={c.key}
                onClick={() => setSelectedDate(isSelected ? null : c.key)}
                className={`aspect-square rounded-lg p-1.5 text-left transition border ${
                  isSelected ? 'border-[#00C896] bg-[#00C896]/5' :
                  isToday ? 'border-[#00C896]/30 bg-[#00C896]/[0.03]' :
                  dayPosts.length > 0 ? 'border-gray-200 hover:border-gray-300 bg-white' :
                  'border-transparent hover:bg-gray-50'
                }`}
              >
                <div className={`text-[11.5px] font-bold ${
                  isToday ? 'text-[#00C896]' :
                  weekday === 0 ? 'text-red-500' :
                  weekday === 6 ? 'text-blue-500' :
                  'text-[#1A1F27]'
                }`}>{c.day}</div>
                {dayPosts.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {dayPosts.slice(0, 2).map((p) => (
                      <div key={p.id} className="text-[9.5px] truncate px-1 py-0.5 rounded leading-tight"
                        style={{
                          backgroundColor:
                            p.status === 'published' ? '#ECFDF5' :
                            p.status === 'pending' ? '#FFFBEB' :
                            p.status === 'draft' ? '#F5F3FF' :
                            p.status === 'failed' || p.status === 'partial' ? '#FEF2F2' :
                            '#F3F4F6',
                          color:
                            p.status === 'published' ? '#047857' :
                            p.status === 'pending' ? '#B45309' :
                            p.status === 'draft' ? '#6D28D9' :
                            p.status === 'failed' || p.status === 'partial' ? '#B91C1C' :
                            '#6B7280',
                        }}
                      >
                        {p.content.slice(0, 12) || '(빈 본문)'}
                      </div>
                    ))}
                    {dayPosts.length > 2 && (
                      <div className="text-[9.5px] text-gray-500 px-1">+{dayPosts.length - 2}</div>
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {selectedDate && (
        <div className="rounded-2xl bg-white border border-gray-200 p-4 space-y-2">
          <div className="text-[12px] font-bold text-gray-600 mb-2">
            {selectedDate} · {selectedPosts.length}건
          </div>
          {selectedPosts.length === 0 ? (
            <div className="text-[12px] text-gray-400 py-4 text-center">예약된 글 없음</div>
          ) : (
            selectedPosts.map((p) => (
              <div key={p.id} className="flex gap-3 border-t border-gray-100 pt-2 first:border-t-0 first:pt-0">
                <div className="w-14 h-14 rounded-lg bg-gray-100 border border-gray-200 overflow-hidden shrink-0">
                  {p.image_urls && p.image_urls.length > 0 ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_urls[0]} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[9px] text-gray-400">
                      텍스트
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {statusBadge(p.status)}
                    <span className="text-[11px] text-gray-500">
                      {new Date(p.scheduled_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="text-[12px] text-gray-700 line-clamp-2">{p.content}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function PostCard({ p, onApprove, onRemove }: {
  p: Post
  onApprove: (id: string, now: boolean) => Promise<void>
  onRemove: (id: string) => Promise<void> | void
}) {
  return (
    <div className="rounded-xl bg-white border border-gray-200 p-4 flex gap-4">
      {/* 이미지 썸네일 */}
      <div className="w-20 h-20 rounded-lg bg-gray-100 border border-gray-200 overflow-hidden shrink-0">
        {p.image_urls && p.image_urls.length > 0 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image_urls[0]} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400 text-center">
            텍스트<br/>only
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            {statusBadge(p.status)}
            {p.topic_pillar && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">
                {p.topic_pillar}
              </span>
            )}
            <span className="text-[11px] text-gray-400">{new Date(p.created_at).toLocaleString('ko-KR')}</span>
          </div>
          <div className="flex gap-2 shrink-0">
            {p.status === 'draft' && (
              <>
                <button onClick={() => onApprove(p.id, true)}
                  className="text-[11px] bg-[#00C896] hover:bg-[#00A87E] text-white font-bold px-3 py-1 rounded-md transition">
                  지금 발행
                </button>
                <button onClick={() => onApprove(p.id, false)}
                  className="text-[11px] bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold px-3 py-1 rounded-md transition">
                  1시간 후
                </button>
              </>
            )}
            {(p.status === 'draft' || p.status === 'pending' || p.status === 'failed' || p.status === 'cancelled') && (
              <button onClick={() => onRemove(p.id)} className="text-[11px] text-red-600 hover:text-red-700">삭제</button>
            )}
          </div>
        </div>

        <div className="text-[13px] text-gray-700 whitespace-pre-wrap leading-relaxed mb-2 line-clamp-3">{p.content}</div>

        <div className="flex flex-wrap gap-1.5 mb-2">
          {p.channels.map((ch) => {
            const result = p.results?.[ch]
            const okSym = !result ? '' : result.ok ? '✓' : '✕'
            const tone = !result ? 'text-gray-600 bg-gray-100' : result.ok ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'
            return (
              <span key={ch} className={`text-[10.5px] font-semibold px-2 py-0.5 rounded ${tone}`}>{ch} {okSym}</span>
            )
          })}
        </div>

        {/* KPI: 클릭 → 가입 attribution */}
        <div className="flex flex-wrap gap-x-3 text-[11px] text-gray-500">
          <span>클릭 <strong className="text-[#1A1F27]">{p.click_count ?? 0}</strong></span>
          <span className={(p.signup_count ?? 0) > 0 ? 'text-[#00C896] font-semibold' : ''}>
            가입 <strong>{p.signup_count ?? 0}</strong>
          </span>
          {p.short_code && (
            <span className="font-mono text-gray-400">ssobi.ai/s/{p.short_code}</span>
          )}
        </div>

        {p.error && <div className="text-[10.5px] text-red-700 mt-2 font-mono">{p.error}</div>}
      </div>
    </div>
  )
}
