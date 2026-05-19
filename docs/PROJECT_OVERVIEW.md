# Ssobi — 프로젝트 전체 컨텍스트 (2026-05-19 기준)

> 이 문서는 인계받는 사람 (Codex / 다른 Claude Code / 새 개발자) 이 무엇을 만드는지 즉시 이해할 수 있게 작성. 코드 디테일보다 **무엇을 / 누구를 위해 / 왜** 에 집중.

---

## 한 줄 요약

**Ssobi (쏘비)** = K-뷰티 인플루언서를 위한 **AI 댓글·DM 자동 응대 SaaS**. 인스타 댓글이 들어오면 사용자의 말투를 학습한 AI 가 알아서 답변. 사용자는 자고 있어도 24시간 응대 돌아감.

---

## 누구를 위한 서비스

**타겟 페르소나**:
- 인스타그램 K-뷰티 인플루언서 (팔로워 1만~50만)
- 본인 쇼핑몰 (Cafe24·자체 SPA) 운영
- 매일 100~1000 댓글·DM 받음
- 응대 못 따라가서 매출·관계 손실

**대표 사용자 (현재 베타)**:
- 유민혜 (MINE) — Millimilli / 0.8L 인플루언서 마케팅 플랫폼 대표
- 본인이 직접 사용 + 서비스 운영자

---

## 서비스 핵심 기능

### 1. AI 댓글·DM 자동 응대 (메인)
- Instagram Graph API 로 댓글·DM webhook 수신
- Claude API 가 **사용자 말투 + 학습된 자료** 로 답변 생성
- 자동 발송 (위험 메시지는 사람이 검수)

### 2. AI 말투 학습 (1회)
- 사용자 IG 게시물 캡션 25개 자동 fetch
- Claude Haiku 가 어조·종결어미·이모지 패턴 분석
- 모든 응대에 일관된 말투 적용

### 3. 자동 학습 자료 (가장 중요·미해결) 🔴
- 사용자가 "내 링크" 페이지에 제품 URL 등록
- 시스템이 자동으로 페이지 fetch → 가격·재고·전성분·세탁법 추출 → 임베딩
- 댓글에 "이 제품 가격 얼마예요?" 들어오면 정확히 답
- **여기가 막혀서 응대 품질 안 나옴**

### 4. 내 링크 (Linktree 대체)
- ssobi.ai/u/{handle} — 인플루언서용 랜딩 페이지
- 블록 14종 (히어로 캐러셀·제품 그리드·이벤트 배너 등)
- 블록 안 URL 이 곧 학습 자료 소스

### 5. 실시간 관리 탭
- 응대 통계, 긴급 알림, 주요 팔로워, 협업 제안
- 사람 개입 필요 시 알림

---

## 비즈니스 모델

**플랜** (`landing.html` PRICING = source of truth, `src/lib/plans.ts` 동기화):
- 베이직: ₩0/월 — 응대 300건, IG 1계정
- 프리미엄: ₩29,800/월 — 응대 6,600건, 3계정, 7일 무료 체험
- 프로페셔널: ₩69,800/월 — 무제한, 10계정

**베타 단계** (현재): 모든 가입자 PRO 권한 무료. 결제 미구현.

**손익**:
- Voyage 임베딩 ~₩0.02/M tokens
- Claude API (Haiku 4.5 / Sonnet 4.5)
- Vercel Pro (Functions 300s timeout, fluid compute)
- Supabase Pro
- 손익분기: 유료 가입자 ~18명

---

## 기술 스택

### 인프라
- **배포**: Vercel Pro (fluid compute, 300s function timeout)
- **DB**: Supabase Postgres + pgvector + RLS
- **도메인**: ssobi.ai

### 핵심 서비스
- **Next.js 16** App Router (Tailwind)
- **Claude API** — 응대 + 말투 학습 + Vision OCR (Haiku 4.5 / Sonnet 4.5)
- **Voyage AI** — voyage-3-lite (1024 dim 임베딩)
- **Meta Graph API** — IG OAuth + 댓글·DM 발송
- **Solapi** — 카카오 알림톡 (예정)
- **NicePay** — 한국 결제 (미구현, plans.ts 만)
- **Stripe** — 해외 결제 (미구현)

### 외부 자원
- **Supabase project**: `ffozahaztbudvsnnkvep` (`https://ffozahaztbudvsnnkvep.supabase.co`)
- **Meta 앱**: Repli (앱 ID 973683215179192, IG 앱 ID 1746122143490239)
- **Google OAuth**: ID `998424366713-vfl2264...`

