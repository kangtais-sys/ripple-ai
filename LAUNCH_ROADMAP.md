# Ssobi Production Launch — 전체 로드맵

**작성일**: 2026-05-06
**기준 시점**: Meta App Review 재제출 직후 (commit `379584f`)
**예상 정식 launch**: D+50 (~2026-06-25)

---

## 📍 현재 위치

```
[D-Day 오늘]                                   [D+30 베타 launch]
   ▼                                                   ▼
┌──────────────────────────────────────────────────────────────┐
│ Phase 1   │ Phase 2     │ Phase 3        │ Phase 4         │
│ 검수 대기  │ 검수 통과    │ 베타 launch    │ 다채널 + 결제    │
│ (~3일)     │ (1~2일)     │ 준비 (3~5일)    │ 확장 (1~2주)    │
└──────────────────────────────────────────────────────────────┘
```

---

## 🟢 완료한 것 (~2026-05-06)

| 항목 | 커밋 | 메모 |
|---|---|---|
| Meta 검수 영상 5개 녹화·편집·자막·제출 | — | @millimilli.kr 자산 사용 |
| Submission Notes + Use Cases 5개 | `379584f` | Track A/B 구조, dual simulation 명시 |
| Test Event mismatch 영문 분류 fix | `bda2165` | classifyText 영어 키워드 추가 |
| 자동 응대 토글 auth fix | `31dcf8e` | Bearer 토큰 + credentials |
| 로그아웃 시 영어 유지 + 인사이트 카드 i18n | `86915ff` | doLogout localStorage 보존 |

---

## 📍 Phase 1 — Meta 검수 대기 중 (~3일)

### 오늘 (3시간) — Quick Win + mirra 백엔드

**A. Quick Win (1시간)**
1. 홈 인사이트 localStorage 캐시 + stale-while-revalidate (30m)
2. 발행 모달 닫기 가능 (백엔드 변경 X, 프론트만) (30m)

**B. mirra 백엔드 (2시간) — 검수 무관**
3. Tavily 기반 일일 cron pivot (RSS fallback 유지) (1h)
4. 풀 5 → 10, 개인화 3 → 15 (20m)
5. Tavily query 4 → 6 (cron + trends/more) (20m)
6. Multi-source per topic (1 → 2~3) (30m)
7. 키워드 회전 + 시간 한정자 ("이번 주" 등) (30m)
8. 배포 후 cron 수동 1회 발사 (5m)

### 내일~ (6~10시간) — 내 링크 Production-Ready

**P1: 내 링크 (검수 무관, 별개 영역)**
- 핸들 DB 영속화 (현재 데모 hardcoded)
- 블록 데이터 Supabase 저장 (localStorage → DB)
- 이미지 업로드 (히어로·매거진 블록)
- `ssobi.ai/u/<handle>` 동적 라우팅
- 숏링크 (`ssobi.ai/s/<6chars>`)
- **유민혜 본인 dogfooding** 시작 (IG 바이오에 링크 박기)

### 백그라운드
- Meta App Review 응답 매일 1회 확인 → https://developers.facebook.com/apps/973683215179192/app-review/permissions/
- dogfooding 페인 포인트 즉시 알려주면 즉시 fix

---

## 📍 Phase 2 — Meta 통과 직후 (1~2일)

### 통과 즉시 (1.5시간) — 프론트 폴리시
- 자유 검색 backend `/api/trends/search` (30m)
- 자유 검색 UI — mirra 스타일 8개 토픽 리스트 (1h)
- 출처 chip 카드 노출 (vogue·reddit·tiktok 라벨)
- body_preview 카드 하단 1줄 노출

### 카드뉴스 보강 (5~7시간)
- 비율 추가: 1:1 (정사각), 9:16 (스토리), 4:3 (1h)
- 템플릿 6종 추가: magazine / retro / kbeauty / minimalist / boldcolor / notebook (4~6h)
- 각 비율 × 템플릿 매트릭스 검증

### Live Mode 전환
- Meta Dashboard → Live Mode toggle
- 이제 일반 IG 유저도 OAuth 가능
- **이 시점부터 진짜 webhook 트래픽 수신 시작**

### 발행 UX 개선 (3~4시간)
- `/api/publish/instagram` 백그라운드 처리
- 클릭 즉시 success → 백그라운드 큐잉 → 완료 시 알림
- "내 게시물" 상태 추적 화면

---

## 📍 Phase 3 — 베타 Launch 준비 (3~5일)

### 베타 유저 모집 (1일)
- 랜딩 페이지 CTA 검토
- 이메일 수집 폼 동작 확인
- 첫 5~10명 핸드픽 (지인·블로거·팔로워)
- 카카오톡·이메일로 초대장

### 결제 통합 — PortOne (2~3일)
**필요 서류**:
- 사업자등록증 (공팔리터글로벌)
- 통신판매업 신고증
- 정산 계좌

**작업**:
- PortOne 가입 + 심사 (1주 소요)
- API 키 세팅
- 기존 `/api/payment/subscribe` 코드 연결 (이미 골격 있음)
- 결제 플로우 테스트

