'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface PersonaDetail {
  id: string
  name: string
  language: string
  languages: string[] | null
  bio: string | null
  voice_description: string
  reference_account_url: string | null
  channels: string[]
  topic_pillars: Array<{ name: string; weight: number }>
  daily_draft_count: number
  active: boolean
}

interface Sample {
  id: string
  content: string
  source_channel: string | null
  notes: string | null
}

interface Asset {
  id: string
  type: string
  url: string
  generation_status: string
  generation_error: string | null
  scene_prompt: string | null
  tags: string[]
  created_at: string
}

interface Account {
  id: string
  platform: string
  language: string
  username: string | null
  display_name: string | null
  active: boolean
  created_at: string
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await sb.auth.getSession()
  const t = data.session?.access_token
  return t ? { Authorization: `Bearer ${t}` } : {}
}

const PLATFORM_OPTS = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'threads', label: 'Threads' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'x', label: 'X' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'youtube', label: 'YouTube' },
]

export default function PersonaDetailClient({ personaId }: { personaId: string }) {
  const [persona, setPersona] = useState<PersonaDetail | null>(null)
  const [samples, setSamples] = useState<Sample[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const h = await authHeaders()
      const [p, a, ac] = await Promise.all([
        fetch(`/api/admin/personas/${personaId}`, { headers: h }),
        fetch(`/api/admin/assets?persona_id=${personaId}`, { headers: h }),
        fetch(`/api/admin/personas/${personaId}/accounts`, { headers: h }).catch(() => null),
      ])
      if (p.ok) {
        const j = await p.json()
        setPersona(j.persona)
        setSamples(j.samples || [])
      }
      if (a.ok) {
        const j = await a.json()
        setAssets(j.assets || [])
      }
      if (ac && ac.ok) {
        const j = await ac.json()
        setAccounts(j.accounts || [])
      }
    } finally {
      setLoading(false)
    }
  }, [personaId])

  useEffect(() => { load() }, [load])

  if (loading || !persona) {
    return <div className="py-16 text-center text-gray-500 text-[13px]">로딩 중...</div>
  }

  const anchorCandidates = assets.filter((a) => a.tags?.includes('anchor_candidate') && !a.tags.includes('anchor_rejected'))
  const anchorActive = assets.find((a) => a.tags?.includes('anchor_active'))

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <a href="/admin/personas" className="text-[12px] text-gray-500 hover:text-[#1A1F27]">← 페르소나 목록</a>
          <h1 className="text-2xl font-black tracking-tight mt-1">
            {persona.name} <span className="text-[12px] font-normal text-gray-500">{(persona.languages || []).join(' · ')}</span>
          </h1>
        </div>
      </div>

      {msg && <div className="text-[12.5px] text-emerald-700 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-2">{msg}</div>}

      {/* Section 1: Persona overview */}
      <PersonaOverview persona={persona} onSaved={(p) => { setPersona(p); setMsg('저장됨') }} />

      {/* Section 2: 캐릭터 anchor */}
      <CharacterAnchor
        personaId={personaId}
        candidates={anchorCandidates}
        active={anchorActive}
        onChange={load}
      />

      {/* Section 3: 샘플 */}
      <SamplesSection
        personaId={personaId}
        samples={samples}
        onChange={load}
      />

      {/* Section 4: 계정 연동 */}
      <AccountsSection
        personaId={personaId}
        accounts={accounts}
        onChange={load}
      />
    </div>
  )
}

