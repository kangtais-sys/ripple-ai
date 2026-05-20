# 학습 큐 OOM 미해결 — Claude 채팅용 정리

> 작성: 2026-05-20
> 작성자: Claude Code (Opus 4.7)
> 상태: 시도한 fix 9가지 모두 실패. 근본 해결 필요.

---

## 서비스 컨텍스트

- **Ssobi**: K-뷰티 인플루언서용 AI 댓글·DM 자동 응대 SaaS
- **URL**: https://ssobi.ai (도메인)
- **인프라**: Vercel Pro (Functions 4GB / NODE_OPTIONS 4GB) + Supabase + Voyage AI 임베딩 + Firecrawl 크롤링
- **응대 품질 = 학습 자료 풍부함**. 학습 자료 안 쌓이면 자동 응대 무용지물.

---

## 막힌 문제

**증상**: `/api/cron/process-learn-queue` 가 매 cron 사이클(1분)마다 호출되는데, 한국 쇼핑몰 상세 페이지(특히 `millimilli.kr/product/detail.html?product_no=N`) 처리 시 lambda가 OOM으로 죽음.

**Vercel runtime log 메시지** (반복):
```
<--- Last few GCs --->
Node.js process exited with...
```

**증상 패턴**:
- cron 1번 도는데 한 URL을 30~60초 처리 시작 → 메모리 폭증 → V8 OOM → lambda kill → HTTP 500
- `learn_queue.status` 가 `processing`에 stuck → 다음 cron이 가져갈 수 없음 → 5분 stale-reset 로직이 풀어 또 시도 → 또 OOM
- `attempts=3` 도달 시 `blocked` 영구 마킹. 사용자 핵심 학습 자료 (millimilli 4개 상품) 학습 불가.

**처리 시도한 URL들**:
- ✅ `instagram.com/lala_lounge_/` — `upstream_403` (IG 봇 차단, 정상)
- ✅ `tiktok.com/@peerstory` — `upstream_403` (TikTok 봇 차단, 정상)
- ❌ `millimilli.kr/product/detail.html?product_no=27` (34, 35, 36) — OOM
- ❌ `lala-lounge.com/product/detail.html?product_no=164...` — OOM
- ❌ `youtube.com/@15초유민혜` — OOM
- ⚠️ `pf.kakao.com/_EFUCb/friend` — `firecrawl_500: SCRAPE_ALL_ENGINES_FAILED` (Firecrawl 자체 실패, OOM 아님)

---

## 시도한 fix 9가지 (시간순)

| # | 시도 | 결과 |
|---|---|---|
| 1 | OCR `concurrency: 4, max: 20` → `2, 10` 보수적 | OOM 계속 |
| 2 | `vercel.json functions` matcher `src/app/...` → memory 3008MB | 매처 패턴 안 먹음 ("vercel.json overrides ignored" 경고) |
| 3 | matcher `app/api/cron/...` 으로 다시 | 여전히 무시됨 |
| 4 | OCR 코드 자체 비활성화 (import 주석, 호출 제거) | OOM 계속 (OCR 외 원인) |
| 5 | Firecrawl `formats: ['markdown', 'html']` → `['markdown']` (html 제거) | OOM 계속 |
| 6 | Vercel 대시보드 Function CPU: Standard(1vCPU/2GB) → Performance(2vCPU/4GB) | OOM 계속 |
| 7 | `NODE_OPTIONS=--max-old-space-size=4096` env 추가 (V8 heap 4GB) | OOM 계속 — V8 heap 4GB로 늘렸는데도 |
| 8 | `cron stale-processing 5분 자동 reset + max-attempts → blocked` 로직 추가 | 회복은 되지만 처리는 안 됨 |
| 9 | 큐 재적재 방지 (sync-links, link route에서 모든 status 큐 항목 skip) | 잔여 버그 해결, OOM은 무관 |

---

## 현재 코드 상태

### 파일: `src/app/api/cron/process-learn-queue/route.ts`
```ts
export const maxDuration = 300

// 흐름:
// 1. learn_queue 에서 pending 1건 pickup → status='processing'
// 2. firecrawlScrape(url) — markdown only
// 3. storeKnowledge(markdown) → chunkText() → Voyage embed batch → DB insert
// 4. status='done'

// OCR 부분은 주석 처리 (별도 워커 분리 예정)
```

### Vercel 환경 (현재)
- Function CPU: **Performance** (2 vCPUs / **4 GB Memory**)
- env `NODE_OPTIONS=--max-old-space-size=4096`
- env `FIRECRAWL_API_KEY`, `VOYAGE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` 모두 정상 (직접 호출 검증 완료)

