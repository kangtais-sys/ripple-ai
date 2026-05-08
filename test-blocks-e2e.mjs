// E2E 테스트 — yuminhye 계정으로 모든 블록 타입 저장·조회·SSR 검증
// 1) admin.generateLink + verifyOtp 로 토큰 발급
// 2) /api/link POST 모든 블록 타입 (hero+13종)
// 3) /api/link GET 검증
// 4) /u/<handle> SSR 검증
// 사용: node test-blocks-e2e.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = readFileSync(new URL('./.env.local', import.meta.url), 'utf8')
  .split('\n').filter(l => l && !l.startsWith('#'))
  .reduce((m, l) => { const [k, ...rest] = l.split('='); m[k.trim()] = rest.join('=').trim().replace(/^"|"$/g, ''); return m }, {})

const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SVC = env.SUPABASE_SERVICE_ROLE_KEY
const SITE = 'https://ssobi.ai'
const TEST_EMAIL = 'kangtais@naver.com'   // dogfooding 계정

const sb = createClient(SUPA_URL, SVC, { auth: { persistSession: false } })

// 1) 토큰 발급 (magic link → otp 추출)
async function getToken(email) {
  const r = await sb.auth.admin.generateLink({ type: 'magiclink', email })
  if (r.error) throw new Error('generateLink: ' + r.error.message)
  // 매직링크 사용은 토큰만 사용 (verifyOtp)
  const hash = (r.data.properties?.hashed_token || '').trim()
  if (!hash) throw new Error('no hashed_token in generateLink response')
  const v = await sb.auth.verifyOtp({ token_hash: hash, type: 'email' })
  if (v.error) throw new Error('verifyOtp: ' + v.error.message)
  return v.data.session.access_token
}

function bench(name, fn) {
  return (async () => {
    const t0 = Date.now()
    try { const r = await fn(); console.log(`✓ ${name}  ${Date.now()-t0}ms`); return r }
    catch (e) { console.error(`✗ ${name}: ${e.message}`); throw e }
  })()
}

async function api(method, path, token, body) {
  const r = await fetch(SITE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined
  })
  const txt = await r.text()
  let json; try { json = JSON.parse(txt) } catch (_) { json = { _raw: txt.slice(0, 200) } }
  return { status: r.status, ok: r.ok, body: json, sizeKB: Math.round(JSON.stringify(body || {}).length / 1024) }
}

// 모든 블록 타입 + 다양한 컬러
const samplePayload = {
  handle: 'yuminhye',
  hero: {
    slides: [{
      bg: '',
      brand: 'YUMINHYE STUDIO',
      title: 'Glow <em>Drop.</em>',
      sub: '신상만 밝히는 코덕의 진짜 효자템',
      cta: '지금 보기 →',
      ctaUrl: 'https://example.com/glow'
    }]
  },
  theme: {
    bgSolid: '#FAFAFA',
    textColor: '#333333',
    titleColor: '#000000',
    titleFont: 'Pretendard',
    bodyFont: 'Pretendard'
  },
  settings: {},
  blocks: [
    { type:'event', id:'e1', text:'30% OFF', sub:'글로우 세럼 공동구매 중', url:'https://example.com/e' },
    { type:'countdown', id:'c1', eyebrow:'공구 마감까지', title:'글로우 세럼 <em>50ml</em>', sub:'100% 페이백 · 선착순 30명', slots:'5 / 30명', url:'https://example.com/cd' },
    { type:'section', id:'s1', title:'Today\'s <em>Picks.</em>', seeAll:'See all →' },
    { type:'grid', id:'g1', items:[
      { kind:'product', title:'세럼 A', price:'₩39,800', origPrice:'₩59,800', date:'4/19 · 바로배송', tag:'HOT', tagStyle:'hot', img:'coral', url:'https://example.com/a' },
      { kind:'product', title:'크림 B', price:'₩32,000', origPrice:'₩48,000', date:'4/20', tag:'NEW', img:'cream', url:'https://example.com/b' }
    ]},
    { type:'bigbanner', id:'bb1', eyebrow:'문의 · 제안', title:'협업·광고<br><em>문의하기.</em>', url:'https://example.com/bb' },
    { type:'magazine', id:'m1', label:'Routine', title:'한국인이 안 하는 스킨케어', theme:'m1', url:'https://example.com/m' },
    { type:'link', id:'l1', title:'올리브영', url:'https://oliveyoung.co.kr', sub:'oliveyoung.co.kr' },
    { type:'image', id:'i1', title:'Lookbook', img:'', url:'https://example.com/i' },
    { type:'quicklinks', id:'ql1', items:[
      { label:'밀리밀리 공식몰', sub:'millimilli.com', url:'https://millimilli.com' },
      { label:'협업 문의', sub:'hello@millimilli.co', url:'mailto:hello@millimilli.co' }
    ]},
    { type:'socials', id:'so1', items:[
      { ch:'ig', url:'https://instagram.com/yuminhye' },
      { ch:'tk', url:'https://tiktok.com/@yuminhye' },
      { ch:'yt', url:'https://youtube.com/@yuminhye' }
    ]},
    { type:'divider', id:'d1' },
    { type:'spacer', id:'sp1' }
  ],
  published: true
}

