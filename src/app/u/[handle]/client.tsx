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
  logo?: string
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
  hero: { compact?: boolean; slides?: HeroSlide[] }
  theme: { bg?: string; bgSolid?: string; color?: string; textColor?: string; titleColor?: string; titleFont?: string; bodyFont?: string }
  settings: Record<string, unknown>
  blocks: Block[]
}

// XSS-safe HTML — em/br 만 허용
function safeHtml(s: string | undefined): { __html: string } {
  if (!s) return { __html: '' }
  let out = String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  out = out
    .replace(/&lt;em&gt;/gi, '<em>')
    .replace(/&lt;\/em&gt;/gi, '</em>')
    .replace(/&lt;br\s*\/?&gt;/gi, '<br/>')
  return { __html: out }
}

// 에디터와 동일한 CSS 를 SSR 페이지에 inline. `.ssobi-public` 으로 scope.
//   #v-link → .ssobi-public 으로 prefix 변경 + 에디터 전용 (drag/select/hover) 룰 제거
const PUBLIC_CSS = `
:root{--dark:#1A1F27;--mint:#00C896;--mint-l:#F0FDF9;--mint-d:#00A87E;--red:#FF4D4D;--bg:#F9FAFB;--b:#F0F2F5;--t1:#1A1F27;--t2:#64748B;--t3:#94A3B8}
@keyframes lke-pulse{0%,100%{opacity:1}50%{opacity:.4}}
.ssobi-public{font-family:'Pretendard Variable','Pretendard',sans-serif;color:var(--t1);width:100%;max-width:480px;margin:0 auto;min-height:100vh;background:var(--bg);overflow-x:hidden;-webkit-font-smoothing:antialiased;align-self:center}
/* HERO — has-bg 시 강한 그라디언트 오버레이로 텍스트 가독성 확보 */
.ssobi-public .lke-hero-carousel{position:relative}
.ssobi-public .lke-hero-banner{aspect-ratio:4/5;background:linear-gradient(135deg,#1A1F27 0%,#374151 100%);color:#fff;position:relative;overflow:hidden;padding:32px 24px;display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box}
.ssobi-public .lke-hero-banner::before{content:'';position:absolute;top:-100px;right:-100px;width:380px;height:380px;background:radial-gradient(circle,rgba(0,200,150,.35),transparent 70%)}
.ssobi-public .lke-hero-banner.has-bg{background-size:cover;background-position:center}
.ssobi-public .lke-hero-banner.has-bg::before{background:linear-gradient(180deg,rgba(0,0,0,.45) 0%,rgba(0,0,0,.15) 35%,rgba(0,0,0,.2) 60%,rgba(0,0,0,.7) 100%);inset:0;width:auto;height:auto;top:0;right:0}
.ssobi-public .lke-hero-banner-top{position:relative;z-index:2;display:flex;justify-content:space-between;align-items:flex-start}
.ssobi-public .lke-hero-eyebrow{font-family:'JetBrains Mono',monospace;font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--mint);display:inline-flex;align-items:center;gap:10px}
.ssobi-public .lke-hero-eyebrow::before{content:'';width:24px;height:1px;background:var(--mint);animation:lke-pulse 2s infinite}
.ssobi-public .lke-hero-banner-main{position:relative;z-index:2}
.ssobi-public .lke-hero-brand{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.15em;text-transform:uppercase;opacity:.65;margin-bottom:14px}
.ssobi-public .lke-hero-title{font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-size:48px;font-weight:300;line-height:1.02;letter-spacing:-.035em;margin:0 0 14px;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.25)}
.ssobi-public .lke-hero-title em{font-style:italic;color:var(--mint);font-weight:500}
.ssobi-public .lke-hero-subtitle{font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-size:14.5px;font-style:italic;opacity:.92;margin-bottom:16px;max-width:280px;line-height:1.5;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.3)}
.ssobi-public .lke-hero-banner-bottom{position:relative;z-index:2;display:flex;justify-content:space-between;align-items:flex-end}
.ssobi-public .lke-hero-stats{display:flex;gap:18px}
.ssobi-public .lke-hero-stat{position:relative;padding:4px 8px}
.ssobi-public .lke-hero-stat .num{font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-size:20px;font-weight:500;letter-spacing:-.02em;line-height:1}
.ssobi-public .lke-hero-stat .lbl{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;opacity:.58;margin-top:3px}
.ssobi-public .lke-hero-cta{padding:11px 18px;background:var(--mint);color:#fff;border-radius:100px;font-size:12.5px;font-weight:700;display:inline-flex;align-items:center;gap:6px;border:none;font-family:'Pretendard',sans-serif;letter-spacing:-.2px;text-decoration:none}
.ssobi-public .lke-hero-banner.compact{aspect-ratio:auto;min-height:180px;padding:18px 20px;background:linear-gradient(180deg,#FAFAF9 0%,#F5F5F4 100%);color:#1A1F27}
.ssobi-public .lke-hero-banner.compact::before{display:none}
.ssobi-public .lke-hero-banner.compact .lke-hero-eyebrow{color:rgba(26,31,39,.55);margin-bottom:10px}
.ssobi-public .lke-hero-banner.compact .lke-hero-eyebrow::before{display:none}
.ssobi-public .lke-hero-banner.compact .lke-hero-brand{color:rgba(26,31,39,.45);font-size:10px;letter-spacing:.15em;margin-bottom:6px}
.ssobi-public .lke-hero-banner.compact .lke-hero-title{font-size:24px;line-height:1.18;letter-spacing:-.02em;margin-bottom:6px;color:var(--t1)}
.ssobi-public .lke-hero-banner.compact .lke-hero-title em{color:var(--mint-d)}
.ssobi-public .lke-hero-banner.compact .lke-hero-subtitle{font-size:13px;line-height:1.5;color:rgba(26,31,39,.65);margin-bottom:0;font-style:normal}
.ssobi-public .lke-hero-banner.compact .lke-hero-banner-bottom{margin-top:10px}
/* EVENT */
.ssobi-public .lke-block-event{padding:12px 18px;background:var(--dark);color:#fff;display:flex;justify-content:space-between;align-items:center;gap:14px;text-decoration:none}
.ssobi-public .lke-event-left{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
.ssobi-public .lke-event-dot{width:7px;height:7px;background:var(--mint);border-radius:50%;animation:lke-pulse 2s infinite;box-shadow:0 0 8px var(--mint);flex-shrink:0}
.ssobi-public .lke-event-text{font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ssobi-public .lke-event-text strong{font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-style:italic;color:var(--mint);font-weight:500;font-size:14px;margin-right:4px}
.ssobi-public .lke-event-arrow{color:var(--mint);font-size:15px;flex-shrink:0}
/* COUNTDOWN */
.ssobi-public .lke-block-countdown{margin:14px 18px;padding:24px 22px;background:var(--mint);color:#fff;border-radius:18px;text-align:center;position:relative;overflow:hidden;text-decoration:none;display:block}
.ssobi-public .lke-block-countdown::before{content:'';position:absolute;top:-50px;right:-50px;width:180px;height:180px;background:radial-gradient(circle,rgba(255,255,255,.18),transparent 70%)}
.ssobi-public .lke-cd-eyebrow{font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.2em;text-transform:uppercase;opacity:.9;margin-bottom:8px;position:relative}
.ssobi-public .lke-cd-title{font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-size:26px;font-weight:500;margin-bottom:5px;letter-spacing:-.02em;position:relative}
.ssobi-public .lke-cd-title em{font-style:italic}
.ssobi-public .lke-cd-subtitle{font-size:11.5px;opacity:.88;margin-bottom:16px;position:relative}
.ssobi-public .lke-cd-timer{display:flex;justify-content:center;gap:8px;margin-bottom:16px;position:relative}
.ssobi-public .lke-cd-unit{background:rgba(15,19,25,.28);padding:10px 8px;border-radius:10px;min-width:60px}
.ssobi-public .lke-cd-num{font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-size:26px;font-weight:500;line-height:1;letter-spacing:-.02em}
.ssobi-public .lke-cd-lbl{font-family:'JetBrains Mono',monospace;font-size:8.5px;letter-spacing:.1em;opacity:.8;margin-top:3px;text-transform:uppercase}
.ssobi-public .lke-cd-slots{font-family:'JetBrains Mono',monospace;font-size:10.5px;letter-spacing:.1em;position:relative}
/* SECTION — generous spacing for editorial feel */
.ssobi-public .lke-block-section-title{padding:42px 18px 14px;display:flex;justify-content:space-between;align-items:flex-end}
.ssobi-public .lke-section-title{font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-size:30px;font-weight:300;line-height:1;letter-spacing:-.03em;color:var(--t1);margin:0}
.ssobi-public .lke-section-title em{font-style:italic;color:var(--mint);font-weight:400}
.ssobi-public .lke-section-see-all{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--t3);letter-spacing:.15em;text-transform:uppercase;padding-bottom:6px;text-decoration:none}
/* GRID — wider gap for editorial breathing room */
.ssobi-public .lke-block-grid{padding:0 18px;display:grid;grid-template-columns:1fr 1fr;gap:20px 12px;margin-bottom:6px}
.ssobi-public .lke-product-card{text-decoration:none;color:inherit;transition:transform .15s ease}
.ssobi-public .lke-product-card:active{transform:scale(.98)}
.ssobi-public .lke-product-img{aspect-ratio:1/1;border-radius:14px;margin-bottom:11px;position:relative;overflow:hidden;display:flex;align-items:flex-start;padding:10px;box-shadow:0 4px 14px rgba(15,19,25,.06)}
.ssobi-public .lke-product-img.cream{background:linear-gradient(135deg,#FEF3C7 0%,#D4B896 100%)}
.ssobi-public .lke-product-img.coral{background:linear-gradient(135deg,#A7F3D0 0%,#00C896 100%)}
.ssobi-public .lke-product-img.pink{background:linear-gradient(135deg,#FFE8DC 0%,#FFB098 100%)}
.ssobi-public .lke-product-img.dark{background:linear-gradient(135deg,#374151 0%,#1A1F27 100%);color:#fff}
.ssobi-public .lke-product-tag{font-family:'JetBrains Mono',monospace;font-size:9px;background:rgba(255,255,255,.92);color:var(--t1);padding:3px 8px;border-radius:100px;letter-spacing:.05em;font-weight:500;text-transform:uppercase}
.ssobi-public .lke-product-tag.hot{background:var(--mint);color:#fff}
.ssobi-public .lke-product-tag.dark{background:var(--dark);color:#fff}
.ssobi-public .lke-product-info-date{font-family:'JetBrains Mono',monospace;font-size:9.5px;color:var(--t3);margin-bottom:5px;letter-spacing:.05em;text-transform:uppercase}
.ssobi-public .lke-product-info-title{font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-size:14.5px;font-weight:500;line-height:1.35;letter-spacing:-.01em;margin-bottom:6px;color:var(--t1)}
.ssobi-public .lke-product-info-price{display:flex;gap:6px;align-items:baseline}
.ssobi-public .lke-price-sale{font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-size:14px;font-weight:500;color:var(--mint-d);letter-spacing:-.01em}
.ssobi-public .lke-price-orig{font-family:'JetBrains Mono',monospace;font-size:9.5px;color:var(--t3);text-decoration:line-through}
/* MAGAZINE — soft shadow */
.ssobi-public .lke-block-mag{margin:14px 18px;border-radius:18px;overflow:hidden;aspect-ratio:4/3;position:relative;display:flex;align-items:flex-end;padding:22px;text-decoration:none;color:#fff;box-shadow:0 8px 24px rgba(15,19,25,.08);transition:transform .15s ease}
.ssobi-public .lke-block-mag:active{transform:scale(.99)}
.ssobi-public .lke-block-mag.m1{background:linear-gradient(135deg,#A7F3D0 0%,#00A87E 100%)}
.ssobi-public .lke-block-mag.m2{background:linear-gradient(135deg,#67E8F9 0%,#06B6D4 100%)}
.ssobi-public .lke-block-mag.m3{background:linear-gradient(135deg,#C4B5FD 0%,#8B5CF6 100%)}
.ssobi-public .lke-block-mag::before{content:'';position:absolute;inset:0;background:linear-gradient(to top,rgba(15,19,25,.45) 0%,transparent 60%)}
.ssobi-public .lke-mag-label{position:absolute;top:18px;left:18px;font-family:'JetBrains Mono',monospace;font-size:10px;color:#fff;background:rgba(15,19,25,.35);padding:4px 11px;border-radius:100px;letter-spacing:.15em;text-transform:uppercase}
.ssobi-public .lke-mag-title{position:relative;z-index:2;font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-size:24px;font-weight:500;color:#fff;line-height:1.1;letter-spacing:-.02em;max-width:82%}
.ssobi-public .lke-mag-title em{font-style:italic}
/* BIGBANNER / CONTACT */
.ssobi-public .lke-block-bigbanner{margin:14px 18px;border-radius:18px;overflow:hidden;aspect-ratio:2/1;position:relative;display:flex;align-items:flex-end;padding:24px;background:linear-gradient(135deg,#1A1F27 0%,#374151 100%);color:#fff;text-decoration:none;box-shadow:0 8px 24px rgba(15,19,25,.12);transition:transform .15s ease}
.ssobi-public .lke-block-bigbanner:active{transform:scale(.99)}
.ssobi-public .lke-block-bigbanner::before{content:'';position:absolute;top:-100px;right:-100px;width:280px;height:280px;background:radial-gradient(circle,rgba(0,200,150,.3),transparent 70%)}
.ssobi-public .lke-bigbanner-content{position:relative;z-index:2}
.ssobi-public .lke-bigbanner-eyebrow{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--mint);letter-spacing:.2em;text-transform:uppercase;margin-bottom:8px}
.ssobi-public .lke-bigbanner-title{font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-size:26px;font-weight:400;line-height:1.05;letter-spacing:-.02em;color:#fff;margin:0}
.ssobi-public .lke-bigbanner-title em{font-style:italic;color:var(--mint);font-weight:500}
.ssobi-public .lke-bigbanner-arrow{position:absolute;top:22px;right:22px;width:42px;height:42px;border:1px solid rgba(255,255,255,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;z-index:2;color:#fff;background:rgba(255,255,255,.08)}
/* QUICKLINKS — clean editorial list */
.ssobi-public .lke-block-quicklinks{padding:0 18px;margin-top:10px}
.ssobi-public .lke-quicklink-item{padding:18px 4px;border-bottom:1px solid var(--b);display:flex;justify-content:space-between;align-items:center;gap:12px;text-decoration:none;color:inherit;transition:opacity .15s}
.ssobi-public .lke-quicklink-item:active{opacity:.6}
.ssobi-public .lke-quicklink-item:last-child{border-bottom:none}
.ssobi-public .lke-quicklink-label{font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-size:17px;font-weight:500;letter-spacing:-.01em;color:var(--t1)}
.ssobi-public .lke-quicklink-sub{font-family:'JetBrains Mono',monospace;font-size:9.5px;color:var(--t3);margin-top:2px;letter-spacing:.05em}
.ssobi-public .lke-quicklink-arrow{font-family:'JetBrains Mono',monospace;color:var(--t3);font-size:15px}
/* SOCIALS — bigger touch + soft shadow */
.ssobi-public .lke-block-socials{padding:24px 16px 12px;display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
.ssobi-public .lke-social-icon{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Pretendard',sans-serif;font-size:12px;font-weight:700;color:#fff;text-decoration:none;box-shadow:0 4px 12px rgba(15,19,25,.12);transition:transform .15s}
.ssobi-public .lke-social-icon:active{transform:scale(.92)}
.ssobi-public .lke-social-icon.ig{background:linear-gradient(135deg,#E1306C,#F77737)}
.ssobi-public .lke-social-icon.tk{background:#000}
.ssobi-public .lke-social-icon.yt{background:#FF0000}
.ssobi-public .lke-social-icon.email{background:var(--dark)}
/* LINK — refined card */
.ssobi-public .lke-block-link{margin:10px 18px;padding:16px 18px;border-radius:14px;background:#fff;border:1px solid var(--b);text-decoration:none;display:block;color:inherit;box-shadow:0 2px 8px rgba(15,19,25,.04);transition:transform .15s,box-shadow .15s}
.ssobi-public .lke-block-link:active{transform:scale(.99);box-shadow:0 1px 4px rgba(15,19,25,.06)}
.ssobi-public .lke-block-link .l-title{font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-size:15.5px;font-weight:500;color:var(--t1);margin:0;letter-spacing:-.01em}
.ssobi-public .lke-block-link .l-sub{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--t3);margin-top:3px;letter-spacing:.03em}
/* IMAGE */
.ssobi-public .lke-block-image{margin:14px 18px;border-radius:14px;overflow:hidden;aspect-ratio:16/9;position:relative;background:#1A1F27;display:flex;align-items:flex-end;padding:16px;color:#fff;text-decoration:none}
.ssobi-public .lke-block-image::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,transparent 50%,rgba(0,0,0,.55) 100%);z-index:0}
.ssobi-public .lke-block-image .img-title{position:relative;z-index:1;font-weight:800;font-size:16px;letter-spacing:-.2px}
/* FOOTER (user block) */
.ssobi-public .lke-block-footer{padding:32px 18px 28px;text-align:center;background:var(--dark);color:#fff}
.ssobi-public .lke-footer-logo{font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-style:italic;font-weight:900;font-size:22px;margin-bottom:5px}
.ssobi-public .lke-footer-logo span{color:var(--mint)}
.ssobi-public .lke-footer-text{font-family:'JetBrains Mono',monospace;font-size:10px;opacity:.48;letter-spacing:.1em}
/* DIVIDER / SPACER */
.ssobi-public .lke-block-divider{margin:14px 18px;border:none;height:1px;background:rgba(15,19,25,.1)}
.ssobi-public .lke-block-spacer{height:18px}
/* GLOBAL FOOTER + FAB */
.ssobi-public .ssobi-cta{display:block;margin:32px 18px 0;padding:16px;background:#1F1317;color:#fff;text-align:center;border-radius:14px;font-size:13.5px;font-weight:800;text-decoration:none;letter-spacing:-.2px;box-shadow:0 4px 14px rgba(31,19,23,.18);transition:transform .15s}
.ssobi-public .ssobi-cta:active{transform:scale(.99)}
.ssobi-public .ssobi-credit{text-align:center;font-size:10px;opacity:.5;font-weight:600;margin:16px 0 90px;letter-spacing:.4px}
.ssobi-public .ssobi-credit a{color:inherit;text-decoration:none}
.ssobi-public .ssobi-credit em{color:var(--mint);font-style:normal}
.ssobi-public .ssobi-fab{position:fixed;bottom:calc(20px + env(safe-area-inset-bottom));right:20px;width:52px;height:52px;border-radius:26px;background:#E85D75;color:#fff;border:none;cursor:pointer;box-shadow:0 8px 20px rgba(232,93,117,.36);font-size:22px}
`

