# Repli. 프로젝트 컨텍스트

## 서비스 개요
- **서비스명**: Repli.
- **회사**: (주)공팔리터글로벌
- **대상**: K-뷰티 인플루언서의 SNS 자동 관리 SaaS
- **GitHub**: https://github.com/kangtais-sys/ripple-ai
- **배포 URL**: https://ssobi.ai
- **랜딩**: legacy/repli_landing.html
- **앱 프로토타입**: legacy/repli_v3.html

## 파일 구조
```
public/
└── app.html                        메인 앱 (repli_v3.html + Supabase 인증)
src/app/
├── page.tsx                        루트 → /app.html 리다이렉트
├── login/page.tsx                  → /app.html#login 리다이렉트
├── signup/page.tsx                 → /app.html#signup 리다이렉트
├── dashboard/
│   ├── layout.tsx                  빈 레이아웃 (app.html이 메인)
│   ├── page.tsx                    세션 체크 → app.html 이동
│   ├── connect/page.tsx            (Next.js 버전, 현재 미사용)
│   ├── tone/page.tsx               (Next.js 버전, 현재 미사용)
│   ├── logs/page.tsx               (Next.js 버전, 현재 미사용)
│   ├── plan/page.tsx               (Next.js 버전, 현재 미사용)
│   └── profile/page.tsx            (Next.js 버전, 현재 미사용)
└── api/
    ├── auth/callback/route.ts      Supabase 이메일인증 + Google OAuth 콜백
    ├── auth/instagram/callback/route.ts   IG OAuth 콜백 (토큰→저장)
    ├── auth/signout/route.ts       로그아웃
    ├── dashboard/route.ts          홈 실데이터 (플랜/사용량/ROI)
    ├── replies/route.ts            응대 내역 페이지네이션
    ├── tone/learn/route.ts         Claude 말투 분석 + Supabase 저장
    ├── tone/fetch-posts/route.ts   IG 게시물 캡션 자동 수집
    ├── webhook/instagram/route.ts  Webhook (댓글/DM→Claude→발송)
    ├── payment/subscribe/route.ts  포트원 결제 + 플랜 업그레이드
    ├── payment/webhook/route.ts    결제 실패→다운그레이드
    ├── notify/route.ts             한도 임박 알림
    └── cron/refresh-ig-token/route.ts  IG 토큰 자동 갱신 (매주)
src/lib/
├── supabase/client.ts              브라우저용
├── supabase/server.ts              서버용
├── supabase/middleware.ts          세션 갱신
└── plans.ts                        플랜별 한도/가격 정의
supabase/migrations/                DB 마이그레이션 (001~003)
legacy/                             HTML 원본 (절대 수정 금지)
vercel.json                         cron 설정
```

## 기술 스택
- **Next.js 16** (App Router) + Tailwind CSS
- **Supabase** (Auth + Postgres + RLS)
- **Vercel** 배포
- **Claude API** (말투 학습 + 댓글/DM 응대)
- **Meta Graph API** (Instagram OAuth + 댓글/DM)

## 디자인 시스템
- **폰트**: Pretendard (Google Fonts)
- **메인 컬러**: `#00C896` (민트), `#1A1F27` (다크)
- **서브 컬러**: `#FF4D4D` (레드), `#F9FAFB` (소프트배경)

## Supabase
- **Project URL**: https://ffozahaztbudvsnnkvep.supabase.co
- **테이블**: profiles, ig_accounts, tone_profiles, usage_logs, reply_logs
- **RLS**: 모든 테이블 활성화 (유저는 자기 데이터만 접근)
- **트리거**: auth.users INSERT → profiles 자동 생성
- **RPC**: increment_usage (webhook에서 사용량 카운트)

## Meta 앱
- **앱 이름**: Repli
- **앱 ID**: 973683215179192
- **Instagram 앱 ID**: 1746122143490239
- **권한**: instagram_business_basic / instagram_manage_comments / instagram_business_manage_messages
- **Webhook URL**: https://ssobi.ai/api/webhook/instagram
- **Webhook Verify Token**: repli_webhook_2026
- **IG OAuth Redirect URI**: https://ssobi.ai/api/auth/instagram/callback
- **Webhook 등록 완료**: comments, messages 구독

