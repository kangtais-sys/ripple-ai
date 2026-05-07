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
  thumbImg?: string
  seeAll?: string
  items?: Array<Record<string, unknown>>
  theme?: string
  eyebrow?: string
  formDesc?: string
  slots?: string
  endsAt?: string
  label?: string
}

type HeroSlide = {
  title?: string
  sub?: string
  bg?: string
  cta?: string
  ctaUrl?: string
  brand?: string
  eyebrow?: string
  stat1n?: string
  stat1l?: string
  stat2n?: string
  stat2l?: string
  stat1_hidden?: boolean
  stat2_hidden?: boolean
  cta_hidden?: boolean
  main_align?: 'left' | 'center' | 'right'
  eyebrow_align?: 'left' | 'center' | 'right'
}

type PageData = {
  id: string
  handle: string
  hero: {
    compact?: boolean
    slides?: HeroSlide[]
  }
  theme: {
    bg?: string
    bgSolid?: string
    color?: string
    textColor?: string
    titleColor?: string
    titleFont?: string
    bodyFont?: string
  }
  settings: Record<string, unknown>
  blocks: Block[]
}

// 안전한 inline HTML — 에디터에서 만든 <em>, <br> 만 허용 (XSS 차단)
//   다른 모든 태그 (특히 <script>) 는 escape 됨
function safeHtml(s: string | undefined): { __html: string } {
  if (!s) return { __html: '' }
  // 1) 모든 < > 를 escape
  let out = String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // 2) em·br 만 다시 실제 태그로 복구 (대소문자 구분 X)
  out = out
    .replace(/&lt;em&gt;/gi, '<em>')
    .replace(/&lt;\/em&gt;/gi, '</em>')
    .replace(/&lt;br\s*\/?&gt;/gi, '<br/>')
  return { __html: out }
}

export default function LinkPageClient({ page }: { page: PageData }) {
  const [proposing, setProposing] = useState(false)

  const bg = page.theme?.bgSolid || page.theme?.bg || 'linear-gradient(160deg,#FAFAF9 0%,#F5F5F4 100%)'
  const color = page.theme?.textColor || page.theme?.color || '#1F1317'
  const titleColor = page.theme?.titleColor || color
  const titleFont = page.theme?.titleFont || 'Pretendard'
  const slides = page.hero?.slides || []
  const firstSlide = slides[0] || ({ title: `@${page.handle}`, sub: 'Ssobi에서 만든 링크 페이지' } as HeroSlide)
  const isHeroCompact = !!page.hero?.compact

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
    <div style={{ background: bg, minHeight: '100vh', color, fontFamily: `'${titleFont}','Pretendard Variable','Pretendard',sans-serif` }}>
      <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 80 }}>

        {isHeroCompact ? (
          <CompactHero slide={firstSlide} handle={page.handle} titleColor={titleColor} />
        ) : (
          <FullHero slide={firstSlide} handle={page.handle} titleColor={titleColor} />
        )}

        <div style={{ padding: '0 18px' }}>
          {page.blocks?.map((b, i) => renderBlock(b, i))}
        </div>

        <a href="https://ssobi.ai/?ref=u" style={{ display: 'block', margin: '22px 18px 0', padding: 14, background: '#1F1317', color: '#fff', textAlign: 'center', borderRadius: 14, fontSize: 13, fontWeight: 800, textDecoration: 'none', letterSpacing: '-.2px' }}>
          ✨ 나도 1초만에 내 링크 만들기 →
        </a>
        <div style={{ textAlign: 'center', fontSize: 10, opacity: 0.5, fontWeight: 600, marginTop: 14, letterSpacing: '.4px' }}>
          Powered by <a href="https://ssobi.ai" style={{ color: 'inherit', textDecoration: 'none' }}>Ssobi<span style={{ color: '#00C896' }}>.</span></a>
        </div>
      </div>

      <button onClick={() => setProposing(true)} aria-label="제안하기"
        style={{ position: 'fixed', bottom: 'calc(20px + env(safe-area-inset-bottom))', right: 20, width: 52, height: 52, borderRadius: 26, background: '#E85D75', color: '#fff', border: 'none', cursor: 'pointer', boxShadow: '0 8px 20px rgba(232,93,117,.36)', fontSize: 22 }}>
        💌
      </button>

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

