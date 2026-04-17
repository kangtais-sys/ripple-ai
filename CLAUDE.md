# Repli. 프로젝트 컨텍스트

## 서비스 개요
- **서비스명**: Repli.
- **회사**: (주)공팔리터글로벌
- **대상**: K-뷰티 인플루언서의 SNS 자동 관리 SaaS
- **GitHub**: https://github.com/kangtais-sys/ripple-ai
- **배포 URL**: https://ripple-ai-umber.vercel.app
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
- **Webhook URL**: https://ripple-ai-umber.vercel.app/api/webhook/instagram
- **Webhook Verify Token**: repli_webhook_2026
- **IG OAuth Redirect URI**: https://ripple-ai-umber.vercel.app/api/auth/instagram/callback
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

## 가격 구조
| 플랜 | 응대 한도 | 가격 | Claude 원가 | 마진 |
|---|---|---|---|---|
| 베이직 | 3,300건/월 | ₩29,000 | ~$4 | ~60% |
| 프리미엄 | 6,600건/월 | ₩59,000 | ~$8 | ~65% |
| 비즈니스 | 무제한 | ₩129,000 | ~$15+ | 별도 협의 |

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