## Google OAuth
- **Client ID**: 998424366713-vfl2264fvi0oeuijisjm0ji2v3i5cc09.apps.googleusercontent.com
- **Redirect URI**: https://ffozahaztbudvsnnkvep.supabase.co/auth/v1/callback
- **Supabase Google Provider**: 활성화 완료

## 앱 구조 (public/app.html)
- repli_v3.html 100% 이식 + Supabase JS CDN 주입
- 인증: doSignup(), doLogin(), doGoogleLogin(), doLogout(), doResetPassword()
- 해시 라우팅: /app.html#signup, #login
- 말투 학습: startLearnAnim() → /api/tone/fetch-posts → /api/tone/learn (실제 Claude 분석)
- IG 연동: connectIG() → Meta OAuth → /api/auth/instagram/callback
- 탭바: 홈/소셜활동/관리/톡으로받기/내정보 (온보딩/가입/로그인 시 자동 숨김)

## Vercel 환경변수
- NEXT_PUBLIC_SUPABASE_URL ✅
- NEXT_PUBLIC_SUPABASE_ANON_KEY ✅
- SUPABASE_SERVICE_ROLE_KEY ✅
- NEXT_PUBLIC_META_APP_ID ✅
- META_APP_ID ✅
- META_APP_SECRET ✅
- ANTHROPIC_API_KEY ✅
- NEXT_PUBLIC_APP_URL ✅
- WEBHOOK_VERIFY_TOKEN ✅
- GOOGLE_OAUTH_CLIENT_ID ✅
- GOOGLE_OAUTH_CLIENT_SECRET ✅
- YOUTUBE_API_KEY ✅
- CRON_SECRET ✅

## API 검증 결과 (2026년 4월 기준)
| 기능 | Instagram | TikTok | YouTube |
|---|---|---|---|
| 댓글 답글 | ✅ | ❌ API 없음 | ✅ |
| DM 자동 응대 | ✅ 24h 윈도우 | ❌ | ❌ |
| 게시물 업로드 감지 | ✅ Webhooks | ✅ Webhooks | ✅ |

## 가격 구조 (2026-04 · landing.html PRICING = source of truth)
| 플랜 | 응대 한도 | 계정 수 | 가격 |
|---|---|---|---|
| 베이직 | 300건/월 | 1개 | ₩0 (평생 무료) |
| 프리미엄 | 6,600건/월 | 3개 | ₩29,800 / 월 (7일 무료 체험) |
| 프로페셔널 | 무제한 | 10개 | ₩69,800 / 월 |

- DB enum `profiles.plan`: `free | basic | premium | business` 유지 (migration 회피)
  - `free`·`basic` 둘 다 '베이직'으로 표기
  - `business` 슬롯은 '프로페셔널' 로 표기 (추후 4단계 '비즈니스' 복귀 시 재사용)
- 가격·한도 수정 시: `landing.html` → `src/lib/plans.ts` → `app.html` 체크아웃 모달 순서로 동기화

## 병렬 트랙 스케줄

### 트랙 A — 검수/인증
- [x] Meta 앱 등록 완료
- [x] Instagram 권한 3개 추가
- [x] millimilli 테스터 등록
- [ ] 공팔리터글로벌 비즈니스 인증 (3~5일 대기)
- [ ] 앱 검수 신청 (인증 완료 후)

