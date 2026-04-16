# Repli 트랙 B 설계 — 압축 일정

## 이번주 전체 (4/16~4/20)

### Day 1: 프로젝트 세팅
- Next.js 15 + Tailwind + Vercel 배포
- Supabase 연동 + DB 스키마
- 이메일 가입/로그인

### Day 2: Instagram OAuth + 대시보드
- Instagram OAuth 연동
- 대시보드 셸 (홈/소셜활동/관리/내정보)
- RLS 설정

### Day 3: Webhook + Claude 파이프라인
- `/api/webhook/instagram` 엔드포인트
- Claude 말투 학습 (tone_profiles)
- 댓글 감지 → Claude 응대 생성 → Instagram API 발송

### Day 4: 알림 + 안정화
- 카카오 알림톡 연동
- 에러 핸들링 + 로깅
- usage_logs 카운팅

### Day 5: 결제 + QA
- 포트원 구독 결제 연동
- 플랜별 한도 체크
- E2E 테스트 + 버그 수정

## 기술 스택
- Next.js 15 App Router, Tailwind CSS
- Supabase (Auth + Postgres + RLS)
- Vercel 배포 (기본 서브도메인)
- Claude API (말투 학습 + 응대)
- Meta Graph API (Instagram)
- 포트원 (구독 결제)
- 카카오 알림톡

## DB 스키마
profiles, ig_accounts, tone_profiles, usage_logs, reply_logs
(상세 SQL은 마이그레이션 파일 참조)

## 인증
- 이메일/비밀번호 (Supabase Auth)
- Instagram OAuth (계정 연동, ig_accounts에 토큰 저장)