export default function LinkPageClient({ page }: { page: PageData }) {
  const [proposing, setProposing] = useState(false)

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
    <>
      <style dangerouslySetInnerHTML={{ __html: PUBLIC_CSS }} />
      <div className="ssobi-public">
        <Hero slide={firstSlide} handle={page.handle} compact={isHeroCompact} />
        {page.blocks?.map((b, i) => renderBlock(b, i))}
        <a className="ssobi-cta" href="https://ssobi.ai/?ref=u">✨ 나도 1초만에 내 링크 만들기 →</a>
        <div className="ssobi-credit">Powered by <a href="https://ssobi.ai">Ssobi<em>.</em></a></div>

        <button className="ssobi-fab" onClick={() => setProposing(true)} aria-label="제안하기">💌</button>

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
    </>
  )
}

function Hero({ slide, handle, compact }: { slide: HeroSlide; handle: string; compact: boolean }) {
  const hasBg = !!slide.bg
  const cls = ['lke-hero-banner', compact ? 'compact' : '', hasBg ? 'has-bg' : ''].filter(Boolean).join(' ')
  const style: React.CSSProperties = hasBg ? { backgroundImage: `url(${slide.bg})` } : {}
  return (
    <div className="lke-hero-carousel">
      <div className={cls} style={style}>
        <div className="lke-hero-banner-top" style={{ textAlign: slide.eyebrow_align || 'left' }}>
          {slide.eyebrow && (
            <div className="lke-hero-eyebrow" dangerouslySetInnerHTML={safeHtml(slide.eyebrow)} />
          )}
        </div>
        <div className="lke-hero-banner-main" style={{ textAlign: slide.main_align || 'left' }}>
          {slide.brand && (
            <div className="lke-hero-brand" dangerouslySetInnerHTML={safeHtml(slide.brand)} />
          )}
          <h1 className="lke-hero-title" dangerouslySetInnerHTML={safeHtml(slide.title || `@${handle}`)} />
          {slide.sub && (
            <div className="lke-hero-subtitle" dangerouslySetInnerHTML={safeHtml(slide.sub)} />
          )}
        </div>
        <div className="lke-hero-banner-bottom">
          <div className="lke-hero-stats">
            {!slide.stat1_hidden && slide.stat1n && (
              <div className="lke-hero-stat">
                <div className="num">{slide.stat1n}</div>
                <div className="lbl">{slide.stat1l}</div>
              </div>
            )}
            {!slide.stat2_hidden && slide.stat2n && (
              <div className="lke-hero-stat">
                <div className="num">{slide.stat2n}</div>
                <div className="lbl">{slide.stat2l}</div>
              </div>
            )}
          </div>
          {slide.cta && !slide.cta_hidden && (
            <a className="lke-hero-cta" href={slide.ctaUrl || '#'} dangerouslySetInnerHTML={safeHtml(slide.cta)} />
          )}
        </div>
      </div>
    </div>
  )
}