### 트랙 B — 백엔드 개발
- [x] Next.js 프로젝트 생성 + Vercel 배포
- [x] Supabase 프로젝트 생성 + DB 스키마 (5테이블 + RLS + 트리거)
- [x] 이메일 가입/로그인 + Google OAuth
- [x] Instagram OAuth 연동 (/api/auth/instagram/callback)
- [x] Webhook 엔드포인트 (댓글/DM 감지 → Claude 응대 → Instagram 발송)
- [x] Webhook 검증 테스트 통과
- [x] Meta Webhook 등록 완료 (comments, messages 구독)
- [x] Claude 말투 학습 — IG 게시물 자동 수집 + Claude 분석 + 수동 입력 fallback
- [x] DM 자동 응대 (Webhook → Claude → Instagram Send API)
- [x] 대시보드 실데이터 API (/api/dashboard, /api/replies)
- [x] 플랜별 한도 체크 (Webhook에서 자동 스킵)
- [x] 포트원 구독 결제 API (/api/payment/subscribe + webhook)
- [x] 카카오 알림톡 함수 (구독 완료 시 발송)
- [x] IG 토큰 자동 갱신 cron (매주 월요일)
- [x] repli_v3.html 100% Next.js 이식 (public/app.html + Supabase 인증)
- [x] 전체 플로우 테스트 (Playwright): 홈/탭바/로그아웃/온보딩 정상 확인
- [x] 온보딩/로그인/가입 화면에서 탭바 자동 숨김
- [ ] 포트원 가입 + API 키 세팅
- [ ] 카카오 알림톡 채널 세팅 (솔라피 추천)
- [ ] 베타 유저 초대 (이메일 수집)

### 트랙 C — 마케팅
- [ ] 포트원 가입
- [ ] 베타 유저 20~30명 모집
- [ ] 유료 전환 오픈

## 작업 시 주의사항
- env 변수 추가 시 `printf` 사용 (`echo`는 \n 포함됨)
- Webhook은 production env에서만 동작
- RLS가 켜져 있으므로 webhook에서는 service_role_key 사용

## Claude Code 작업 원칙 (필수 준수)

### UI/디자인 작업 규칙
- **절대 새로 디자인하지 말 것**
- `/legacy/repli_v3.html` 이 파일이 최종 확정 디자인
- HTML/CSS 수정 시 반드시 이 파일을 직접 읽어서 복사
- "참고해서 만들어줘" = 틀림 / "이 파일 그대로 복사해줘" = 맞음

### Claude Code에 지시할 때 원칙
- 디자인: "파일을 직접 읽어서 HTML/CSS 100% 그대로 복사"
- 기능: "Supabase/API 연동만 붙이고 나머지는 HTML 그대로"
- 탭바: 홈/소셜 활동/관리/톡으로 받기/내 정보 (5개, 원본 그대로)
- 새로 만들지 말 것, 재해석하지 말 것

### 파일 위치
- 최종 앱 디자인: ~/ripple-ai/legacy/repli_v3.html
- 랜딩페이지: ~/ripple-ai/legacy/repli_landing.html
- 약관: ~/ripple-ai/legacy/repli_terms.html

---

## 2026-04-19 세션 업데이트 (Ssobi v2)

### 탭 구조 변경
- 기존 `홈 / 키우기 / 만들기 / 관리 / 내정보` (5탭)
- **신규** `홈 / 키우기 / 만들기 / 내 링크 / 내정보` (5탭)
- 관리는 키우기 탭 안에 서브탭(실시간 관리)으로 편입

### 키우기 탭
- 상단 **underline C안 서브탭** (SNS 자동화 / 실시간 관리 3)
- 하단 나브바 그대로 유지, 실시간 관리는 v-manage 뷰로 점프
- `proof-banner` (N명 사용 중) 두 서브에 공통 노출
- 댓글 감지 DM: "N개 활성" 대신 "목록 더보기 → m-dm-all" 모달
- 대상 게시물 썸네일 클릭 시 선택 + 설정 팝업(m-dm-rule) 함께 오픈

### 만들기 탭
- "처음이면 여기부터" → 얇은 pill 바 (proof-banner 크기 맞춤), m-discover 모달
- "FOR YOU · 유민혜님께 딱 맞는 오늘 주제" 섹션 (수직 리스트)
- 캐러셀 → 수직 스택 (3개 trend 카드)
- 카드뉴스 프롬프트 (cs-2) 인라인 편집: hook/body/caption contenteditable,
  [수정][적용][다시 생성] 3-버튼