---

## 코드 구조 (핵심만)

```
src/app/
├── page.tsx                    → /app.html redirect
├── api/
│   ├── auth/                   Supabase + Google + Kakao 인증
│   ├── webhook/instagram/      🔥 댓글·DM 수신 → Claude 응대 → IG 발송
│   ├── tone/                   AI 말투 학습 (fetch-posts + learn)
│   ├── learn/                  학습 자료 관리 (지금 막힌 곳)
│   │   ├── overview            카드 통합 fetch
│   │   ├── detail              개별 학습 자료 chunks 표시
│   │   ├── url                 사용자가 URL 직접 학습 (학습탭 채팅)
│   │   ├── sync-links          🔴 link_pages 의 모든 URL 자동 임베딩 (500 떠서 막힘)
│   │   └── ...
│   ├── link/                   내 링크 (Linktree) — 블록 저장 + 자동 임베딩 hook
│   ├── home/dashboard          홈 KPI 데이터
│   └── ...

src/lib/
├── kb/
│   ├── store.ts                🔥 chunks 저장 (chunker + Voyage embedding + Supabase)
│   ├── embedding.ts            Voyage AI client (⚠️ timeout 없음)
│   ├── chunker.ts              텍스트 → chunks 분할
│   └── image-ocr.ts            🔥 Claude Vision OCR (배포 환경에서 실패)
├── parsers/
│   ├── quick.ts                HTML fetch + JSON-LD/OG + 본문 이미지 URL 추출
│   └── linkbio.ts              Linktree·infolink 마이그레이션
└── supabase/                   client·server·middleware

public/
└── app.html                    ~19,000줄 SPA (해시 라우팅, i18n, 모든 UI)

supabase/migrations/             001~xxx 스키마 변경
docs/                            인계 문서 위치
```

---

## DB 핵심 테이블

| 테이블 | 역할 |
|---|---|
| `profiles` | 사용자 정보 (plan, beta, ig_handle, link_handle 등) |
| `ig_accounts` | 인스타 OAuth 토큰 + ig_username |
| `tone_profiles` | 학습된 말투 (learned_style JSON, brand_context, banned_words) |
| `knowledge_chunks` | **🔥 학습 자료 chunks (content + vector 1024 embedding + source_url + source_label)** |
| `urgent_contexts` | 긴급 공지 (24h 우선 적용) |
| `link_pages` | 내 링크 (handle, blocks JSONB, hero·theme·settings) |
| `link_blocks` (블록 안에) | type=link/event/bigbanner/grid/quicklinks/socials/section/spacer 등 14종 |
| `short_links` | ssobi.ai/s/{code} 단축 + 클릭 통계 |
| `reply_logs` / `fan_profiles` / `conversations` | 응대 이력 + 팬 분류 |
| `usage_logs` | 월별 응대 카운트 (한도 체크) |

---

## 사용자 흐름 (이상적)

```
1. ssobi.ai 가입 (이메일/Google/Kakao)
   ↓
2. 인스타그램 OAuth 연동
   ↓
3. ⏱️ 자동 (1분):
   - IG 게시물 25개 fetch → Claude 가 말투 학습
   - 사용자 본인 쇼핑몰 URL 1~2개 묻고 → 자동 임베딩
   ↓
4. 내 링크 페이지 만들기 (블록 추가)
   ↓ 블록 저장 시 자동 hook
5. 🔴 [지금 안 됨] 모든 URL 자동 임베딩
   - quickParse → JSON-LD/OG 텍스트 → chunks
   - 본문 이미지 → Claude Vision OCR → chunks
   ↓
6. 댓글·DM 들어오면:
   - Claude 가 학습된 말투 + chunks 검색 (벡터 유사도) → 답변 생성
   - 자동 발송 또는 사람 검수
   ↓
7. 사용자는 학습탭에서 결과 확인:
   - 각 링크 카드 = "외운 게 N개 기억"
   - 클릭하면 외운 텍스트 미리보기
```

---

## 학습 자동화가 막힌 이유 (인계 핵심)

응대 품질의 95% 가 **학습 자료 풍부함** 에 달림. 자료 없으면 AI 는 "구매해주셔서 감사합니다" 만 반복.

