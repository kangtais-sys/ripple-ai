# 인계 문서 — 학습 자동화 (sync-links + OCR) 미해결

**작성일**: 2026-05-19
**상태**: 🔴 sync-links 500 root cause 미확정. 임시 처리만 함.
**우선순위**: 높음 — 모든 사용자 자동 학습이 안 되는 상태

---

## TL;DR

`POST /api/learn/sync-links` 가 Vercel runtime 의 `Runtime Error: insta...` (truncated) 로 죽음. 학습탭 진입 시 자동 호출 → 무한 500. 현재 client 가 호출 안 하게 비활성화한 상태. 사용자 본인 chunks 5개만 임시 수동 insert. **모든 사용자에게 자동 작동하려면 root cause 격리 + 본질 fix 필요**.

---

## 현재 작동 상태

| 항목 | 상태 | 비고 |
|---|---|---|
| 학습탭 UI | ✓ 정상 | 카드·모달·디테일 다 작동 |
| `/api/learn/overview` | ✓ 정상 | products / chunks / tone 다 반환 |
| `/api/learn/detail` | ✓ 정상 | source_url + label 매치로 chunks 표시 |
| **`/api/learn/sync-links`** | 🔴 500 | Vercel runtime crash, root cause 미확정 |
| **`/api/link` POST 의 `embedLinkBlocksBackground`** | 🟡 의심 | fire-and-forget → Vercel 응답 후 죽음 의심. 실제로 millimilli 4개 URL chunks 0개 |
| 자동 말투 학습 (`learnAutoStartTone`) | ✓ 정상 | Haiku 4.5, 21초 |
| 학습탭 자동 sync-links 호출 | ✗ 비활성화 | `c37cd4a` 에서 끔 |

---

## 핵심 증상

### Vercel logs

```
| 05:37:41 | POST | /api/learn/sync-links | 500 | error | Vercel Runtime Error: insta... |
```

- message truncated — 정확한 메시지 모름
- outer `try/catch` 의 `[sync-links] fatal:` 로그도 안 찍힘 → function 자체 dead
- 클라이언트 응답 body 비어있음 (`error: undefined detail: undefined`)

### Client 콘솔

```
POST https://ssobi.ai/api/learn/sync-links 500 (Internal Server Error)
[sync-links] failed status: 500 error: undefined detail: undefined
```

### 재현

1. ssobi.ai/app 로그인 (사용자: 9161c37c-9a9d-45cd-ac4d-fbba28664304, kangtais@naver.com)
2. 학습탭 진입 → 이전엔 `runSyncLinksLoop` 호출 (지금 비활성화)
3. 강제 재현: localStorage `ssobi_sync_links_at` 삭제 + 코드의 호출 부분 (`app.html:19030`) 복원

---

## 시도한 fix (효과 X)

| Commit | 시도 | 결과 |
|---|---|---|
| `3b09322` | Phase 3 OCR 추가 (Haiku Vision) | 500 |
| `b5c3ba9` | batch 2 URL + client loop | 500 |
| `aa2287a` | outer try/catch + detail 응답 | 응답 body 비어있어 detail 못 봄 |
| `3791d7e` | image-ocr magic bytes + filter 강화 | 로컬 검증 OK, 배포에선 500 |
| `b7682c1` | batch 1 + OCR max 15 | 500 |
| `2cce1e1` | fail URL placeholder mark | infinite loop 해결, 그래도 다음 batch 500 |
| `0a9d9d6` | system prompt 강화 (도메인 용어) | OCR 정확도 ↑ ("그늘 건조" 정확), 그래도 instance crash |
| `806843b` | concurrency 2, max 10, size 3MB | 500 |
| `83ed0c7` | OCR 임시 off (quickParse 만) | 500 — 즉 OCR 이 root cause 아님 |
| `c37cd4a` | client 자동 호출 비활성화 | 500 표시는 안 뜸 (회피) |

---

## Root cause 후보 (격리 안 됨)

### A. 외부 API hang (가장 의심)
- **Voyage embedding API** — `src/lib/kb/embedding.ts` 에 timeout 없음
- **Anthropic Vision API** — 30s timeout 있지만 동시 호출 시 누적
- **fetch (HTML)** — quickParse 8s timeout 있음

→ fluid compute 의 instance 가 promise hang 중 메모리 누적 → instance kill

### B. 모듈 dynamic import 실패
- `await import('@/lib/kb/store')`
- `await import('@/lib/parsers/quick')`
- `await import('@/lib/kb/image-ocr')`

→ 첫 호출 시 throw 가능. 하지만 outer try/catch 안에 있어 응답되어야

### C. Vercel Fluid Compute 의 instance state
- 여러 batch 요청이 같은 instance 에서 처리됨
- 메모리 누적 + 1024MB 도달 시 instance kill (no graceful error)

### D. storeKnowledge / chunker bug
- chunker 가 특정 텍스트에서 throw 가능 (한국어 char count 등)
- 로컬에서 검증 안 함

---

## 검증 안 한 단계 (다음 개발자 우선순위)

### 1. Minimal sync-links 격리 (가장 시급)