### 내 링크 탭 (에디토리얼 블록 에디터)
- 상단 미니 topbar (뒤로 / ssobi.ai/u/핸들 / 공유)
- 하단 floating toolbar: 테마 / 블록 추가 / 설정 (3개)
- 블록 타입 14종 (hero 캐러셀 / event / countdown / section / grid / bigbanner
  / contact / magazine / link / image / quicklinks / socials / spacer / divider)
- 각 블록 DnD 재배치 (HTML5 drag), 제품 카드는 내부 DnD까지
- "꾸미기" 통합 패널 (글자색 · 배경 단색 · 배경 그라디 · 배경 이미지)
  - 스펙트럼(input type=color) 기반 원형 컬러닷
  - 그라디: 시작색 / 방향 select(↘↓→↗⊙) / 끝색
- 리치 텍스트 제목 편집 (B·I, Enter→<br>)
- 히어로 캐러셀: 여러 배너 좌우 스와이프, 슬라이드별 bg 이미지/텍스트 편집
  - 스탯(팔로워·공구남음)/CTA 클릭 시 편집/삭제 팝업 메뉴
- See all / Read more → 서브뷰 (모달 아님, 페이지 내부 전환)
  - 원본 섹션 제목 Fraunces 세리프 그대로 끌고 가서 렌더
- 자동 숏링크: 각 링크 블록마다 `ssobi.ai/s/[6자리]` 생성 (설정에서 자동 생성 토글)
- 테마 시트:
  - 3종 레이아웃 시작점 (미니멀 / 쇼핑몰 / 에디토리얼)
  - 페이지 꾸미기 (배경 그라디 + 단색 + 기본 글자색 + 제목 색)
  - 제목 폰트 / 본문 폰트 (Pretendard / Fraunces / Noto / Nanum Myeongjo / IBM / JetBrains)
- 설정 시트: 핸들 (prefix 고정, 3자 이상, 중복체크 debounce 400ms)
- 공유 시트: 핸들별 복사, IG/TK/YT/기타 분기
- 제안하기: 방문자 폼 → localStorage 저장 (추후 수익제안 탭 연동 예정)
- 첫날 모드 최초 진입 시 welcome 모달
  ("링크트리가 아니라 내 사이트처럼 · 내 스타일대로 꾸미는 나만의 링크 페이지")
- **프리미엄 게이팅**: 첫날 모드 = 전체 해금, 이후
  - 프리미엄 전용 블록: 카운트다운 · 제품 그리드 · 빅 배너 · 매거진
  - 프리미엄 전용 템플릿: 쇼핑몰 · 에디토리얼
  - 잠긴 카드 탭 → m-plan 업셀 오픈

### 내정보 탭
- 카카오톡 카드 제거 → 설정 메뉴 "카카오톡으로 알림 받기" 노란 강조 (mitem-kakao)
- 프로필 아바타 제거 + 중복 plan chip 제거
- 프리미엄 업셀 **앰버 sparkle 슬림 배너**:
  `✦ 프리미엄 전환 시 · 포인트 계산 없이 무한 혜택 →`

### 홈 탭
- ROI 날짜 `2026년 4월 17일` → `4. 17` 간소화
- 섹션 `sec-eye` eyebrow 시스템 (LIVE / AUTOMATION / FOR YOU)
- 캘린더 5종 (AI 댓글 / AI DM / 팔로워 / 업로드 / 예약)

### 첫날 모드 플로우
- 3단계 체크리스트 (SNS 연동 / AI 말투 / 참고 계정)
- 참고 계정 "확인 완료 · 적용하기" → 다크 pill 토스트:
  `✓ 참고 계정·해시태그가 AI 말투 학습에 반영됐어요`
- 3단계 완료 시 축하 모달 → 홈으로 자동 이동
- 내 링크는 첫날도 활성 (연동 불필요), 첫 진입 시 welcome 모달

