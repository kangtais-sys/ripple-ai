'use client'

import { useState } from 'react'

type Block = {
  type: string
  id?: string
  title?: string
  sub?: string
  text?: string
  url?: string
  code?: string
  img?: string
  bg?: string
  bgSolid?: string
  bgColor?: string
  textColor?: string
  seeAll?: string
  items?: Array<Record<string, unknown>>
  theme?: string
  // ...그 외 블록별 필드
}

type PageData = {
  id: string
  handle: string
  hero: {
    slides?: Array<{
      title?: string
      sub?: string
      bg?: string
      cta?: string
      ctaUrl?: string
      brand?: string
      eyebrow?: string
    }>
  }
  theme: {
    bg?: string
    color?: string
    titleFont?: string
    bodyFont?: string
  }
  settings: Record<string, unknown>
  blocks: Block[]
}

export default function LinkPageClient({ page }: { page: PageData }) {
  const [proposing, setProposing] = useState(false)

  const bg = page.theme?.bg || 'linear-gradient(160deg,#FEF3F2 0%,#FCE7E4 50%,#F5DEDA 100%)'
  const color = page.theme?.color || '#1F1317'
  const slides = page.hero?.slides || []
  const firstSlide = slides[0] || { title: `@${page.handle}`, sub: 'Ssobi에서 만든 링크 페이지' }

  async function submitProposal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    try {
      await fetch('/api/link/proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: page.handle,
          from_name: fd.get('name'),
          from_email: fd.get('contact'),
          kind: fd.get('type'),
          message: fd.get('msg'),
        }),
      })
      alert('제안이 전달됐어요!')
      setProposing(false)
    } catch {
      alert('전송 실패. 잠시 후 다시 시도해주세요.')
    }
  }

  return (
    <div style={{ background: bg, minHeight: '100vh', padding: '28px 20px 60px', color, fontFamily: "'Pretendard Variable','Pretendard',sans-serif" }}>
      <div style={{ maxWidth: 440, margin: '0 auto' }}>
        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          {firstSlide.eyebrow && (
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.2em', opacity: 0.6, marginBottom: 6 }}>{firstSlide.eyebrow}</div>
          )}
          <h1 style={{ fontSize: 30, fontWeight: 900, letterSpacing: '-.6px', margin: 0 }}>@{page.handle}</h1>
          {firstSlide.sub && <div style={{ fontSize: 13, opacity: 0.7, marginTop: 8, lineHeight: 1.55 }}>{firstSlide.sub}</div>}
          {firstSlide.cta && firstSlide.ctaUrl && (
            <a href={firstSlide.ctaUrl} style={{ display: 'inline-block', marginTop: 14, padding: '10px 18px', background: '#1F1317', color: '#fff', borderRadius: 100, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>{firstSlide.cta}</a>
          )}
        </div>

        {/* Blocks */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {page.blocks?.map((b, i) => renderBlock(b, i))}
        </div>

        {/* Footer */}
        <a href="https://ssobi.ai/?ref=u" style={{ display: 'block', marginTop: 22, padding: 14, background: '#1F1317', color: '#fff', textAlign: 'center', borderRadius: 14, fontSize: 13, fontWeight: 800, textDecoration: 'none', letterSpacing: '-.2px' }}>
          ✨ 나도 1초만에 내 링크 만들기 →
        </a>
        <div style={{ textAlign: 'center', fontSize: 10, opacity: 0.5, fontWeight: 600, marginTop: 14, letterSpacing: '.4px' }}>
          Powered by <a href="https://ssobi.ai" style={{ color: 'inherit', textDecoration: 'none' }}>Ssobi<span style={{ color: '#00C896' }}>.</span></a>
        </div>
      </div>

      {/* Proposal FAB */}
      <button onClick={() => setProposing(true)} aria-label="제안하기"
        style={{ position: 'fixed', bottom: 'calc(20px + env(safe-area-inset-bottom))', right: 20, width: 52, height: 52, borderRadius: 26, background: '#E85D75', color: '#fff', border: 'none', cursor: 'pointer', boxShadow: '0 8px 20px rgba(232,93,117,.36)', fontSize: 22 }}>
        💌
      </button>

      {/* Proposal modal */}
      {proposing && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setProposing(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,.4)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <form onSubmit={submitProposal}
            style={{ background: '#fff', borderRadius: 18, padding: 24, maxWidth: 380, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: 18, fontWeight: 900, margin: 0, letterSpacing: '-.4px' }}>제안 보내기</h2>
            <div style={{ fontSize: 12.5, opacity: 0.65, marginBottom: 16, marginTop: 4 }}>보내신 내용은 @{page.handle} 님께 전달돼요</div>
            <input name="name" required placeholder="이름 또는 브랜드명" style={inp} />
            <input name="contact" placeholder="이메일 / 연락처" style={inp} />
            <select name="type" style={inp} defaultValue="collab">
              <option value="collab">협찬·광고</option>
              <option value="ad">공동구매</option>
              <option value="question">수출·유통</option>
              <option value="other">기타</option>
            </select>
            <textarea name="msg" required rows={4} placeholder="자세한 내용을 적어주세요" style={{ ...inp, resize: 'vertical' }} />
            <button type="submit" style={{ width: '100%', padding: 13, background: '#1F1317', color: '#fff', border: 'none', fontSize: 14, fontWeight: 800, cursor: 'pointer', borderRadius: 10, marginTop: 4 }}>보내기</button>
            <button type="button" onClick={() => setProposing(false)}
              style={{ width: '100%', padding: 11, background: 'none', border: '1px solid rgba(31,19,23,.14)', color: 'rgba(31,19,23,.65)', borderRadius: 10, marginTop: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>취소</button>
          </form>
        </div>
      )}
    </div>
  )
}

const inp: React.CSSProperties = {
  width: '100%', padding: '11px 13px', border: '1px solid rgba(31,19,23,.14)', borderRadius: 8,
  fontSize: 13, marginBottom: 8, fontFamily: 'inherit', outline: 'none', background: '#FAFAF9', color: '#1F1317',
}

function renderBlock(b: Block, i: number) {
  const common: React.CSSProperties = {
    background: 'rgba(255,255,255,.72)', backdropFilter: 'saturate(180%) blur(14px)',
    border: '1px solid rgba(255,255,255,.9)', borderRadius: 14, padding: '16px 18px',
    color: 'inherit', textDecoration: 'none', fontSize: 15, fontWeight: 800, letterSpacing: '-.2px',
    textAlign: 'center', display: 'block', boxShadow: '0 6px 18px rgba(15,19,25,.06)',
  }
  const key = b.id || `b-${i}`
  const href = b.code ? `/s/${b.code}` : (b.url || '#')

  switch (b.type) {
    case 'link':
      return <a key={key} href={href} style={common}>{b.title || '링크'}</a>
    case 'image':
      return (
        <a key={key} href={href} style={{ ...common, height: 160, backgroundImage: b.img ? `url(${b.img})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center', color: '#fff', display: 'flex', alignItems: 'flex-end', padding: 16, textAlign: 'left', position: 'relative', overflow: 'hidden' }}>
          <span style={{ position: 'relative', zIndex: 1, textShadow: '0 2px 8px rgba(0,0,0,.3)' }}>{b.title || '이미지 링크'}</span>
        </a>
      )
    case 'section':
      return <div key={key} style={{ fontSize: 15, fontWeight: 900, padding: '14px 4px 4px', letterSpacing: '-.3px' }}>{b.title || ''}</div>
    case 'divider':
      return <hr key={key} style={{ border: 'none', height: 1, background: 'rgba(15,19,25,.1)', margin: '6px 0' }} />
    case 'spacer':
      return <div key={key} style={{ height: 18 }} />
    case 'event':
      return (
        <a key={key} href={href} style={{ ...common, background: b.bgColor || b.bgSolid || '#E85D75', color: b.textColor || '#fff', fontWeight: 800, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span><strong>{b.text}</strong>&nbsp;{b.sub}</span><span>→</span>
        </a>
      )
    case 'quicklinks':
      return (
        <div key={key} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(b.items as Array<{ label?: string; sub?: string; url?: string; code?: string }> || []).map((it, j) => (
            <a key={j} href={it.code ? `/s/${it.code}` : (it.url || '#')} style={{ ...common, flex: '1 1 45%', padding: '12px 14px', fontSize: 13 }}>{it.label}</a>
          ))}
        </div>
      )
    case 'socials':
      return (
        <div key={key} style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
          {(b.items as Array<{ ch?: string; url?: string }> || []).map((it, j) => (
            <a key={j} href={it.url || '#'} style={{ width: 40, height: 40, borderRadius: 20, background: 'rgba(255,255,255,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', fontSize: 16 }}>
              {it.ch === 'ig' ? '📷' : it.ch === 'tk' ? '🎵' : it.ch === 'yt' ? '▶️' : '🔗'}
            </a>
          ))}
        </div>
      )
    default:
      // 카운트다운·매거진·컨택트·빅배너 등은 간단히 title만
      return (
        <a key={key} href={href} style={common}>{b.title || b.text || '[' + b.type + ']'}</a>
      )
  }
}