```ts
// sync-links/route.ts 를 단계별로 minimal 만들고 각각 deploy
export async function POST(req) {
  try {
    const u = await getUserFromRequest(req)
    if (!u) return NextResponse.json({error:'unauth'}, {status:401})

    // STEP 1: auth + return ok → 200 이면 OK
    if (url.searchParams.get('step') === '1') return NextResponse.json({ok:true})

    // STEP 2: + supabase link_pages fetch → 200?
    const sb = admin()
    const { data: page } = await sb.from('link_pages').select('blocks').eq('user_id', u.id).maybeSingle()
    if (url.searchParams.get('step') === '2') return NextResponse.json({ok:true, blocks:page?.blocks?.length})

    // STEP 3: + storeKnowledge (without embedding) → 200?
    // STEP 4: + storeKnowledge (with embedding) → 여기서 fail 하면 Voyage 가 root cause
    // STEP 5: + quickParse → 여기서 fail 하면 quickParse 가 root cause
  } catch (e) {
    return NextResponse.json({error:String(e)}, {status:500})
  }
}
```

각 step deploy 후 vercel logs 확인 → 정확한 fail line 찾기.

### 2. Vercel logs 의 full message 확보

```ts
// 현재 logs 가 truncated. inspector URL 직접 보거나
// 또는 try/catch 안에서 명시적으로 detail 응답 + console.error stack 으로
console.error('SYNC_LINKS_FATAL', JSON.stringify({
  message: e.message,
  stack: e.stack,
  cause: e.cause,
  step: 'storeKnowledge', // 현재 어느 단계 인지
}))
```

### 3. 외부 API 호출에 명시적 timeout

```ts
// src/lib/kb/embedding.ts
const res = await fetch(VOYAGE_API_URL, {
  method: 'POST',
  signal: AbortSignal.timeout(15000), // 추가
  ...
})
```

Voyage / Anthropic 모든 fetch 에 timeout 명시.

### 4. Background queue 도입 (root cause 잡은 후 필요시)

옵션:
- **Vercel Queues** (베타, native)
- **Inngest** (stable, free tier 5만 step/월) ← 추천
- **Trigger.dev**
- **Vercel Cron + DB queue** (간단, 지연 있음)

Inngest 통합:
```
npm i inngest
# inngest.ts 셋업
# Inngest worker function 작성 (URL 1개씩 처리)
# /api/link POST 가 inngest.send() 만 호출 (즉시 응답)
```

---

## 코드 위치

### sync-links 본체
`src/app/api/learn/sync-links/route.ts`
- POST handler
- batch 1 URL 만 처리
- OCR 부분 주석 (commit `83ed0c7`)
- outer try/catch 있지만 fatal 로그 안 찍힘 → function 자체 dead

### OCR 모듈
`src/lib/kb/image-ocr.ts`
- `ocrImage(url)` — Claude Haiku Vision base64 OCR
- `ocrImages(urls, opts)` — 병렬 batch
- `extractContentImages(html, baseUrl)` — NNEditor·upload 패턴 본문 이미지 추출
- system prompt 에 한국어 도메인 용어 예시 (`0a9d9d6`)

### URL 파서
`src/lib/parsers/quick.ts`
- JSON-LD + OG meta + 본문 텍스트 추출
- `contentImages` 필드 추가됨 (`3b09322`)
- 8s fetch timeout

### Embedding
`src/lib/kb/embedding.ts`
- Voyage AI voyage-3-lite
- **⚠️ timeout 없음 — fix 필요**

### Store
`src/lib/kb/store.ts`
- chunker + embedding + supabase insert
- embedding fail-soft (chunks 는 embedding=null 로 저장됨)

### Link page hook
`src/app/api/link/route.ts:108`
- `embedLinkBlocksBackground` fire-and-forget
- **⚠️ Vercel 응답 후 process 죽음 의심**
- `waitUntil` 또는 await 필요

### Client
`public/app.html`
- `runSyncLinksLoop` 함수 (~line 19010): 자동 호출 비활성화
- `loadLearnOverview` 안에서 trigger 됐었음 (지금 주석)
- `openLearnDetail` — chunks content 표시 (정상)

---

## DB 상태 (수동 처리 흔적)

### 사용자 9161c37c-9a9d-45cd-ac4d-fbba28664304 의 chunks

**임시로 직접 insert 한 것 (인계받는 사람 주의 — 이건 한 사용자에게만)**:
- millimilli.kr 제품 4개 (id: `07edc396`, `2b89204e`, `6dd393b9`, `64c3016f`)
- lala-lounge.com 코디 1개 (id: `6fb19e1a`)
- 각각 JSON-LD 파싱한 content, embedding=null

이미 자동 (이전 시도):
- youtube 채널 22 chunks (말투 학습용 자동 임베딩 성공)
- block 자체 텍스트 chunks 일부 (`고민 없는 그 코디` 등, source_url=null)
- placeholder `[학습 불가: ...]` chunks 일부