function CompactHero({ slide, handle, titleColor }: { slide: HeroSlide; handle: string; titleColor: string }) {
  return (
    <div style={{ padding: '32px 24px 18px', textAlign: 'center' }}>
      {slide.eyebrow && (
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.2em', opacity: 0.55, marginBottom: 8 }}
          dangerouslySetInnerHTML={safeHtml(slide.eyebrow)} />
      )}
      {slide.brand && (
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: '.18em', opacity: 0.45, marginBottom: 6 }}
          dangerouslySetInnerHTML={safeHtml(slide.brand)} />
      )}
      <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.5px', margin: 0, color: titleColor, lineHeight: 1.2 }}
        dangerouslySetInnerHTML={safeHtml(slide.title || `@${handle}`)} />
      {slide.sub && (
        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 8, lineHeight: 1.55 }}
          dangerouslySetInnerHTML={safeHtml(slide.sub)} />
      )}
      {slide.cta && !slide.cta_hidden && (
        <a href={slide.ctaUrl || '#'} style={{ display: 'inline-block', marginTop: 14, padding: '10px 20px', background: '#1F1317', color: '#fff', borderRadius: 100, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}
          dangerouslySetInnerHTML={safeHtml(slide.cta)} />
      )}
    </div>
  )
}

function FullHero({ slide, handle, titleColor }: { slide: HeroSlide; handle: string; titleColor: string }) {
  const hasBg = !!slide.bg
  const align = slide.main_align || 'left'
  return (
    <div style={{
      position: 'relative',
      aspectRatio: '4/5',
      background: hasBg
        ? `linear-gradient(180deg,rgba(0,0,0,.2) 0%,transparent 30%,rgba(0,0,0,.45) 100%), url(${slide.bg}) center/cover`
        : 'linear-gradient(135deg,#1A1F27 0%,#374151 100%)',
      color: '#fff',
      padding: '28px 22px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      overflow: 'hidden',
    }}>
      {!hasBg && (
        <div style={{ position: 'absolute', top: -100, right: -100, width: 380, height: 380, background: 'radial-gradient(circle,rgba(0,200,150,.35),transparent 70%)', pointerEvents: 'none' }} />
      )}
      <div style={{ position: 'relative', zIndex: 2, textAlign: slide.eyebrow_align || 'left' }}>
        {slide.eyebrow && (
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.18em', opacity: 0.85, textTransform: 'uppercase' }}
            dangerouslySetInnerHTML={safeHtml(slide.eyebrow)} />
        )}
      </div>
      <div style={{ position: 'relative', zIndex: 2, textAlign: align }}>
        {slide.brand && (
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: '.18em', opacity: 0.7, marginBottom: 8 }}
            dangerouslySetInnerHTML={safeHtml(slide.brand)} />
        )}
        <h1 style={{ fontFamily: "'Fraunces','Pretendard',serif", fontSize: 42, fontWeight: 400, lineHeight: 1.05, letterSpacing: '-.02em', margin: 0, color: titleColor === '#1F1317' ? '#fff' : titleColor }}
          dangerouslySetInnerHTML={safeHtml(slide.title || `@${handle}`)} />
        {slide.sub && (
          <div style={{ fontSize: 14, opacity: 0.85, marginTop: 12, lineHeight: 1.5, fontStyle: 'italic', fontFamily: "'Fraunces','Pretendard',serif" }}
            dangerouslySetInnerHTML={safeHtml(slide.sub)} />
        )}
      </div>
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
        <div style={{ display: 'flex', gap: 18 }}>
          {!slide.stat1_hidden && slide.stat1n && (
            <div>
              <div style={{ fontFamily: "'Fraunces','Pretendard',serif", fontSize: 20, fontWeight: 500, lineHeight: 1 }}>{slide.stat1n}</div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', opacity: 0.58, marginTop: 3 }}>{slide.stat1l}</div>
            </div>
          )}
          {!slide.stat2_hidden && slide.stat2n && (
            <div>
              <div style={{ fontFamily: "'Fraunces','Pretendard',serif", fontSize: 20, fontWeight: 500, lineHeight: 1 }}>{slide.stat2n}</div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', opacity: 0.58, marginTop: 3 }}>{slide.stat2l}</div>
            </div>
          )}
        </div>
        {slide.cta && !slide.cta_hidden && (
          <a href={slide.ctaUrl || '#'} style={{ background: '#00C896', color: '#fff', padding: '11px 18px', borderRadius: 100, fontSize: 13, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,200,150,.35)' }}
            dangerouslySetInnerHTML={safeHtml(slide.cta)} />
        )}
      </div>
    </div>
  )
}