### 의존성
- `@supabase/supabase-js`
- `voyage-3-lite` 임베딩 (1024차원)
- Firecrawl v1 `/scrape` API

---

## 어디가 진짜 OOM 원인인지 모름

OCR 없애도, html 안 받아도, V8 heap 4GB로 늘려도 OOM. 의심:

1. **`storeKnowledge` 의 Voyage 임베딩 배치 호출**
   - markdown 한 페이지가 청크 수십~수백 개로 분할 (`chunkText` in `src/lib/kb/chunker.ts`)
   - `generateEmbeddingsBatch(chunks)` 가 한 번에 모든 청크 전송 (Voyage max 128)
   - 1024-dim × 128 chunks = 128K floats × 8 bytes ≈ 1 MB (이 정도면 문제 없어야)

2. **`Firecrawl markdown 응답이 거대한 경우`**
   - 한국 쇼핑몰 상세페이지 markdown이 200~500KB 가능
   - JSON.parse 시 string allocation 일시적 폭증

3. **`Next.js 16 + Turbopack 런타임 메모리 누수`**
   - 가능성 낮지만 가능

4. **`chunker.ts` 가 토큰 단위 분할 시 정규식 backtracking으로 메모리 폭증**
   - 가능성 있음 — chunker 코드 직접 점검 필요

---

## 다음 단계 후보 (Claude에게 물어볼 만한 것)

### 옵션 A: 별도 워커로 분리 (가장 근본적)
- **Inngest** 또는 **Trigger.dev** 같은 외부 작업 큐
- Vercel function은 큐 insert만, 워커가 메모리 큰 환경에서 처리
- 단점: 외부 의존 추가, 비용

### 옵션 B: 청크화 더 작게 + 임베딩 배치 분할
- `chunkText` 에서 한 페이지를 더 잘게 (max 500자 → 300자)
- 임베딩 batch를 128 → 32로 분할 → 메모리 점유 최소화
- 단점: API 호출 횟수 증가 (비용 약간)

### 옵션 C: cron 자체에서 한 페이지를 N개의 sub-tasks로 분할
- step 1: Firecrawl만 → markdown DB 임시 저장
- step 2: 다음 cron이 chunks 만들기
- step 3: 다음 cron이 임베딩만
- 각 단계 메모리 점유 ~1/3
- 단점: 한 페이지 처리에 3분 걸림 + 코드 복잡

### 옵션 D: heap snapshot 생성해서 진짜 메모리 누수 위치 추적
- Vercel function 안에서 v8.writeHeapSnapshot()
- 어디서 메모리 폭증하는지 정확히 알 수 있음

---

## 첨부 파일 (Claude에게 같이 보내면 좋음)

1. `src/app/api/cron/process-learn-queue/route.ts` (현재 cron 코드)
2. `src/lib/kb/store.ts` (storeKnowledge)
3. `src/lib/kb/chunker.ts` (chunkText)
4. `src/lib/kb/embedding.ts` (Voyage batch)
5. `src/lib/parsers/firecrawl.ts` (Firecrawl 호출)
6. `supabase/migrations/027_learn_queue.sql` (큐 테이블)

---

## 진단 명령 (Claude가 시키면 실행)

```bash
# 큐 현재 상태
psql ... -c "SELECT status, count(*) FROM learn_queue GROUP BY status"

# Vercel runtime logs
npx vercel logs ssobi.ai --json | grep process-learn-queue | tail -20

# 직접 cron 호출 (CRON_SECRET 필요)
curl -sS https://ssobi.ai/api/cron/process-learn-queue \
  -H "Authorization: Bearer $CRON_SECRET" -w "\nHTTP %{http_code}\n"

# millimilli 페이지 Firecrawl 직접 호출 (메모리 영향 격리 테스트)
curl -sS -X POST https://api.firecrawl.dev/v1/scrape \
  -H "Authorization: Bearer fc-..." -H "Content-Type: application/json" \
  -d '{"url":"https://millimilli.kr/product/detail.html?product_no=27","formats":["markdown"],"onlyMainContent":true}'
```

---

## 핵심 질문

**Vercel Pro Functions (Performance 4GB) + NODE_OPTIONS=4GB 환경에서, 한국 쇼핑몰 상세페이지 한 개를 Firecrawl markdown 크롤 + 텍스트 청크화 + Voyage 임베딩 + Supabase insert 하는 cron 함수가 V8 OOM(`<--- Last few GCs --->`)으로 죽는다. OCR 없음, html 안 받음, 청크화는 일반적 텍스트 분할. 어디가 메모리 누수인가? 또는 어떻게 분할/스트리밍 처리해야 하나?**