### knowledge_chunks 테이블 schema
```
id, user_id, source_type, source_id, source_label, source_url, source_domain,
content, embedding (vector 1024), detected_price, detected_currency,
category, priority, expires_at, is_active, created_at
```

---

## 검증 도구

### Supabase MCP
프로젝트 ID: `ffozahaztbudvsnnkvep`
- chunks 상태 확인: `SELECT source_url, COUNT(*) FROM knowledge_chunks WHERE user_id = '...' GROUP BY source_url`
- 직접 insert / cleanup 가능

### Vercel MCP
- projectId: `prj_g5ZZAOgRzIni6dC5tEweHEnBYXNA`
- teamId: `team_x8Jd7ogFhipVsvvITOQJkurX`
- `get_runtime_logs` 로 함수 logs 확인 (단, message truncate 됨)
- `list_deployments` 로 deploy 상태

### 로컬 OCR 검증 (검증 완료, 작동함)
```bash
# repo root 에서
set -a && source .env.local && set +a
node ./script.mjs  # quickParse + ocrImages 직접 호출
```
- millimilli 347 에서 30번대 이미지 OCR → "₩27,000, 환불 정책" 정확히 추출 (`3791d7e` 검증)
- "그늘 건조" 정확히 추출 (`0a9d9d6` system prompt 강화 후)

### 환경 변수
`.env.local` (Vercel env 도 동일 — CLAUDE.md 참고)
- `ANTHROPIC_API_KEY` ✓
- `VOYAGE_API_KEY` ✓
- `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` ✓

---

## 다음 개발자 작업 순서

1. **Vercel logs 의 instance error full message 확보** — inspector UI 직접 보거나 raw stream
2. **Minimal sync-links 단계별 격리** — 위 "검증 안 한 단계 1" 참고
3. **Root cause 잡으면 fix**:
   - Voyage timeout 누락이면 → timeout 추가
   - chunker bug 면 → 수정
   - Vercel fluid compute 메모리면 → buffer 명시 해제 + concurrency 1
4. **Background queue 도입** (root cause fix 후 안정성 위해):
   - Inngest 추천 — free tier 충분, retry/observability 좋음
   - link 저장 → `inngest.send('learn/process-url', { url })`
   - worker 가 URL 1개씩 처리 (각 별도 function call)
5. **OCR 단계적 재투입**:
   - 우선 JSON-LD + 본문 텍스트 만 안정화
   - OCR 은 별도 worker (`/api/learn/ocr-page`) 로 분리
6. **검증**:
   - 새 가입자 onboarding flow 테스트
   - 모든 사용자 link 페이지 자동 임베딩 확인
   - 1주 모니터링

---

## 진행하지 말아야 할 것

- **사용자별 수동 chunks insert** — SaaS 아님. 한 번만 비상용
- **OCR 끄고 잊기** — 응대 품질 핵심 정보 (전성분·세탁법) 안 들어옴
- **추측만으로 fix 시도** — 이미 9번 시도해서 실패. root cause 격리 우선

---

## 관련 최근 커밋

```
c37cd4a 학습탭 sync-links 자동 호출 비활성화 — 500 표시 차단
83ed0c7 OCR 임시 비활성화 — sync-links 안정화 우선
806843b OCR 보수적 설정 — instance memory 안전
0a9d9d6 OCR 정확도 향상 — Haiku + 도메인 system prompt
3791d7e image-ocr fix — magic bytes 판별 + 불필요 이미지 필터 강화
2cce1e1 sync-links 무한루프 fix — fail URL placeholder mark
b7682c1 sync-links — batch 1 URL + OCR max 15장 (timeout 안전)
b5c3ba9 sync-links 배치 처리 — Vercel timeout 회피 + client loop
aa2287a sync-links 에러 진단 강화 — 전체 try/catch + detail 응답
3b09322 Phase 3 — 본문 이미지 OCR 추가 (Claude Haiku Vision)
```

---

## 본질 plan (참고)

```
[사용자가 내 링크 저장]
  ↓ POST /api/link
  ↓ DB 저장 + inngest.send('learn/process-url', { url }) — 큐에 job 추가
  ↓ 즉시 응답 (vercel function 30s 안에)
  ↓
[Inngest worker]
  ↓ URL 1개씩 처리 (각 별도 function call — vercel timeout 안전)
  ↓ STEP 1: quickParse (timeout 10s)
  ↓ STEP 2: JSON-LD → chunks insert (embedding=null OK)
  ↓ STEP 3: 본문 텍스트 → chunks insert
  ↓ STEP 4: OCR (이미지별 step, retry on fail)
  ↓
[학습탭]
  ↓ overview API 가 chunks 결과 표시
  ↓ polling 없이 사용자 다시 들어올 때 갱신됨
```

비용 추정 (베타 50명 × 30 URL onboarding):
- Voyage 임베딩: ~₩100 (텍스트 60k 토큰)
- Anthropic Vision (OCR): ~₩45만 (1,500장 × ₩3) — 비싸면 cap 가능
- Inngest free tier: 5만 step/월 — 충분 (50명 × 30URL × 5step = 7500)

총 ~₩45만 일회성, 모든 사용자 자동.