const inp: React.CSSProperties = {
  width: '100%', padding: '11px 13px', border: '1px solid rgba(31,19,23,.14)', borderRadius: 8,
  fontSize: 13, marginBottom: 8, fontFamily: 'inherit', outline: 'none', background: '#FAFAF9', color: '#1F1317',
}

function hrefOf(b: { code?: string; url?: string }): string {
  return b.code ? `/s/${b.code}` : (b.url || '#')
}

function renderBlock(b: Block, i: number) {
  const key = b.id || `b-${i}`
  switch (b.type) {
    case 'event':
      return (
        <a key={key} className="lke-block lke-block-event" href={hrefOf(b)}
          style={{ background: b.bgColor || b.bgSolid || b.bg, color: b.textColor }}>
          <div className="lke-event-left">
            <div className="lke-event-dot" />
            <div className="lke-event-text">
              <strong dangerouslySetInnerHTML={safeHtml(b.text)} />
              <span dangerouslySetInnerHTML={safeHtml(b.sub)} />
            </div>
          </div>
          <div className="lke-event-arrow">→</div>
        </a>
      )

    case 'countdown':
      return (
        <a key={key} className="lke-block lke-block-countdown" href={hrefOf(b)}
          style={{ background: b.bgColor || b.bgSolid || b.bg, color: b.textColor }}>
          {b.eyebrow && <div className="lke-cd-eyebrow" dangerouslySetInnerHTML={safeHtml(b.eyebrow)} />}
          <div className="lke-cd-title" dangerouslySetInnerHTML={safeHtml(b.title)} />
          {b.sub && <div className="lke-cd-subtitle" dangerouslySetInnerHTML={safeHtml(b.sub)} />}
          <div className="lke-cd-timer">
            <div className="lke-cd-unit"><div className="lke-cd-num">03</div><div className="lke-cd-lbl">Hours</div></div>
            <div className="lke-cd-unit"><div className="lke-cd-num">42</div><div className="lke-cd-lbl">Min</div></div>
            <div className="lke-cd-unit"><div className="lke-cd-num">18</div><div className="lke-cd-lbl">Sec</div></div>
          </div>
          {b.slots && <div className="lke-cd-slots">남은 자리 {b.slots}</div>}
        </a>
      )

    case 'section':
      return (
        <div key={key} className="lke-block lke-block-section-title">
          <h2 className="lke-section-title" dangerouslySetInnerHTML={safeHtml(b.title)} />
          {b.seeAll && <span className="lke-section-see-all">{b.seeAll}</span>}
        </div>
      )

    case 'grid': {
      const items = (b.items as Array<{ kind?: string; title?: string; sub?: string; price?: string; origPrice?: string; date?: string; img?: string; thumbImg?: string; tag?: string; tagStyle?: string; url?: string; code?: string }>) || []
      return (
        <div key={key} className="lke-block lke-block-grid">
          {items.map((it, ci) => {
            const cardHref = it.code ? `/s/${it.code}` : (it.url || '#')
            const isProduct = it.kind === 'product' || !it.kind
            const imgClass = `lke-product-img ${it.img || 'cream'}`
            const thumbStyle: React.CSSProperties = it.thumbImg
              ? { background: `url(${it.thumbImg}) center/cover` }
              : {}
            return (
              <a key={ci} className="lke-product-card" href={cardHref}>
                <div className={imgClass} style={thumbStyle}>
                  {it.tag && (
                    <span className={`lke-product-tag ${it.tagStyle || ''}`}>{it.tag}</span>
                  )}
                </div>
                {it.date && <div className="lke-product-info-date">{it.date}</div>}
                <div className="lke-product-info-title" dangerouslySetInnerHTML={safeHtml(it.title)} />
                {isProduct && it.price && (
                  <div className="lke-product-info-price">
                    <span className="lke-price-sale">{it.price}</span>
                    {it.origPrice && <span className="lke-price-orig">{it.origPrice}</span>}
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
        <a key={key} className={`lke-block lke-block-mag ${b.theme || 'm1'}`} href={hrefOf(b)}
          style={b.thumbImg ? { background: `url(${b.thumbImg}) center/cover` } : (b.img ? { background: `url(${b.img}) center/cover` } : {})}>
          {b.label && <span className="lke-mag-label">{b.label}</span>}
          <div className="lke-mag-title" dangerouslySetInnerHTML={safeHtml(b.title)} />
        </a>
      )

    case 'contact':
    case 'bigbanner':
      return (
        <a key={key} className="lke-block lke-block-bigbanner" href={hrefOf(b)}
          style={b.thumbImg ? { background: `url(${b.thumbImg}) center/cover` } : (b.bgSolid ? { background: b.bgSolid } : (b.bg ? { background: b.bg } : {}))}>
          <div className="lke-bigbanner-arrow">↗</div>
          <div className="lke-bigbanner-content">
            {b.eyebrow && <div className="lke-bigbanner-eyebrow" dangerouslySetInnerHTML={safeHtml(b.eyebrow)} />}
            <div className="lke-bigbanner-title" dangerouslySetInnerHTML={safeHtml(b.title)} />
          </div>
        </a>
      )

    case 'quicklinks': {
      const items = (b.items as Array<{ label?: string; sub?: string; url?: string; code?: string }>) || []
      return (
        <div key={key} className="lke-block lke-block-quicklinks">
          {items.map((it, j) => (
            <a key={j} className="lke-quicklink-item" href={it.code ? `/s/${it.code}` : (it.url || '#')}>
              <div>
                <div className="lke-quicklink-label" dangerouslySetInnerHTML={safeHtml(it.label)} />
                {it.sub && <div className="lke-quicklink-sub">{it.sub}</div>}
              </div>
              <div className="lke-quicklink-arrow">→</div>
            </a>
          ))}
        </div>
      )
    }

    case 'socials': {
      const items = (b.items as Array<{ ch?: string; url?: string }>) || []
      const labelMap: Record<string, string> = { ig: 'IG', tk: 'TK', yt: 'YT', email: '@' }
      return (
        <div key={key} className="lke-block lke-block-socials">
          {items.map((it, j) => (
            <a key={j} className={`lke-social-icon ${it.ch || ''}`} href={it.url || '#'}>
              {labelMap[it.ch || ''] || '🔗'}
            </a>
          ))}
        </div>
      )
    }

    case 'link': {
      let subTxt = b.sub || ''
      if (!subTxt && b.url) {
        try { subTxt = new URL(b.url).hostname.replace(/^www\./, '') } catch { subTxt = b.url.slice(0, 32) }
      }
      return (
        <a key={key} className="lke-block lke-block-link" href={hrefOf(b)}>
          <div className="l-title" dangerouslySetInnerHTML={safeHtml(b.title || '링크')} />
          {subTxt && <div className="l-sub">{subTxt}</div>}
        </a>
      )
    }

    case 'image':
      return (
        <a key={key} className="lke-block lke-block-image" href={hrefOf(b)}
          style={b.thumbImg ? { background: `url(${b.thumbImg}) center/cover` } : (b.img ? { background: `url(${b.img}) center/cover` } : {})}>
          <div className="img-title" dangerouslySetInnerHTML={safeHtml(b.title)} />
        </a>
      )

    case 'divider':
      return <hr key={key} className="lke-block-divider" />

    case 'spacer':
      return <div key={key} className="lke-block-spacer" />

    case 'footer':
      return (
        <div key={key} className="lke-block lke-block-footer">
          <div className="lke-footer-logo" dangerouslySetInnerHTML={safeHtml(b.logo || 'Ssobi<span>.</span>')} />
          <div className="lke-footer-text">{b.text || ''}</div>
        </div>
      )

    default:
      return (
        <a key={key} className="lke-block lke-block-link" href={hrefOf(b)}>
          <div className="l-title" dangerouslySetInnerHTML={safeHtml(b.title || b.text || '')} />
        </a>
      )
  }
}