**현재 막힌 곳**:
- `POST /api/learn/sync-links` → Vercel runtime 500 (Runtime Error: insta...)
- `embedLinkBlocksBackground` (link 저장 hook) → fire-and-forget → Vercel 응답 후 process 죽음 의심
- 결과: 사용자가 내 링크에 제품 12개 추가해도 chunks 0개. 응대 불가

**임시 처리**:
- 사용자 본인 (kangtais@naver.com) chunks 5개 직접 supabase insert
- SaaS 가 아닌 1회용 처방. 다른 사용자에겐 해결 안 됨

상세: `docs/handoff-2026-05-19-learn-ocr.md` 참고

---

## 작동 중인 기능

| 기능 | 상태 |
|---|---|
| 가입 + 로그인 (Email/Google/Kakao) | ✓ |
| IG OAuth 연동 | ✓ |
| AI 말투 학습 (자동 trigger) | ✓ (~21초, Haiku) |
| 내 링크 페이지 (블록 14종) | ✓ |
| 학습탭 UI (카드·디테일 모달) | ✓ |
| `/api/learn/overview` (학습 자료 목록) | ✓ |
| `/api/learn/detail` (각 자료 chunks) | ✓ |
| Webhook (댓글·DM 수신) | ✓ (응대 품질은 chunks 의존) |
| 홈 대시보드 (Day1 / ROI 분기) | ✓ |
| i18n KO/EN | ✓ |

---

## 핵심 작업 우선순위 (다음 개발자)

1. **🔴 학습 자동화 fix** (`docs/handoff-2026-05-19-learn-ocr.md`)
   - Vercel runtime 500 root cause 격리
   - Background queue (Inngest 추천) 도입
   - OCR 단계적 재투입

2. 🟡 결제 시스템 (NicePay + Stripe)
   - 현재 베타 무료 단계. 곧 유료 전환 필요
   - `src/lib/plans.ts` 4단계 매핑 완료. 결제 핸들러 미구현

3. 🟡 메타 검수 (Tester accept + webhook subscription)
   - Instagram 권한 검수 진행 중

4. 🟢 안정화
   - 일일 리포트 cron (in_progress)
   - 모니터링 / 알림

---

## 주요 환경 변수 (Vercel Pro)

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_META_APP_ID
META_APP_ID / META_APP_SECRET
ANTHROPIC_API_KEY
VOYAGE_API_KEY
NEXT_PUBLIC_APP_URL = https://ssobi.ai
WEBHOOK_VERIFY_TOKEN = repli_webhook_2026
GOOGLE_OAUTH_CLIENT_ID / SECRET
YOUTUBE_API_KEY
CRON_SECRET
```

---

## 작업 시 주의사항

- **Vercel Pro 사용 중** — Function maxDuration 300s, fluid compute 활성
- **CLAUDE.md 의 작업 원칙** 준수: legacy 파일 직접 복사, 새로 디자인하지 않음, 기능 코드만 추가
- **legacy/repli_v3.html** = 최종 확정 UI (참고 only, 수정 금지)
- **public/app.html** = 실 사용 앱 (legacy 이식 + Supabase 통합)
- **landing.html PRICING** = source of truth. 가격·한도 수정 시 동기화 순서: landing.html → plans.ts → app.html 체크아웃
- env 변수 추가 시 `printf` (echo 는 \n 포함)
- Webhook 은 production env 에서만 동작
- RLS 활성, webhook 은 service_role_key 사용
- 디자인 결정 시 `/Users/yuminhye/Downloads/design_handoff_ssobi_v2/` 의 Claude 디자인 핸드오프 참고

---

## 관련 외부 자원

- **GitHub**: kangtais-sys/ripple-ai (main branch 자동 배포)
- **Supabase**: https://ffozahaztbudvsnnkvep.supabase.co
- **Vercel project**: prj_g5ZZAOgRzIni6dC5tEweHEnBYXNA / team_x8Jd7ogFhipVsvvITOQJkurX
- **MILLI AI**: https://mine-ai-team.vercel.app (별개 프로젝트, 동일 운영자)

---

## 인계 받은 사람 즉시 할 일

1. **이 문서 끝까지 읽기** (10분)
2. **`docs/handoff-2026-05-19-learn-ocr.md` 읽기** (10분) — 막힌 핵심 문제
3. **CLAUDE.md 읽기** (5분) — 작업 원칙
4. **Supabase MCP + Vercel MCP 연결 확인**
5. **Minimal sync-links 단계별 격리** 부터 시작 — root cause 찾기

질문 있으면 사용자 (kangtais@naver.com / @yuminhye) 에게 직접.
