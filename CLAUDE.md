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
src/
├── app/
│   ├── page.tsx                    루트 (로그인 리다이렉트)
│   ├── login/page.tsx              이메일 로그인
│   ├── signup/page.tsx             이메일 가입
│   ├── dashboard/
│   │   ├── layout.tsx              대시보드 레이아웃 (헤더+탭바)
│   │   ├── page.tsx                홈 (통계)
│   │   └── connect/page.tsx        Instagram 계정 연동
│   └── api/
│       ├── auth/callback/instagram/route.ts   IG OAuth 콜백
│       ├── auth/signout/route.ts              로그아웃
│       └── webhook/instagram/route.ts         Webhook (댓글→Claude→발송)
├── lib/supabase/
│   ├── client.ts                   브라우저용
│   ├── server.ts                   서버용
│   └── middleware.ts               세션 갱신
└── middleware.ts                   인증 가드
supabase/migrations/                DB 마이그레이션
legacy/                             기존 HTML 프로토타입
CLAUDE.md                           이 파일
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
- [x] 이메일 가입/로그인
- [x] Instagram OAuth 연동
- [x] Webhook 엔드포인트 (댓글 감지 → Claude 응대 → Instagram 발송)
- [x] Webhook 검증 테스트 통과
- [x] Claude 말투 학습 파이프라인 (/dashboard/tone + /api/tone/learn)
- [x] DM 자동 응대 (Webhook → Claude → Instagram Send API)
- [x] 응대 내역 페이지 (/dashboard/logs)
- [x] 플랜별 한도 체크 (Webhook에서 자동 스킵)
- [x] 포트원 구독 결제 API (/api/payment/subscribe + webhook)
- [x] 이용권 페이지 (/dashboard/plan)
- [x] 카카오 알림톡 함수 (구독 완료 시 발송)
- [ ] Meta Webhook 등록 (대시보드에서 수동)
- [ ] 포트원 가입 + API 키 세팅
- [ ] 카카오 알림톡 채널 세팅

### 트랙 C — 마케팅
- [ ] 포트원 가입
- [ ] 베타 유저 20~30명 모집
- [ ] 유료 전환 오픈

## 작업 시 주의사항
- env 변수 추가 시 `printf` 사용 (`echo`는 \n 포함됨)
- Webhook은 production env에서만 동작
- RLS가 켜져 있으므로 webhook에서는 service_role_key 사용