const inp: React.CSSProperties = {
  width: '100%', padding: '11px 13px', border: '1px solid rgba(31,19,23,.14)', borderRadius: 8,
  fontSize: 13, marginBottom: 8, fontFamily: 'inherit', outline: 'none', background: '#FAFAF9', color: '#1F1317',
}

function renderBlock(b: Block, i: number) {
  const key = b.id || `b-${i}`
  const href = b.code ? `/s/${b.code}` : (b.url || '#')

  const cardBase: React.CSSProperties = {
    display: 'block',
    background: 'rgba(255,255,255,.85)',
    backdropFilter: 'saturate(180%) blur(14px)',
    border: '1px solid rgba(0,0,0,.04)',
    borderRadius: 14,
    padding: '14px 16px',
    color: 'inherit',
    textDecoration: 'none',
    boxShadow: '0 4px 12px rgba(15,19,25,.05)',
    marginBottom: 10,
  }

  switch (b.type) {
    case 'link': {
      let subTxt = b.sub || ''
      if (!subTxt && b.url) {
        try { subTxt = new URL(b.url).hostname.replace(/^www\./, '') } catch { subTxt = b.url.slice(0, 32) }
      }
      return (
        <a key={key} href={href} style={cardBase}>
          <div style={{ fontFamily: "'Fraunces','Pretendard',serif", fontSize: 15, fontWeight: 500 }}
            dangerouslySetInnerHTML={safeHtml(b.title || '링크')} />
          {subTxt && (
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, opacity: 0.55, marginTop: 3 }}>
              {subTxt}
            </div>
          )}
        </a>
      )
    }

    case 'image':
      return (
        <a key={key} href={href} style={{
          ...cardBase,
          padding: 0,
          height: 180,
          backgroundImage: b.thumbImg ? `url(${b.thumbImg})` : (b.img ? `url(${b.img})` : undefined),
          backgroundColor: b.thumbImg || b.img ? undefined : '#1A1F27',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          color: '#fff',
          display: 'flex',
          alignItems: 'flex-end',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,transparent 50%,rgba(0,0,0,.55) 100%)' }} />
          <div style={{ position: 'relative', padding: 16, fontWeight: 800, fontSize: 16, letterSpacing: '-.2px' }}
            dangerouslySetInnerHTML={safeHtml(b.title || '이미지 링크')} />
        </a>
      )

    case 'section':
      return (
        <h2 key={key} style={{
          fontFamily: "'Fraunces','Pretendard',serif",
          fontSize: 28,
          fontWeight: 400,
          letterSpacing: '-.5px',
          margin: '20px 0 10px',
          padding: '0 4px',
          color: 'inherit',
        }}
          dangerouslySetInnerHTML={safeHtml(b.title || '')} />
      )

    case 'event':
      return (
        <a key={key} href={href} style={{
          ...cardBase,
          background: b.bgColor || b.bgSolid || b.bg || '#1A1F27',
          color: b.textColor || '#fff',
          fontWeight: 700,
          fontSize: 13,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 18px',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#00C896', boxShadow: '0 0 10px #00C896' }} />
            <strong style={{ fontWeight: 800 }} dangerouslySetInnerHTML={safeHtml(b.text || '')} />
            <span dangerouslySetInnerHTML={safeHtml(b.sub || '')} />
          </span>
          <span style={{ opacity: 0.7 }}>→</span>
        </a>
      )

    case 'countdown':
      return (
        <div key={key} style={{
          ...cardBase,
          background: b.bgColor || b.bgSolid || b.bg || 'linear-gradient(135deg,#00C896 0%,#00A87E 100%)',
          color: b.textColor || '#fff',
          padding: '20px 18px',
          textAlign: 'center',
        }}>
          {b.eyebrow && (
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.18em', opacity: 0.85, marginBottom: 8 }}
              dangerouslySetInnerHTML={safeHtml(b.eyebrow)} />
          )}
          <div style={{ fontFamily: "'Fraunces','Pretendard',serif", fontSize: 22, fontWeight: 500, marginBottom: 6 }}
            dangerouslySetInnerHTML={safeHtml(b.title || '')} />
          {b.sub && (
            <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 14 }}
              dangerouslySetInnerHTML={safeHtml(b.sub)} />
          )}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 10 }}>
            {[['03', 'HOURS'], ['42', 'MIN'], ['18', 'SEC']].map(([n, l]) => (
              <div key={l} style={{ background: 'rgba(255,255,255,.18)', borderRadius: 10, padding: '8px 14px', minWidth: 56 }}>
                <div style={{ fontFamily: "'Fraunces','Pretendard',serif", fontSize: 24, fontWeight: 500, lineHeight: 1 }}>{n}</div>
                <div style={{ fontSize: 9, opacity: 0.8, marginTop: 4, letterSpacing: '.1em' }}>{l}</div>
              </div>
            ))}
          </div>
          {b.slots && (
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>남은 자리 {b.slots}</div>
          )}
        </div>
      )

    case 'grid': {
      const items = (b.items as Array<{ kind?: string; title?: string; sub?: string; price?: string; origPrice?: string; date?: string; img?: string; thumbImg?: string; tag?: string; tagStyle?: string; url?: string; code?: string }>) || []
      const imgBgMap: Record<string, string> = {
        cream: 'linear-gradient(135deg,#F5EDD8,#D4B896)',
        coral: 'linear-gradient(135deg,#A7F3D0,#00C896)',
        pink: 'linear-gradient(135deg,#FFE8DC,#FFB098)',
        dark: 'linear-gradient(135deg,#374151,#1A1F27)',
      }
      return (
        <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          {items.map((it, ci) => {
            const cardHref = it.code ? `/s/${it.code}` : (it.url || '#')
            const thumbBg = it.thumbImg ? `url(${it.thumbImg}) center/cover` : (imgBgMap[it.img || 'cream'] || imgBgMap.cream)
            const isProduct = it.kind === 'product' || !it.kind
            const tagBgMap: Record<string, string> = { hot: '#FF4D4D', dark: '#1A1F27', '': '#fff' }
            const tagFgMap: Record<string, string> = { hot: '#fff', dark: '#fff', '': '#1A1F27' }
            return (
              <a key={ci} href={cardHref} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
                <div style={{ position: 'relative', height: 160, borderRadius: 12, background: thumbBg, marginBottom: 8, overflow: 'hidden' }}>
                  {it.tag && (
                    <span style={{
                      position: 'absolute', top: 10, left: 10,
                      background: tagBgMap[it.tagStyle || ''] ?? '#fff',
                      color: tagFgMap[it.tagStyle || ''] ?? '#1A1F27',
                      fontSize: 10, fontWeight: 800, padding: '4px 8px', borderRadius: 100,
                      letterSpacing: '.08em',
                    }}>{it.tag}</span>
                  )}
                </div>
                {it.date && <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, opacity: 0.55, marginBottom: 3 }}>{it.date}</div>}
                <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.35, marginBottom: 4 }}
                  dangerouslySetInnerHTML={safeHtml(it.title || '')} />
                {isProduct && it.price && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 800, fontSize: 13 }}>{it.price}</span>
                    {it.origPrice && (
                      <span style={{ fontSize: 11, opacity: 0.5, textDecoration: 'line-through' }}>{it.origPrice}</span>
                    )}
                  </div>
                )}
              </a>
            )
          })}
        </div>
      )
    }

    case 'magazine':
      return (
        <a key={key} href={href} style={{
          ...cardBase,
          padding: 0,
          height: 200,
          backgroundImage: b.thumbImg ? `url(${b.thumbImg})` : (b.img ? `url(${b.img})` : undefined),
          backgroundColor: !b.thumbImg && !b.img ? '#FFE8DC' : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          color: b.textColor || '#fff',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {(b.thumbImg || b.img) && (
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,transparent 30%,rgba(0,0,0,.55) 100%)' }} />
          )}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 18, color: 'inherit' }}>
            {b.label && (
              <div style={{ display: 'inline-block', padding: '3px 9px', background: 'rgba(255,255,255,.85)', borderRadius: 100, fontSize: 9.5, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8, color: '#1A1F27' }}>
                {b.label}
              </div>
            )}
            <div style={{
              fontFamily: "'Fraunces','Pretendard',serif",
              fontSize: 22,
              fontWeight: 400,
              lineHeight: 1.2,
              letterSpacing: '-.3px',
              color: (b.thumbImg || b.img) ? '#fff' : '#1A1F27',
            }}
              dangerouslySetInnerHTML={safeHtml(b.title || '')} />
          </div>
        </a>
      )

    case 'contact':
    case 'bigbanner':
      return (
        <a key={key} href={href} style={{
          ...cardBase,
          background: b.thumbImg ? `url(${b.thumbImg}) center/cover` : (b.bg || b.bgSolid || '#1A1F27'),
          color: b.textColor || '#fff',
          padding: '24px 20px',
          minHeight: 140,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          position: 'relative',
        }}>
          <div style={{ position: 'absolute', top: 16, right: 18, fontSize: 22, opacity: 0.7 }}>↗</div>
          <div>
            {b.eyebrow && (
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '.18em', opacity: 0.7, marginBottom: 8 }}
                dangerouslySetInnerHTML={safeHtml(b.eyebrow)} />
            )}
            <div style={{ fontFamily: "'Fraunces','Pretendard',serif", fontSize: 28, fontWeight: 400, lineHeight: 1.15, letterSpacing: '-.4px' }}
              dangerouslySetInnerHTML={safeHtml(b.title || '')} />
          </div>
        </a>
      )

    case 'quicklinks': {
      const items = (b.items as Array<{ label?: string; sub?: string; url?: string; code?: string }>) || []
      return (
        <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          {items.map((it, j) => (
            <a key={j} href={it.code ? `/s/${it.code}` : (it.url || '#')} style={{
              ...cardBase,
              marginBottom: 0,
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              minHeight: 60,
              gap: 4,
            }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.3 }}
                dangerouslySetInnerHTML={safeHtml(it.label || '')} />
              {it.sub && (
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, opacity: 0.55 }}>{it.sub}</span>
              )}
            </a>
          ))}
        </div>
      )
    }

    case 'socials': {
      const items = (b.items as Array<{ ch?: string; url?: string }>) || []
      const chBgMap: Record<string, string> = {
        ig: 'linear-gradient(135deg,#FEDA75,#D62976,#4F5BD5)',
        tk: '#000',
        yt: '#FF0000',
        email: '#3B82F6',
      }
      const chIconMap: Record<string, string> = { ig: '📷', tk: '🎵', yt: '▶', email: '@' }
      return (
        <div key={key} style={{ display: 'flex', justifyContent: 'center', gap: 12, padding: '16px 0', marginBottom: 10 }}>
          {items.map((it, j) => (
            <a key={j} href={it.url || '#'} style={{
              width: 44, height: 44, borderRadius: 22,
              background: chBgMap[it.ch || ''] || '#1A1F27',
              color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              textDecoration: 'none', fontSize: 18, fontWeight: 800,
            }}>
              {chIconMap[it.ch || ''] || '🔗'}
            </a>
          ))}
        </div>
      )
    }

    case 'divider':
      return <hr key={key} style={{ border: 'none', height: 1, background: 'rgba(15,19,25,.1)', margin: '14px 4px' }} />

    case 'spacer':
      return <div key={key} style={{ height: 24 }} />

    case 'footer':
      return null

    default:
      return (
        <a key={key} href={href} style={cardBase}>
          <div dangerouslySetInnerHTML={safeHtml(b.title || b.text || '')} />
        </a>
      )
  }
}
