'use client'

import { useState, useEffect } from 'react'

interface LearnedStyle {
  tone: string
  sentence_ending: string[]
  emoji_style: string
  length: string
  characteristics: string[]
  example_reply: string
}

export default function TonePage() {
  const [samples, setSamples] = useState<string[]>(['', '', '', '', ''])
  const [style, setStyle] = useState<LearnedStyle | null>(null)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/tone/learn')
      .then(r => r.json())
      .then(data => {
        if (data.sample_texts?.length) setSamples(data.sample_texts)
        if (data.learned_style) setStyle(data.learned_style)
      })
  }, [])

  async function handleLearn() {
    const filled = samples.filter(s => s.trim())
    if (filled.length < 3) return alert('최소 3개의 샘플을 입력해주세요')

    setLoading(true)
    setSaved(false)
    const res = await fetch('/api/tone/learn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ samples: filled }),
    })
    const data = await res.json()
    if (data.style) {
      setStyle(data.style)
      setSaved(true)
    }
    setLoading(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#1A1F27]">AI 말투 학습</h1>
        <p className="text-sm text-gray-500 mt-1">평소 댓글/답글 스타일을 알려주면 AI가 학습합니다</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
        <p className="text-sm font-semibold text-[#1A1F27]">내가 실제로 쓴 댓글/답글 샘플 (최소 3개)</p>
        <p className="text-xs text-gray-400">평소 SNS에서 팔로워에게 답글 다는 스타일로 입력해주세요</p>

        {samples.map((s, i) => (
          <div key={i} className="flex gap-2 items-start">
            <span className="text-xs text-gray-400 mt-2.5 w-4 flex-shrink-0">{i + 1}</span>
            <textarea
              value={s}
              onChange={e => {
                const next = [...samples]
                next[i] = e.target.value
                setSamples(next)
              }}
              rows={2}
              className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#00C896] focus:border-transparent"
              placeholder={
                i === 0 ? '예: 감사해요~ 저도 이 제품 진짜 좋아해요 ㅎㅎ' :
                i === 1 ? '예: 오 맞아요! 프로필 링크에서 확인해보세요 🫶' :
                i === 2 ? '예: 너무 예쁘게 찍어주셨네요 감사합니다 💕' :
                '추가 샘플 (선택)'
              }
            />
          </div>
        ))}

        <button
          onClick={() => setSamples([...samples, ''])}
          className="text-xs text-[#00C896] font-medium hover:underline"
        >
          + 샘플 추가
        </button>

        <button
          onClick={handleLearn}
          disabled={loading}
          className="w-full py-2.5 rounded-lg bg-[#00C896] text-white font-semibold text-sm hover:bg-[#00B386] transition disabled:opacity-50"
        >
          {loading ? 'AI 분석 중...' : '말투 학습시키기'}
        </button>
      </div>

      {saved && (
        <div className="bg-[#00C896]/5 border border-[#00C896]/20 rounded-xl p-4 text-sm text-[#00C896] font-medium">
          말투 학습이 완료되었습니다! 앞으로 자동 응대에 반영됩니다.
        </div>
      )}

      {style && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
          <p className="text-sm font-semibold text-[#1A1F27]">학습된 말투 프로필</p>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">어조</p>
              <p className="font-medium text-[#1A1F27]">{style.tone}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">답글 길이</p>
              <p className="font-medium text-[#1A1F27]">{style.length}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">이모지 스타일</p>
              <p className="font-medium text-[#1A1F27]">{style.emoji_style}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">종결어미</p>
              <p className="font-medium text-[#1A1F27]">{Array.isArray(style.sentence_ending) ? style.sentence_ending.join(', ') : style.sentence_ending}</p>
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">특징</p>
            <ul className="text-sm text-[#1A1F27] space-y-1">
              {style.characteristics?.map((c, i) => (
                <li key={i}>- {c}</li>
              ))}
            </ul>
          </div>

          <div className="bg-[#00C896]/5 rounded-lg p-3">
            <p className="text-xs text-[#00C896] mb-1">예시 답글</p>
            <p className="text-sm text-[#1A1F27]">&ldquo;{style.example_reply}&rdquo;</p>
          </div>
        </div>
      )}
    </div>
  )
}