async function main() {
  console.log('=== /u/yuminhye E2E 검증 ===\n')
  const token = await bench('1. 인증 토큰 발급', () => getToken(TEST_EMAIL))

  const post = await bench(`2. POST /api/link (${Math.round(JSON.stringify(samplePayload).length / 1024)}KB)`, () => api('POST', '/api/link', token, samplePayload))
  if (!post.ok) { console.error('  → POST 실패:', post.status, post.body); process.exit(1) }

  const get = await bench('3. GET /api/link', () => api('GET', '/api/link', token))
  if (!get.ok || !get.body.page) { console.error('  → GET 실패:', get.status, get.body); process.exit(1) }
  const page = get.body.page

  // 검증: 저장된 데이터가 페이로드와 일치
  console.log('\n--- 데이터 검증 ---')
  const checks = []
  checks.push(['handle', page.handle === 'yuminhye'])
  checks.push(['hero slides', Array.isArray(page.hero?.slides) && page.hero.slides.length === 1])
  checks.push(['hero title', page.hero?.slides?.[0]?.title === 'Glow <em>Drop.</em>'])
  checks.push(['theme.bgSolid', page.theme?.bgSolid === '#FAFAFA'])
  checks.push(['theme.titleColor', page.theme?.titleColor === '#000000'])
  checks.push(['blocks count', page.blocks?.length === samplePayload.blocks.length])
  const types = (page.blocks || []).map(b => b.type)
  for (const t of ['event','countdown','section','grid','bigbanner','magazine','link','image','quicklinks','socials','divider','spacer']) {
    checks.push([`block type ${t}`, types.includes(t)])
  }
  // short_link code 자동 부여
  const eventBlock = (page.blocks || []).find(b => b.type === 'event')
  checks.push(['event auto code', !!eventBlock?.code])
  const linkBlock = (page.blocks || []).find(b => b.type === 'link')
  checks.push(['link auto code', !!linkBlock?.code])
  const grid = (page.blocks || []).find(b => b.type === 'grid')
  checks.push(['grid item 0 auto code', !!grid?.items?.[0]?.code])

  let pass = 0, fail = 0
  for (const [name, ok] of checks) {
    console.log(`${ok ? '✓' : '✗'} ${name}`); ok ? pass++ : fail++
  }

  // 4) /u/yuminhye SSR 렌더 검증
  console.log('\n--- SSR 렌더 검증 ---')
  const ssr = await fetch(SITE + '/u/yuminhye', { cache: 'no-store' })
  const html = await ssr.text()
  const ssrChecks = [
    ['200 OK', ssr.status === 200],
    ['theme bg applied', html.includes('background:#FAFAFA') || html.includes('background-color:#FAFAFA') || html.includes('rgb(250, 250, 250)') || html.includes('#FAFAFA')],
    ['data-theme-applied', html.includes('data-theme-applied')],
    ['hero title rendered', html.includes('Glow') && html.includes('Drop')],
    ['no <div> exposure in title', !html.match(/lke-hero-title[^>]*>[^<]*&lt;div/i)],
    ['event block', html.includes('lke-block-event')],
    ['countdown block', html.includes('lke-block-countdown')],
    ['grid block', html.includes('lke-block-grid')],
    ['bigbanner block', html.includes('lke-block-bigbanner')],
    ['magazine block', html.includes('lke-block-mag')],
    ['quicklinks', html.includes('lke-block-quicklinks')],
    ['socials', html.includes('lke-block-socials')],
    ['hero anchor wrapping', /a class="lke-hero-banner[^"]*"[^>]*href="https:/.test(html)]
  ]
  for (const [name, ok] of ssrChecks) {
    console.log(`${ok ? '✓' : '✗'} ${name}`); ok ? pass++ : fail++
  }

  console.log(`\n=== Total ${pass}/${pass+fail} 통과, ${fail}건 실패 ===`)
  if (fail > 0) process.exit(1)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
