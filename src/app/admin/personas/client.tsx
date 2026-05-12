'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface PersonaRow {
  id: string
  name: string
  language: 'ko' | 'en' | 'ja' | 'zh'
  bio: string | null
  voice_description: string
  reference_account_url: string | null
  channels: string[]
  topic_pillars: Array<{ name: string; weight: number }>
  daily_draft_count: number
  active: boolean
  created_at: string
  sample_count: number
  asset_count: number
  draft_count: number
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await sb.auth.getSession()
  const t = data.session?.access_token
  return t ? { Authorization: `Bearer ${t}` } : {}
}

export default function PersonasClient() {
  const [personas, setPersonas] = useState<PersonaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // 신규 페르소나 폼 상태
  const [form, setForm] = useState({
    name: '',
    language: 'ko' as 'ko' | 'en',
    bio: '',
    voice_description: '',
    reference_account_url: '',
    channels: new Set<string>(['threads', 'x']),
    topic_pillars_str: '빌드 인 퍼블릭:40, 인플루언서 팁:25, 제품 데모:15, 도메인 인사이트:10, 커뮤니티:10',
    daily_draft_count: 3,
  })

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const h = await authHeaders()
      const res = await fetch('/api/admin/personas', { headers: h })
      if (!res.ok) { setLoading(false); return }
      const j = await res.json()
      setPersonas(j.personas || [])
    } finally { setLoading(false) }
  }

  function parsePillars(str: string): Array<{ name: string; weight: number }> {
    return str
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((p) => {
        const [name, weight] = p.split(':').map((s) => s.trim())
        return { name: name || 'unknown', weight: parseInt(weight, 10) || 0 }
      })
      .filter((p) => p.name)
  }

  async function submit() {
    if (!form.name.trim()) { setMsg('이름 필수'); return }
    if (!form.voice_description.trim()) { setMsg('voice 묘사 필수'); return }
    const h = await authHeaders()
    const res = await fetch('/api/admin/personas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({
        name: form.name,
        language: form.language,
        bio: form.bio,
        voice_description: form.voice_description,
        reference_account_url: form.reference_account_url,
        channels: Array.from(form.channels),
        topic_pillars: parsePillars(form.topic_pillars_str),
        daily_draft_count: form.daily_draft_count,
      }),
    })
    const j = await res.json()
    if (!res.ok) { setMsg(j.error || '실패'); return }
    setMsg('페르소나 생성됨')
    setShowForm(false)
    setForm({
      name: '', language: 'ko', bio: '', voice_description: '',
      reference_account_url: '', channels: new Set(['threads', 'x']),
      topic_pillars_str: '빌드 인 퍼블릭:40, 인플루언서 팁:25, 제품 데모:15, 도메인 인사이트:10, 커뮤니티:10',
      daily_draft_count: 3,
    })
    await load()
  }

  async function generateDrafts(id: string) {
    if (!confirm('Claude 호출해서 draft 생성? (비용 ~₩40)')) return
    const h = await authHeaders()
    const res = await fetch(`/api/admin/personas/${id}/generate`, { method: 'POST', headers: h })
    const j = await res.json()
    if (!res.ok) { alert(`실패: ${j.error}`); return }
    alert(`draft ${j.inserted}개 생성됨. 마케팅 페이지에서 검수해줘.`)
    await load()
  }

  function toggleChannel(c: string) {
    const n = new Set(form.channels)
    if (n.has(c)) n.delete(c)
    else n.add(c)
    setForm({ ...form, channels: n })
  }

  if (loading) return <div className="py-16 text-center text-white/40">로딩 중...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight mb-1">페르소나</h1>
          <p className="text-[13px] text-white/50">총 {personas.length}명 · Ssobi 마케팅 자동화용 가상 인플루언서</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-[#00C896] hover:bg-[#00A87E] text-white font-bold px-4 py-2 rounded-lg text-[13px] transition"
        >
          {showForm ? '취소' : '+ 새 페르소나'}
        </button>
      </div>

      {msg && <div className="text-[12.5px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-2">{msg}</div>}

      {showForm && (
        <section className="rounded-2xl bg-white/[0.03] border border-white/5 p-6 space-y-4">
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/60">새 페르소나</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="이름">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="예: 미나" className={inputCls} />
            </Field>
            <Field label="언어">
              <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as 'ko' | 'en' })}
                className={inputCls}>
                <option value="ko">한국어</option>
                <option value="en">영어</option>
              </select>
            </Field>
          </div>
          <Field label="자기소개 (bio)">
            <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })}
              rows={2} placeholder="예: 30대 K-뷰티 인플루언서. AI 도구·창업 관심." className={inputCls} />
          </Field>
          <Field label="말투·톤 묘사 (3~5줄)">
            <textarea value={form.voice_description} onChange={(e) => setForm({ ...form, voice_description: e.target.value })}
              rows={4}
              placeholder="예: 솔직함. 자조적 유머. 이모지 절제. 줄바꿈 자주. 빌드 인 퍼블릭 톤으로 숫자·실패 공개."
              className={inputCls} />
          </Field>
          <Field label="참고 인플루언서 URL (메모)">
            <input value={form.reference_account_url} onChange={(e) => setForm({ ...form, reference_account_url: e.target.value })}
              placeholder="https://threads.com/@ai_mst.mirr" className={inputCls} />
          </Field>
          <Field label="활성 채널">
            <div className="grid grid-cols-3 gap-2">
              {['threads', 'x', 'instagram', 'facebook', 'tiktok', 'youtube'].map((c) => {
                const on = form.channels.has(c)
                return (
                  <button key={c} type="button" onClick={() => toggleChannel(c)}
                    className={`px-3 py-2 rounded-lg border transition text-[12.5px] font-semibold ${on ? 'border-[#00C896] bg-[#00C896]/10 text-[#00C896]' : 'border-white/10 bg-black/20 text-white/60'}`}>
                    {c}
                  </button>
                )
              })}
            </div>
          </Field>
          <Field label="토픽 기둥 (이름:가중치, comma 구분)">
            <input value={form.topic_pillars_str} onChange={(e) => setForm({ ...form, topic_pillars_str: e.target.value })}
              className={inputCls} />
          </Field>
          <Field label={`매일 draft 생성 개수: ${form.daily_draft_count}`}>
            <input type="range" min="1" max="10" value={form.daily_draft_count}
              onChange={(e) => setForm({ ...form, daily_draft_count: Number(e.target.value) })}
              className="w-full" />
          </Field>
          <button onClick={submit} className="w-full bg-[#00C896] hover:bg-[#00A87E] text-white font-bold py-3 rounded-lg transition">
            생성
          </button>
        </section>
      )}

      {personas.length === 0 ? (
        <div className="text-[13px] text-white/40 py-12 text-center border border-dashed border-white/10 rounded-2xl">
          페르소나 0명. 위 "+ 새 페르소나" 로 시작.
        </div>
      ) : (
        <div className="space-y-3">
          {personas.map((p) => (
            <a key={p.id} href={`/admin/personas/${p.id}`} className="block rounded-2xl bg-white/[0.03] border border-white/5 p-5 hover:bg-white/[0.05] hover:border-white/10 transition cursor-pointer">
              <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-[15px] font-black tracking-tight">{p.name}</h3>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-white/60 uppercase">{p.language}</span>
                    {!p.active && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-white/40">inactive</span>}
                  </div>
                  {p.bio && <p className="text-[12px] text-white/60 mb-2">{p.bio}</p>}
                  <p className="text-[11.5px] text-white/40 max-w-2xl">{p.voice_description.slice(0, 200)}{p.voice_description.length > 200 ? '...' : ''}</p>
                  {p.reference_account_url && (
                    <a href={p.reference_account_url} target="_blank" rel="noopener" className="text-[11px] text-[#00C896] hover:underline mt-1.5 inline-block">
                      참고: {p.reference_account_url}
                    </a>
                  )}
                </div>
                <span className="text-[11px] text-white/40 shrink-0">설정 →</span>
              </div>
              <div className="flex flex-wrap gap-2 text-[10.5px]">
                {p.channels.map((c) => (
                  <span key={c} className="px-2 py-0.5 rounded bg-white/5 text-white/60 font-mono">{c}</span>
                ))}
              </div>
              <div className="flex gap-5 mt-3 text-[11.5px] text-white/50">
                <span>샘플 {p.sample_count}</span>
                <span>자산 {p.asset_count}</span>
                <span className={p.draft_count > 0 ? 'text-amber-300 font-semibold' : ''}>
                  대기 draft {p.draft_count}
                </span>
                <span>매일 {p.daily_draft_count}개 자동 생성</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

const inputCls = 'w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[13px] text-white placeholder-white/30 focus:border-[#00C896] focus:outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-bold uppercase tracking-wider text-white/50 mb-1.5 block">{label}</label>
      {children}
    </div>
  )
}