// ============ 1. 페르소나 개요 (편집) ============
function PersonaOverview({ persona, onSaved }: { persona: PersonaDetail; onSaved: (p: PersonaDetail) => void }) {
  const [editing, setEditing] = useState(false)
  const [bio, setBio] = useState(persona.bio || '')
  const [voice, setVoice] = useState(persona.voice_description)
  const [pillars, setPillars] = useState(JSON.stringify(persona.topic_pillars, null, 2))
  const [dailyCount, setDailyCount] = useState(persona.daily_draft_count)

  async function save() {
    let parsed
    try { parsed = JSON.parse(pillars) } catch { alert('토픽 기둥 JSON 형식 오류'); return }
    const h = await authHeaders()
    const res = await fetch(`/api/admin/personas/${persona.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({
        bio, voice_description: voice, topic_pillars: parsed, daily_draft_count: dailyCount,
      }),
    })
    if (res.ok) {
      onSaved({ ...persona, bio, voice_description: voice, topic_pillars: parsed, daily_draft_count: dailyCount })
      setEditing(false)
    }
  }

  if (!editing) {
    return (
      <section className="rounded-2xl bg-white border border-gray-200 p-6">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-gray-700">페르소나 개요</h2>
          <button onClick={() => setEditing(true)} className="text-[11px] text-[#00C896] hover:underline">편집</button>
        </div>
        <dl className="space-y-3 text-[13px]">
          <div><dt className="text-gray-500 text-[11px] uppercase tracking-wider mb-1">Bio</dt><dd className="text-gray-800">{persona.bio || '(미설정)'}</dd></div>
          <div><dt className="text-gray-500 text-[11px] uppercase tracking-wider mb-1">Voice</dt><dd className="text-gray-800 whitespace-pre-wrap">{persona.voice_description}</dd></div>
          <div><dt className="text-gray-500 text-[11px] uppercase tracking-wider mb-1">토픽 기둥</dt><dd className="text-gray-800">
            {persona.topic_pillars.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]"><span className="font-semibold">{p.name}</span><span className="text-gray-500">{p.weight}%</span></div>
            ))}
          </dd></div>
          <div><dt className="text-gray-500 text-[11px] uppercase tracking-wider mb-1">매일 draft</dt><dd className="text-gray-800">{persona.daily_draft_count}개</dd></div>
        </dl>
      </section>
    )
  }

  return (
    <section className="rounded-2xl bg-white border border-gray-200 p-6 space-y-3">
      <h2 className="text-[13px] font-bold uppercase tracking-wider text-gray-700">페르소나 편집</h2>
      <Field label="Bio">
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} className={inputCls} />
      </Field>
      <Field label="Voice 묘사">
        <textarea value={voice} onChange={(e) => setVoice(e.target.value)} rows={5} className={inputCls} />
      </Field>
      <Field label="토픽 기둥 (JSON)">
        <textarea value={pillars} onChange={(e) => setPillars(e.target.value)} rows={6} className={inputCls + ' font-mono text-[11.5px]'} />
      </Field>
      <Field label={`매일 draft 개수: ${dailyCount}`}>
        <input type="range" min="1" max="10" value={dailyCount} onChange={(e) => setDailyCount(Number(e.target.value))} className="w-full" />
      </Field>
      <div className="flex gap-2">
        <button onClick={save} className="bg-[#00C896] hover:bg-[#00A87E] text-white font-bold px-4 py-2 rounded-lg text-[13px]">저장</button>
        <button onClick={() => setEditing(false)} className="bg-gray-100 hover:bg-gray-200 text-white px-4 py-2 rounded-lg text-[13px]">취소</button>
      </div>
    </section>
  )
}

// ============ 2. 캐릭터 Anchor ============
function CharacterAnchor({ personaId, candidates, active, onChange }: { personaId: string; candidates: Asset[]; active: Asset | undefined; onChange: () => void }) {
  const [generating, setGenerating] = useState(false)
  const [pollUntil, setPollUntil] = useState<number | null>(null)

  // 폴링: queued/processing 자산 있는 동안
  useEffect(() => {
    if (!pollUntil) return
    const allDone = candidates.every((c) => c.generation_status === 'completed' || c.generation_status === 'failed')
    if (allDone || Date.now() > pollUntil) {
      setPollUntil(null)
      return
    }
    const t = setTimeout(() => { onChange() }, 5000)
    return () => clearTimeout(t)
  }, [candidates, pollUntil, onChange])

  async function generate() {
    if (candidates.length > 0 && !confirm('기존 후보 있음. 새로 4장 더 생성?')) return
    setGenerating(true)
    try {
      const h = await authHeaders()
      const res = await fetch(`/api/admin/personas/${personaId}/generate-anchor`, {
        method: 'POST', headers: h,
      })
      const j = await res.json()
      if (!res.ok) { alert(`실패: ${j.error}`); return }
      onChange()
      setPollUntil(Date.now() + 6 * 60 * 1000) // 6분 폴링
    } finally {
      setGenerating(false)
    }
  }

  async function select(assetId: string) {
    const h = await authHeaders()
    await fetch(`/api/admin/personas/${personaId}/select-anchor`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ asset_id: assetId }),
    })
    onChange()
  }

  return (
    <section className="rounded-2xl bg-white border border-gray-200 p-6 space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-gray-700">캐릭터 Anchor</h2>
          <p className="text-[11.5px] text-gray-500 mt-1">Higgsfield 로 페르소나 얼굴 4장 후보 생성 → 1장 선택. 이후 모든 콘텐츠가 이 얼굴 유지.</p>
        </div>
        <button onClick={generate} disabled={generating}
          className="bg-[#00C896] hover:bg-[#00A87E] disabled:opacity-50 text-white font-bold px-4 py-2 rounded-lg text-[12px]">
          {generating ? '제출 중...' : '+ 후보 4장 생성'}
        </button>
      </div>

      {active && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={active.url} alt="anchor" className="w-24 h-24 rounded-lg object-cover" />
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 mb-1">현재 활성 Anchor</div>
            <div className="text-[12px] text-gray-700">이 얼굴이 모든 생성 콘텐츠의 기준</div>
          </div>
        </div>
      )}

      {candidates.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {candidates.map((c) => (
            <div key={c.id} className={`rounded-xl border p-2 ${c.tags?.includes('anchor_active') ? 'border-emerald-500' : 'border-gray-300'}`}>
              {c.generation_status === 'completed' ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.url} alt={c.id} className="w-full aspect-square object-cover rounded-lg mb-2" />
                  {c.tags?.includes('anchor_active') ? (
                    <div className="text-center text-[11px] font-bold text-emerald-700">✓ 활성</div>
                  ) : (
                    <button onClick={() => select(c.id)}
                      className="w-full bg-white/10 hover:bg-[#00C896] hover:text-white text-gray-800 text-[11px] font-semibold py-1.5 rounded transition">
                      이거 선택
                    </button>
                  )}
                </>
              ) : c.generation_status === 'failed' ? (
                <div className="aspect-square flex items-center justify-center text-[10.5px] text-red-300 text-center">
                  실패<br />{(c.generation_error || '').slice(0, 50)}
                </div>
              ) : (
                <div className="aspect-square flex items-center justify-center text-[11px] text-gray-500 animate-pulse">
                  생성 중...<br />({c.generation_status})
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {candidates.length === 0 && !generating && (
        <div className="text-[12.5px] text-gray-500 py-6 text-center border border-dashed border-gray-300 rounded-xl">
          아직 anchor 없음. 위 버튼 클릭 → 30s~5min 후 4장 완성.
        </div>
      )}
    </section>
  )
}

// ============ 3. 샘플 ============
function SamplesSection({ personaId, samples, onChange }: { personaId: string; samples: Sample[]; onChange: () => void }) {
  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState('')

  async function addSamples() {
    if (!pasteText.trim()) return
    // 빈 줄로 split → 각각 sample
    const items = pasteText
      .split(/\n\s*\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (items.length === 0) return

    const h = await authHeaders()
    await fetch(`/api/admin/personas/${personaId}/samples`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ samples: items.map((content) => ({ content })) }),
    })
    setPasteText('')
    setPasting(false)
    onChange()
  }

  async function remove(sampleId: string) {
    if (!confirm('이 샘플 삭제?')) return
    const h = await authHeaders()
    await fetch(`/api/admin/personas/${personaId}/samples?sample_id=${sampleId}`, {
      method: 'DELETE', headers: h,
    })
    onChange()
  }

  return (
    <section className="rounded-2xl bg-white border border-gray-200 p-6 space-y-3">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-gray-700">샘플 ({samples.length})</h2>
          <p className="text-[11.5px] text-gray-500 mt-1">참고 인플루언서 포스트. Claude 가 톤 학습. 빈 줄로 구분된 여러 개 한 번에 paste.</p>
        </div>
        <button onClick={() => setPasting(!pasting)} className="bg-gray-100 hover:bg-gray-200 text-white px-3 py-1.5 rounded-lg text-[12px]">
          {pasting ? '취소' : '+ 샘플 paste'}
        </button>
      </div>

      {pasting && (
        <div className="space-y-2">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={10}
            placeholder="포스트 1 내용...&#10;&#10;포스트 2 내용...&#10;&#10;(빈 줄로 구분)"
            className={inputCls}
          />
          <button onClick={addSamples} className="bg-[#00C896] hover:bg-[#00A87E] text-white font-bold px-4 py-2 rounded-lg text-[13px]">
            저장 ({pasteText.split(/\n\s*\n+/).filter(s => s.trim()).length}개)
          </button>
        </div>
      )}

      {samples.length > 0 && (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {samples.map((s) => (
            <div key={s.id} className="rounded-lg bg-black/20 p-3 text-[12px] text-gray-700 whitespace-pre-wrap flex items-start gap-3">
              <span className="flex-1">{s.content}</span>
              <button onClick={() => remove(s.id)} className="text-[11px] text-red-600 hover:text-red-700 shrink-0">✕</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ============ 4. 계정 연동 ============
function AccountsSection({ personaId, accounts, onChange }: { personaId: string; accounts: Account[]; onChange: () => void }) {
  const [profileId, setProfileId] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  async function sync() {
    if (!profileId.trim()) { setSyncMsg('Zernio profile_id 입력'); return }
    setSyncing(true); setSyncMsg(null)
    try {
      const h = await authHeaders()
      const res = await fetch(`/api/admin/personas/${personaId}/zernio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ zernio_profile_id: profileId.trim() }),
      })
      const j = await res.json()
      if (!res.ok) { setSyncMsg(j.error || '실패'); return }
      setSyncMsg(`동기화 완료 · ${(j.synced || []).length}개 계정`)
      onChange()
    } finally { setSyncing(false) }
  }

  return (
    <section className="rounded-2xl bg-white border border-gray-200 p-6 space-y-4">
      <div>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-gray-700">SNS 계정 (Zernio)</h2>
        <p className="text-[11.5px] text-gray-500 mt-1">
          Zernio 대시보드에서 Ssobi profile 만들고 SNS 계정 연동 후, 여기에 profile_id 입력 → 자동 sync.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          value={profileId}
          onChange={(e) => setProfileId(e.target.value)}
          placeholder="Zernio profile_id (24자 hex)"
          className="flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-[12.5px] text-[#1A1F27] placeholder-gray-400 focus:border-[#00C896] focus:outline-none font-mono"
        />
        <button
          onClick={sync}
          disabled={syncing}
          className="bg-[#00C896] hover:bg-[#00A87E] disabled:opacity-50 text-white font-bold px-4 py-2 rounded-lg text-[12.5px]"
        >
          {syncing ? '동기화 중...' : 'Zernio Sync'}
        </button>
      </div>
      {syncMsg && <div className="text-[11.5px] text-amber-700">{syncMsg}</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {PLATFORM_OPTS.map((p) => {
          const connected = accounts.filter((a) => a.platform === p.key && a.active)
          return (
            <div key={p.key} className="rounded-xl bg-gray-50 border border-gray-200 p-3">
              <div className="text-[12.5px] font-bold text-[#1A1F27] mb-1.5">{p.label}</div>
              {connected.length === 0 ? (
                <div className="text-[11px] text-gray-400">미연결</div>
              ) : (
                connected.map((c) => (
                  <div key={c.id} className="text-[11.5px] text-emerald-700">
                    @{c.username || c.display_name || c.id.slice(0,8)}
                  </div>
                ))
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

const inputCls = 'w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-[13px] text-white placeholder-gray-400 focus:border-[#00C896] focus:outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5 block">{label}</label>
      {children}
    </div>
  )
}
