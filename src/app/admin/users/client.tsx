'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface UserRow {
  id: string
  email: string | null
  display_name: string | null
  plan: string
  beta: boolean
  beta_started_at: string | null
  beta_ends_at: string | null
  created_at: string
  last_sign_in_at: string | null
  ig_usernames: string[]
  monthly_comments: number
  monthly_dms: number
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso).getTime()
  const diff = Date.now() - d
  const m = Math.floor(diff / 60000)
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  const days = Math.floor(h / 24)
  if (days < 30) return `${days}일 전`
  return new Date(iso).toLocaleDateString('ko-KR')
}

function PlanBadge({ plan, beta }: { plan: string; beta: boolean }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    free:     { bg: 'bg-gray-100',        fg: 'text-gray-700',   label: 'FREE' },
    basic:    { bg: 'bg-emerald-500/15',  fg: 'text-emerald-300',label: 'STARTER' },
    premium:  { bg: 'bg-violet-500/15',   fg: 'text-violet-300', label: 'PRO' },
    business: { bg: 'bg-amber-500/15',    fg: 'text-amber-300',  label: 'TEAM' },
  }
  const m = map[plan] || map.free
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${m.bg} ${m.fg} uppercase tracking-wider`}>
        {m.label}
      </span>
      {beta && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#00C896]/15 text-[#00C896]">BETA</span>
      )}
    </span>
  )
}

export default function UsersClient() {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'denied'; email: string | null }
    | { kind: 'ok'; users: UserRow[] }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' })
  const [filter, setFilter] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await sb.auth.getSession()
        const token = data.session?.access_token
        if (!token) {
          if (!cancelled) setState({ kind: 'denied', email: null })
          return
        }
        const res = await fetch('/api/admin/users', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const j = await res.json()
        if (!res.ok) {
          if (!cancelled) setState({ kind: 'denied', email: null })
          return
        }
        if (!cancelled) setState({ kind: 'ok', users: j.users || [] })
      } catch (e) {
        if (!cancelled) setState({ kind: 'error', message: String(e) })
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (state.kind === 'loading') return <div className="py-16 text-center text-gray-500 text-[13px]">로딩 중...</div>
  if (state.kind === 'denied') return (
    <div className="py-16 flex items-center justify-center">
      <div className="max-w-md text-center space-y-4">
        <div className="text-2xl font-black tracking-tight">로그인이 필요해요</div>
        <a href="/app?next=%2Fadmin%2Fusers" className="inline-block bg-[#00C896] hover:bg-[#00A87E] text-white font-bold px-6 py-3 rounded-lg transition">로그인하러 가기 →</a>
      </div>
    </div>
  )
  if (state.kind === 'error') return <div className="py-16 text-center text-red-600">{state.message}</div>

  const filteredUsers = state.users.filter((u) => {
    if (!filter.trim()) return true
    const q = filter.toLowerCase()
    return (
      (u.email || '').toLowerCase().includes(q) ||
      (u.display_name || '').toLowerCase().includes(q) ||
      u.ig_usernames.some((ig) => ig.toLowerCase().includes(q))
    )
  })

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight mb-1">가입자</h1>
          <p className="text-[13px] text-gray-500">총 {state.users.length}명 · 검색 시 이메일·이름·IG 핸들 모두 매칭</p>
        </div>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="검색..."
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-[13px] text-white placeholder-gray-400 focus:border-[#00C896] focus:outline-none w-64"
        />
      </div>

      <div className="rounded-2xl bg-white border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left text-[10.5px] font-bold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">이메일</th>
                <th className="px-4 py-3">이름</th>
                <th className="px-4 py-3">플랜</th>
                <th className="px-4 py-3">IG</th>
                <th className="px-4 py-3 text-right">이달 응대</th>
                <th className="px-4 py-3">가입</th>
                <th className="px-4 py-3">마지막 로그인</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-400 text-[13px]">
                    {filter ? '검색 결과 없음' : '가입자 없음'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => (
                  <tr key={u.id} className="border-b border-gray-200 hover:bg-gray-50 transition">
                    <td className="px-4 py-3 text-gray-900 font-mono text-[11.5px]">{u.email || '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{u.display_name || '-'}</td>
                    <td className="px-4 py-3"><PlanBadge plan={u.plan} beta={u.beta} /></td>
                    <td className="px-4 py-3 text-gray-700 text-[11.5px]">
                      {u.ig_usernames.length === 0 ? (
                        <span className="text-gray-400">-</span>
                      ) : (
                        u.ig_usernames.map((ig) => `@${ig}`).join(', ')
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">
                      {(u.monthly_comments + u.monthly_dms).toLocaleString()}
                      <span className="text-gray-400 text-[10.5px] ml-1">
                        ({u.monthly_comments}c·{u.monthly_dms}d)
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-[11.5px]" title={u.created_at}>
                      {fmtRelative(u.created_at)}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-[11.5px]" title={u.last_sign_in_at || ''}>
                      {fmtRelative(u.last_sign_in_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