**현실**: 베타 유저는 무료 플랜이라 Phase 3 에서 결제 없어도 OK. 첫 유료 전환 시점 (Phase 4 후반) 까지 여유 있음.

### 알림톡 — Solapi (1~2일)
**가입**:
- Solapi 사업자 가입
- 카카오톡 채널 (Ssobi 공식) 개설
- 알림톡 템플릿 등록 (구독 시작·결제 실패·한도 임박)

**작업**:
- Solapi API 키 세팅
- `src/lib/notify.ts` (이미 있음) 에 Solapi SDK 연결
- 발송 테스트

**우선순위**: 베타 launch 함께 시작. 이메일만으로도 가능하지만 알림톡이 K-MZ 한국 유저한테 훨씬 잘 닿음.

### 어드민 대시보드 (옵션, 1~2일)
- 가입자 모니터링
- AI 사용량 추적
- 한도 알림

---

## 📍 Phase 4 — 다채널 확장 (1~2주)

### YouTube 통합 (3~5일) — 가치 큼
- YouTube Data API v3 키 (이미 `YOUTUBE_API_KEY` 환경변수 있음)
- OAuth 통합 (Google Login)
- 댓글 답글 자동화 (✅ API 지원)
- 업로드 감지 (✅ Webhooks)
- **승인 절차**: Google Cloud Console → OAuth verification → audit (2~4주 소요)

### TikTok 통합 (1주) — 부분적 가치
- TikTok Login API 통합
- 게시물 업로드 감지 가능 (Webhooks)
- ❌ 댓글 답글 API 없음 → 자동 응대 X
- 업로드 감지로만 활용 (성과 분석)
- **승인 절차**: TikTok Developer Portal → app review

### 베타 피드백 → 우선순위 재조정
- 첫 10~20명 사용 데이터 분석
- 제일 자주 막히는 부분 → 즉시 fix
- 안 쓰는 기능 → 정리

---

## 💰 비용 시뮬레이션 (월 기준)

| 항목 | Phase 1~2 | Phase 3 (베타 30명) | Phase 4 (100명) |
|---|---|---|---|
| Vercel | $0 (Hobby) | $20 (Pro) | $20 |
| Supabase | $0 (Free) | $25 (Pro) | $25 |
| Anthropic | ~$15 | ~$60 | ~$200 |
| Tavily | $3.5 | $10 | $30 |
| Solapi 알림톡 | $0 | ~$5 | ~$15 |
| YouTube API | $0 (free) | $0 | $0 |
| TikTok API | $0 (free) | $0 | $0 |
| **총** | **~$20** | **~$120** | **~$290** |

---

## ⚠️ 결정·확인 필요 사항

### 1. PortOne 가입 시점
- **추천**: Phase 3 시작 시점 (베타 모집과 동시). 심사 1주 걸림.
- 베타 launch 직전엔 결제 페이지 띄워두고 무료 플랜 자동 가입.

### 2. 카카오톡 채널명
- **추천**: `Ssobi 공식` 또는 `Ssobi Notify`
- Solapi 가입 후 채널 개설 → 알림톡 템플릿 신청 (3~5일)

### 3. TikTok 통합 우선순위
- 댓글 답글 X → 핵심 기능 작동 안 함
- **추천**: 정식 launch 후로 미루기 (Phase 4 후반). 베타에는 IG + YouTube 만.

### 4. YouTube 통합 시점
- 베타 유저 5~10명 운영하면서 IG 검증 → YouTube 추가하면 churn ↓
- **추천**: Phase 4 초중반 (베타 시작 후 2주 뒤)

---

## 🔍 빠진 거 — 추가 검토

### A. 약관·개인정보 처리방침
- 현재 `legacy/repli_terms.html` 있음 — 베타 launch 전에 ssobi.ai 도메인·서비스명으로 업데이트 필요
- Meta 검수 제출 시 사용한 URL 확인 필요 (이 문서 끝 부분 참조)

### B. 도메인 이메일
- `support@ssobi.ai` 같은 customer-facing 이메일 (Naver Workspace · Google Workspace)
- 베타 유저 문의 채널

### C. 분석·로깅
- PostHog 또는 Vercel Analytics
- 어떤 기능 자주 쓰는지 추적 (베타 데이터)
- 비용 거의 무료

### D. 백업 전략
- Supabase 자동 백업 (Pro 플랜 7일 보관)
- 중요한 거: 유저 데이터·tone profile·내 링크 블록

### E. 모바일 PWA
- 현재 `public/app.html` 은 모바일 반응형이지만 PWA 아님
- 홈 화면 추가 (Add to Home Screen) 시 앱처럼 동작
- Phase 4 또는 그 이후

---

## 🎯 한 줄 요약

**오늘 mirra 백엔드 + 홈/발행 fix 끝나면 → 내일부터 내 링크 production → 검수 통과 시 프론트 폴리시 + 카드뉴스 보강 → 베타 모집 + PortOne/Solapi → YouTube → TikTok → 정식 launch**

전체 ~D+50일 안에 정식 launch 가능.

---

## 📝 변경 이력
- 2026-05-06: 초안 작성. Meta 검수 재제출 직후. 옵션 2 (Quick Win + mirra 백엔드) 채택.
