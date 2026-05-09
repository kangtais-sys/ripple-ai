'use client'

import { useEffect, useState } from 'react'

type Block = {
  type: string
  id?: string
  title?: string
  sub?: string
  sub2?: string
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
  main_valign?: 'top' | 'middle' | 'bottom'
  cta_align?: 'left' | 'center' | 'right'
  main_pos?: { x: number; y: number }
  cta_bg?: string
  cta_color?: string
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
  // contenteditable이 만들어낸 div/p wrapper 정리 — Enter 줄바꿈 정상 처리
  let cleaned = String(s)
    .replace(/<\/(div|p)>\s*<(div|p)[^>]*>/gi, '<br>')
    .replace(/<(div|p)[^>]*>/gi, '')
    .replace(/<\/(div|p)>/gi, '')
    .replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>')
    .replace(/&nbsp;/g, ' ')
  let out = cleaned
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
/* lke-* 블록 폰트 — 편집기와 같은 클린 Pretendard 룩으로 통일 */
.ssobi-public .lke-hero-title,
.ssobi-public .lke-hero-subtitle,
.ssobi-public .lke-hero-brand,
.ssobi-public .lke-section-title,
.ssobi-public .lke-section-title em,
.ssobi-public .lke-product-info-title,
.ssobi-public .lke-price-sale,
.ssobi-public .lke-mag-title,
.ssobi-public .lke-mag-title em,
.ssobi-public .lke-bigbanner-title,
.ssobi-public .lke-bigbanner-title em,
.ssobi-public .lke-bigbanner-eyebrow,
.ssobi-public .lke-cd-title,
.ssobi-public .lke-cd-title em,
.ssobi-public .lke-cd-num,
.ssobi-public .lke-cd-eyebrow,
.ssobi-public .lke-cd-lbl,
.ssobi-public .lke-cd-slots,
.ssobi-public .lke-event-text strong,
.ssobi-public .lke-quicklink-label,
.ssobi-public .lke-quicklink-sub,
.ssobi-public .lke-block-link .l-title,
.ssobi-public .lke-block-link .l-sub,
.ssobi-public .lke-product-info-date,
.ssobi-public .lke-price-orig,
.ssobi-public .lke-product-tag,
.ssobi-public .lke-mag-label{font-family:'Pretendard Variable','Pretendard','Noto Sans KR',sans-serif}
/* 테마 오버라이드 — 라이트 배경 블록만 (다크 배경 블록은 #fff inherit 유지) */
.ssobi-public[data-theme-applied="1"] .lke-section-title,
.ssobi-public[data-theme-applied="1"] .lke-product-info-title,
.ssobi-public[data-theme-applied="1"] .lke-block-link .l-title,
.ssobi-public[data-theme-applied="1"] .lke-quicklink-label,
.ssobi-public[data-theme-applied="1"] .lke-price-sale{color:var(--lke-title-color, var(--t1)) !important;font-family:var(--lke-title-font, 'Pretendard','Noto Sans KR',sans-serif)}
.ssobi-public[data-theme-applied="1"] .lke-product-info-date,
.ssobi-public[data-theme-applied="1"] .lke-quicklink-sub,
.ssobi-public[data-theme-applied="1"] .lke-block-link .l-sub{color:var(--lke-text-color, var(--t2)) !important}
/* HERO — has-bg 시 강한 그라디언트 오버레이로 텍스트 가독성 확보 */
.ssobi-public .lke-hero-carousel{position:relative}
.ssobi-public .lke-hero-banner{aspect-ratio:4/5;background:#1A1F27;color:#fff;position:relative;overflow:hidden;padding:32px 24px;display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;text-decoration:none}
.ssobi-public .lke-hero-banner[data-valign='middle']{justify-content:center;gap:14px}
.ssobi-public .lke-hero-banner[data-valign='bottom']{justify-content:flex-end;gap:14px}
.ssobi-public a.lke-hero-banner{color:#fff;cursor:pointer;transition:filter .2s}
.ssobi-public a.lke-hero-banner:active{filter:brightness(.9)}
.ssobi-public .lke-hero-banner::before{content:none}
.ssobi-public .lke-hero-banner.has-bg{background-size:cover;background-position:center}
.ssobi-public .lke-hero-banner.has-bg::before{background:linear-gradient(180deg,rgba(0,0,0,.45) 0%,rgba(0,0,0,.15) 35%,rgba(0,0,0,.2) 60%,rgba(0,0,0,.7) 100%);inset:0;width:auto;height:auto;top:0;right:0}
/* eyebrow 제거됨 (2026-05-08) */
.ssobi-public .lke-hero-banner-main{position:relative;z-index:2}
.ssobi-public .lke-hero-brand{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.15em;text-transform:uppercase;opacity:.65;margin-bottom:14px}
.ssobi-public .lke-hero-title{font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-size:48px;font-weight:300;line-height:1.02;letter-spacing:-.035em;margin:0 0 14px;color:inherit;text-shadow:0 2px 12px rgba(0,0,0,.25)}
.ssobi-public .lke-hero-title em{font-style:italic;font-weight:500}
.ssobi-public .lke-hero-subtitle{font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-size:14.5px;font-style:italic;opacity:.92;margin-bottom:16px;max-width:280px;line-height:1.5;color:inherit;text-shadow:0 2px 8px rgba(0,0,0,.3)}
.ssobi-public .lke-hero-banner-bottom{position:absolute;bottom:24px;left:24px;right:24px;z-index:3;display:flex;justify-content:flex-end;align-items:flex-end}
.ssobi-public .lke-hero-stats{display:flex;gap:18px}
.ssobi-public .lke-hero-stat{position:relative;padding:4px 8px}
.ssobi-public .lke-hero-stat .num{font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-size:20px;font-weight:500;letter-spacing:-.02em;line-height:1}
.ssobi-public .lke-hero-stat .lbl{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;opacity:.58;margin-top:3px}
.ssobi-public .lke-hero-cta{padding:11px 18px;background:var(--mint);color:#fff;border-radius:100px;font-size:12.5px;font-weight:700;display:inline-flex;align-items:center;gap:6px;border:none;font-family:'Pretendard',sans-serif;letter-spacing:-.2px;text-decoration:none}
.ssobi-public .lke-hero-banner.compact{aspect-ratio:auto;min-height:180px;padding:18px 20px;background:#FAFAF9;color:#1A1F27}
.ssobi-public .lke-hero-banner.compact::before{display:none}
/* compact eyebrow 제거됨 (2026-05-08) */
.ssobi-public .lke-hero-banner.compact .lke-hero-brand{color:rgba(26,31,39,.45);font-size:10px;letter-spacing:.15em;margin-bottom:6px}
.ssobi-public .lke-hero-banner.compact .lke-hero-title{font-size:24px;line-height:1.18;letter-spacing:-.02em;margin-bottom:6px;color:var(--t1)}
.ssobi-public .lke-hero-banner.compact .lke-hero-title em{font-style:italic}
.ssobi-public .lke-hero-banner.compact .lke-hero-subtitle{font-size:13px;line-height:1.5;color:rgba(26,31,39,.65);margin-bottom:0;font-style:normal}
.ssobi-public .lke-hero-banner.compact .lke-hero-banner-bottom{margin-top:10px}
/* EVENT */
.ssobi-public .lke-block-event{padding:12px 18px;background:var(--dark);color:#fff;display:flex;justify-content:space-between;align-items:center;gap:14px;text-decoration:none}
.ssobi-public .lke-event-left{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
.ssobi-public .lke-event-dot{width:7px;height:7px;background:var(--mint);border-radius:50%;animation:lke-pulse 2s infinite;box-shadow:0 0 8px var(--mint);flex-shrink:0}
.ssobi-public .lke-event-text{font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ssobi-public .lke-event-text strong{font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-style:italic;font-weight:500;font-size:14px;margin-right:4px}
.ssobi-public .lke-event-arrow{color:var(--mint);font-size:15px;flex-shrink:0}
/* COUNTDOWN */
.ssobi-public .lke-block-countdown{margin:14px 18px;padding:24px 22px;background:var(--mint);color:#fff;border-radius:18px;text-align:center;position:relative;overflow:hidden;text-decoration:none;display:block}
.ssobi-public .lke-block-countdown::before{content:none}
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
.ssobi-public .lke-section-title em{font-style:italic;font-weight:400}
.ssobi-public .lke-section-see-all{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--t3);letter-spacing:.15em;text-transform:uppercase;padding-bottom:6px;text-decoration:none}
/* GRID — wider gap for editorial breathing room */
.ssobi-public .lke-block-grid{padding:0 18px;display:grid;grid-template-columns:1fr 1fr;gap:20px 12px;margin-bottom:6px}
.ssobi-public .lke-product-card{text-decoration:none;color:inherit;transition:transform .15s ease}
.ssobi-public .lke-product-card:active{transform:scale(.98)}
.ssobi-public .lke-product-img{aspect-ratio:1/1;border-radius:14px;margin-bottom:11px;position:relative;overflow:hidden;display:flex;align-items:flex-start;padding:10px;box-shadow:0 4px 14px rgba(15,19,25,.06)}
.ssobi-public .lke-product-img.cream{background:#F5E9C8}
.ssobi-public .lke-product-img.coral{background:#A7F3D0}
.ssobi-public .lke-product-img.pink{background:#FFD9C7}
.ssobi-public .lke-product-img.dark{background:#1F2937;color:#fff}
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
.ssobi-public .lke-block-mag.m1{background:#00A87E}
.ssobi-public .lke-block-mag.m2{background:#06B6D4}
.ssobi-public .lke-block-mag.m3{background:#8B5CF6}
.ssobi-public .lke-block-mag::before{content:none}
.ssobi-public .lke-mag-label{position:absolute;top:18px;left:18px;font-family:'JetBrains Mono',monospace;font-size:10px;color:#fff;background:rgba(15,19,25,.35);padding:4px 11px;border-radius:100px;letter-spacing:.15em;text-transform:uppercase}
.ssobi-public .lke-mag-title{position:relative;z-index:2;font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-size:24px;font-weight:500;color:inherit;line-height:1.1;letter-spacing:-.02em;max-width:82%}
.ssobi-public .lke-mag-title em{font-style:italic}
/* BIGBANNER / CONTACT */
/* bigbanner: wrapper(.lke-block-bigbanner) — 빈 컨테이너. 시각 카드 = .lke-bigbanner-card */
.ssobi-public .lke-block-bigbanner{margin:14px 18px;text-decoration:none;display:block;color:inherit}
.ssobi-public .lke-bigbanner-card{border-radius:18px;overflow:hidden;aspect-ratio:2/1;position:relative;display:flex;align-items:flex-end;padding:24px;background:#1A1F27;color:#fff;box-shadow:0 8px 24px rgba(15,19,25,.12);transition:transform .15s ease;box-sizing:border-box}
.ssobi-public .lke-block-bigbanner:active .lke-bigbanner-card{transform:scale(.99)}
.ssobi-public .lke-bigbanner-card.has-bg::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.15) 0%,transparent 30%,rgba(0,0,0,.4) 100%);pointer-events:none}
.ssobi-public .lke-bigbanner-sub2{padding:10px 4px 2px;font-size:14px;font-weight:500;line-height:1.3;letter-spacing:-.01em;color:var(--t1)}
.ssobi-public .lke-bigbanner-content{position:relative;z-index:2}
.ssobi-public .lke-bigbanner-eyebrow{font-family:'JetBrains Mono',monospace;font-size:10px;color:inherit;opacity:.7;letter-spacing:.2em;text-transform:uppercase;margin-bottom:8px}
.ssobi-public .lke-bigbanner-title{font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-size:26px;font-weight:400;line-height:1.05;letter-spacing:-.02em;color:inherit;margin:0}
.ssobi-public .lke-bigbanner-title em{font-style:italic;font-weight:500}
.ssobi-public .lke-bigbanner-sub{font-size:13px;font-weight:500;color:inherit;opacity:.78;margin-top:8px;line-height:1.4}
/* bigbanner arrow 제거됨 (2026-05-08) */
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
.ssobi-public .ssobi-cta{display:flex;align-items:center;justify-content:center;gap:8px;margin:36px 18px 0;padding:18px 20px;background:var(--dark);color:#fff;text-align:center;border-radius:100px;font-family:'Fraunces','Pretendard','Noto Sans KR',sans-serif;font-size:14.5px;font-weight:500;text-decoration:none;letter-spacing:-.01em;box-shadow:0 8px 24px rgba(15,19,25,.18);transition:transform .15s,box-shadow .15s}
.ssobi-public .ssobi-cta:active{transform:scale(.99);box-shadow:0 4px 14px rgba(15,19,25,.18)}
.ssobi-public .ssobi-cta em{font-style:italic;color:var(--mint);font-weight:600;margin:0 2px}
.ssobi-public .ssobi-cta:active{transform:scale(.99)}
.ssobi-public .ssobi-credit{text-align:center;font-size:10px;opacity:.5;font-weight:600;margin:16px 0 90px;letter-spacing:.4px}
.ssobi-public .ssobi-credit a{color:inherit;text-decoration:none}
.ssobi-public .ssobi-credit em{color:var(--mint);font-style:normal}
.ssobi-public .ssobi-fab{position:fixed;bottom:calc(20px + env(safe-area-inset-bottom));right:20px;min-width:52px;height:52px;padding:0 18px;border-radius:26px;background:#1A1F27;color:#fff;border:none;cursor:pointer;box-shadow:0 8px 20px rgba(15,19,25,.28);display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:'Pretendard',sans-serif;font-size:13px;font-weight:700;text-decoration:none;letter-spacing:-.2px}
.ssobi-public .ssobi-fab svg{stroke:currentColor;fill:none;flex-shrink:0}
.ssobi-public .ssobi-fab-label{font-size:13px;font-weight:700;line-height:1}
.ssobi-public a.ssobi-fab:hover{filter:brightness(1.1)}
.ssobi-public .ssobi-fab:active{transform:scale(.96)}
`

export default function LinkPageClient({ page }: { page: PageData }) {
  const [proposing, setProposing] = useState(false)

  const slides = page.hero?.slides || []
  const firstSlide = slides[0] || ({ title: `@${page.handle}`, sub: 'Ssobi에서 만든 링크 페이지' } as HeroSlide)
  const isHeroCompact = !!page.hero?.compact

  // 조회수 트래킹 — page.tsx 가 ISR 캐싱이라 SSR 단계에서 카운트하면 누락됨.
  //   마운트 시 한 번만 호출. 봇은 fetch 안 하니 어차피 카운트 안 됨.
  useEffect(() => {
    fetch('/api/link/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: page.handle }),
      keepalive: true,
    }).catch(() => {})
  }, [page.handle])

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

  // 유저 테마 — 편집기 테마 패널에서 저장한 색·폰트 그대로 공개 페이지에 적용
  const t = (page.theme || {}) as { bgSolid?: string; textColor?: string; titleColor?: string; titleFont?: string; bodyFont?: string }
  const themeStyle: React.CSSProperties & Record<string, string> = {}
  if (t.bgSolid) themeStyle.background = t.bgSolid
  if (t.bodyFont) themeStyle.fontFamily = `'${t.bodyFont}','Pretendard',sans-serif`
  if (t.textColor) themeStyle['--lke-text-color'] = t.textColor
  if (t.titleColor) themeStyle['--lke-title-color'] = t.titleColor
  if (t.titleFont) themeStyle['--lke-title-font'] = `'${t.titleFont}','Pretendard',sans-serif`
  const themeApplied = !!(t.textColor || t.titleColor || t.titleFont || t.bodyFont)

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PUBLIC_CSS }} />
      <div className="ssobi-public" style={themeStyle} data-theme-applied={themeApplied ? '1' : undefined}>
        <Hero slide={firstSlide} handle={page.handle} compact={isHeroCompact} />
        {page.blocks?.map((b, i) => renderBlock(b, i))}
        <a className="ssobi-cta" href="https://ssobi.ai/?ref=u" dangerouslySetInnerHTML={{ __html: '나만의 링크 페이지 <em>1초만에</em> 만들기 →' }} />
        <div className="ssobi-credit">Powered by <a href="https://ssobi.ai">Ssobi<em>.</em></a></div>

        {(() => {
          const fab = (page.settings as { fab?: { enabled?: boolean; icon?: string; mode?: string; url?: string; label?: string } })?.fab
          if (fab && fab.enabled === false) return null
          const iconKey = (fab?.icon || 'message') as 'message' | 'chat' | 'kakao' | 'mail'
          const Icon = () => {
            if (iconKey === 'mail') return (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
            )
            if (iconKey === 'chat' || iconKey === 'kakao') return (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            )
            return (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" /></svg>
            )
          }
          const label = fab?.label || ''
          if (fab?.mode === 'link' && fab.url) {
            return (
              <a className="ssobi-fab" href={fab.url} target="_blank" rel="noopener noreferrer" aria-label={label || '제안하기'}>
                <Icon />{label && <span className="ssobi-fab-label">{label}</span>}
              </a>
            )
          }
          return (
            <button className="ssobi-fab" onClick={() => setProposing(true)} aria-label={label || '제안하기'}>
              <Icon />{label && <span className="ssobi-fab-label">{label}</span>}
            </button>
          )
        })()}

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
  const linkUrl = slide.ctaUrl || ''
  const ctaJustify = ({ left: 'flex-start', center: 'center', right: 'flex-end' } as const)[(slide.cta_align as 'left'|'center'|'right') || 'right']
  const inner = (
    <>
      <div className="lke-hero-banner-main" style={{
        textAlign: slide.main_align || 'left',
        ...(slide.main_pos ? {
          position: 'absolute' as const,
          left: `${slide.main_pos.x}%`,
          top: `${slide.main_pos.y}%`,
          margin: 0,
          maxWidth: 'calc(100% - 36px)'
        } : {})
      }}>
        {slide.brand && (
          <div className="lke-hero-brand" dangerouslySetInnerHTML={safeHtml(slide.brand)} />
        )}
        <h1 className="lke-hero-title" dangerouslySetInnerHTML={safeHtml(slide.title || `@${handle}`)} />
        {slide.sub && (
          <div className="lke-hero-subtitle" dangerouslySetInnerHTML={safeHtml(slide.sub)} />
        )}
      </div>
      {slide.cta && !slide.cta_hidden && (
        <div className="lke-hero-banner-bottom" style={{ justifyContent: ctaJustify }}>
          <span className="lke-hero-cta" style={{
            background: slide.cta_bg || undefined,
            color: slide.cta_color || undefined
          }} dangerouslySetInnerHTML={safeHtml(slide.cta)} />
        </div>
      )}
    </>
  )
  const valign = (slide.main_valign as 'top'|'middle'|'bottom') || 'top'
  return (
    <div className="lke-hero-carousel">
      {linkUrl ? (
        <a className={cls} style={style} href={linkUrl} data-valign={valign}>{inner}</a>
      ) : (
        <div className={cls} style={style} data-valign={valign}>{inner}</div>
      )}
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
          style={{ background: b.img ? `url(${b.img}) center/cover` : (b.bgColor || b.bgSolid || b.bg), color: b.textColor }}>
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
          style={{ background: b.img ? `url(${b.img}) center/cover` : (b.bgColor || b.bgSolid || b.bg), color: b.textColor }}>
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
          style={{
            background: b.img ? `url(${b.img}) center/cover` : (b.thumbImg ? `url(${b.thumbImg}) center/cover` : (b.bgSolid as string || b.bg as string || undefined)),
            color: b.textColor as string | undefined
          }}>
          {b.label && <span className="lke-mag-label">{b.label}</span>}
          <div className="lke-mag-title" dangerouslySetInnerHTML={safeHtml(b.title)} />
        </a>
      )

    case 'contact':
    case 'bigbanner': {
      const hasBg = !!(b.img || b.thumbImg)
      const cardStyle: React.CSSProperties = {
        background: b.img ? `url(${b.img}) center/cover` : (b.thumbImg ? `url(${b.thumbImg}) center/cover` : (b.bgSolid as string || b.bg as string || undefined)),
        color: b.textColor as string | undefined
      }
      const sub2 = (b as { sub2?: string }).sub2
      return (
        <a key={key} className="lke-block lke-block-bigbanner" href={hrefOf(b)}>
          <div className={`lke-bigbanner-card${hasBg ? ' has-bg' : ''}`} style={cardStyle}>
            <div className="lke-bigbanner-content">
              {b.eyebrow && <div className="lke-bigbanner-eyebrow" dangerouslySetInnerHTML={safeHtml(b.eyebrow)} />}
              <div className="lke-bigbanner-title" dangerouslySetInnerHTML={safeHtml(b.title)} />
              {b.sub && <div className="lke-bigbanner-sub" dangerouslySetInnerHTML={safeHtml(b.sub)} />}
            </div>
          </div>
          {sub2 && <div className="lke-bigbanner-sub2" dangerouslySetInnerHTML={safeHtml(sub2)} />}
        </a>
      )
    }

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