### 브랜딩
- 로고: Fraunces italic `.logo.brand` 변형만 (일반 `.logo`는 Pretendard 유지)
- 앱 hdr 탭 제목 (키우기/만들기/내정보)은 Pretendard 유지 (브랜드 아님)
- `Ssobi<em>.</em>` 표기, em = mint (`#00C896`)
- 랜딩 nav/footer 동일 적용

### 폰트 전략
- 주요 UI: Pretendard
- 에디토리얼 악센트: Fraunces italic (히어로/매거진 타이틀 / 영어 em)
- 기술 label: JetBrains Mono (URL, 짧은 코드)
- 한글 폴백 체인: `Fraunces,Pretendard,Noto Sans KR,sans-serif` → 영어만 Fraunces, 한글 자동 Pretendard

### 채널 아이콘 (.ch-av)
- Instagram: 핑크 배경 + 흰 카메라 SVG (그라디언트 #FEDA75 → #4F5BD5)
- TikTok: 블랙 + 흰 music note SVG
- YouTube: 레드 + 흰 play triangle SVG
- DM: 블루 + 흰 chat bubble SVG
- 모든 알파벳 텍스트 숨김, 아이콘만

### 공개 링크 페이지 (정적 데모)
- `public/u/yuminhye.html` — Beauty 테마 샘플
- `public/s/a1b2c3.html` — 숏링크 리다이렉트 샘플
- OG 메타, 제안하기 FAB 포함

### 현재 배포 파일 구조
```
public/
├─ app.html           메인 앱 (v2_2 에디터 포함)
├─ landing.html       랜딩 페이지
├─ u/yuminhye.html    공개 링크 샘플
└─ s/a1b2c3.html      숏링크 샘플
```

---

## 2026-04-19 세션 후속 업데이트 (Ssobi v2.1)

### 내 링크 (app.html)
- 하단 플로팅 툴바(테마/블록추가/설정) 제거, 상단 2단 고정 액션바에 통합
  - Row1: [뒤로] [ssobi.ai/u/핸들] [공유]
  - Row2: [미리보기] [테마] [블록 추가] [설정]
  - `position:fixed` 으로 교체 (sticky가 overflow:hidden 부모에서 안 잡혀서)
  - editor `padding-top:104px`, preview 모드에선 0
- 블록 이동: 좌상단 드래그 핸들(⋮⋮) 상시 노출 → 누르는 즉시 드래그 모드
  + 블록 본체 롱프레스 350ms도 지원 (백업)
  + 드래그 중 click 캡처 차단으로 편집팝업 안 뜸
  + 히어로 블록에는 핸들 숨김 (이동 불가)
- 블록 선택: 호버 효과 제거, 솔리드 1.5px mint 보더 + 은은한 mint 글로우
- 히어로 캐러셀: `touch-action:pan-x pan-y` → 세로 스크롤 통과
- 잘하는 계정 프로필 미리보기 모달: 우상단 ✕ 버튼 + 핸들바 탭 닫힘 추가
- 카드 편집: "제품 카드 N 편집" → "카드 N 편집"
- "날짜/메타" 라벨 → "시간"
- 설정 시트: 클릭 분석 토글 제거

### 탭바·시트 그림자 이슈
- `.nav`: 플랫 디자인 (솔리드 #fff + 1px 라인만)
- `.lke-edit-sheet`: 닫힌 상태에서도 box-shadow가 위로 퍼져 탭바 위 영역을
  어둡게 만들던 버그 → `.open`일 때만 그림자 적용

### 만들기
- "처음이신가요?" → "처음 SNS를 시작한다면?"
- placeholder 예시 교체: "우울할 때 책 속 글귀 추천(출처 포함) / 아이돌
  메이크업 트렌드 Best 3 / 민감 피부 봄철 루틴 / 이번주 공구 정리"
- textarea 폰트 14 → 15.5px
- 카드뉴스 수정/적용/다시 생성 버튼 아이콘형으로 리파인
- cs-4 에 [편집][미리보기] 탭 추가 (미리보기 모드 = 핸들·툴바 숨김)
- 슬라이드 구조 MINE AI 크리에이터 스타일로 재구성
  - 1장 = 표지 (28px 큰 후킹 + 페이지 번호 + 서브)
  - 2장 = 프리뷰 ("오늘 알려드릴 N가지" 리스트)
  - 중간장 = 번호 + 제목(18px) + 본문
  - 마지막장 = CTA (💬 댓글 · 🔖 저장 · ➕ 팔로우)
- 모던 템플릿 3종 추가:
  - `editorial` · 크림 + Fraunces italic 세리프
  - `mono` · 다크 #0F1319 + mint accent bar
  - `pastel` · 핑크→라벤더 그라디 + 소프트 다트
- 참고 계정 "반영 중..." alert → `lkeShowToast`로 변경

### 관리 (키우기 하위)
- 긍정 팔로워 3 → 6명, 부정 2 → 5명 노출
- 더보기 → **공유 아이콘 + 전체 ID 복사/공유** 버튼
  - `copyFollowerIds('pos'|'neg')` · `shareFollowerIds()` (Web Share API)
  - 모노스페이스 코드 블록에 ID 전체 렌더
- 팔로워 탭 시 최근 댓글 1개 → 3개 (m-crm1/m-crm2)
- 상단 탭바(.tbar) 간격 정리: padding 2→8px, font 11→12px, gap 2px

### 홈 · 튜토리얼
- 첫날 모드 진입 시 다크 오버레이 튜토리얼 추가 (최초 1회만)
  - 5개 탭 한줄 설명 카드 + 건너뛰기/시작하기
  - `localStorage.ssobi_tut_seen`

### 예약 게시물
- 날짜 클릭 시 예약 카드뉴스 "미리보기" 버튼 → alert 대신 실제 모달
  - 캐러셀 슬라이드(첫장 후킹/중간 포인트/마지막 CTA) + 채널 칩 + 캡션
  - `openSchedPreview(p)` · `m-sched-preview`

### 로그인
- **카카오로 시작하기** 노란 버튼 추가 (가입/로그인 양쪽)
- `doKakaoLogin()` = `sb.auth.signInWithOAuth({provider:'kakao'})`
- Supabase에서 Kakao OAuth provider 설정 필요

### 랜딩 (landing.html)
- 히어로 카피 "키우고, 만들고, 돈벌고." → "키우고, 만들고."
- 모바일 히어로 44 → 62px 대폭 확대, 모바일에서 3줄 나뉨
- 만들기 섹션: 좌측 텍스트 블록 제거, 폰 mock만 중앙 정렬
- TRACK 04 · LINK 배지 → "내 링크" + sec-eye "MY LINK" 패턴 통일
- 다국어 스위처: Google Translate 기반 KO/EN/JA/ZH
  - 자동 감지 배너 (navigator.language 체크)

---

## 도메인 · 다음 단계 (2026-04-19 이후)

### 구매 완료
- **ssobi.ai** 도메인 확보

### Vercel 환경변수 (Repli → Ssobi 리네이밍 필요)
- 다음 env 값의 도메인 참조 확인·수정 필요:
  - `NEXT_PUBLIC_APP_URL` = https://ssobi.ai
    → `https://ssobi.ai` 로 교체
  - 각 OAuth provider의 redirect URI (Supabase, Meta, Google, Kakao)
    모두 ssobi.ai 기반으로 추가 등록 필요

### 서비스 개요 (갱신)
- **서비스명**: Ssobi. (쏘비)
- **회사**: (주)공팔리터글로벌
- **도메인**: https://ssobi.ai
- **구 도메인**: https://ssobi.ai (당분간 유지)
- **포지셔닝**: 소셜 비서 SaaS (키우기·만들기·수익화)
- **타겟**: K-뷰티 인플루언서 → 확장 중

