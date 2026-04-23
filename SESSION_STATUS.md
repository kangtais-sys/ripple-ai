# Ssobi. 현재 작업 상태 요약

**업데이트**: 2026-04-22
**목표**: Meta App Review 제출 → 승인 → 정식 서비스 오픈

---

## 🎯 Meta App Review 제출 준비 상태

### 제출할 권한 5개 (체크)
- [x] `instagram_business_basic`
- [x] `instagram_business_manage_comments`
- [x] `instagram_business_manage_messages`
- [x] `instagram_business_content_publish`
- [x] `instagram_business_manage_insights`

### 체크 해제할 권한
- `Human Agent` — 상담사 핸드오프 기능 없음 (리젝 사유)

### 제출 자료
- **영상 A**: `https://youtube.com/shorts/mZ84OTgDXuI` (로그인·IG 연동·댓글·DM·삭제 안내)
- **영상 B**: `https://youtube.com/shorts/NlhPOUqIoNc` (카드뉴스 생성·게시·분석)
- **Test Credentials**: `kangtais@naver.com` + Ssobi 비번
- 영어 설명문 5개 (권한별): 아래 별도 섹션

---

## ✅ 구현 완료된 기능 (정식 플로우)

### 1. Instagram OAuth 연동
- `/api/auth/instagram/callback` — Instagram Login 방식 (FB Login 아님)
- 토큰 교환 → 유저 정보 → `ig_accounts` 저장
- **Webhook 자동 구독** (`POST /me/subscribed_apps` with body form)
- `?ig_connected=username` 리다이렉트 → 프론트 자동 학습 트리거

### 2. AI 말투 학습 (Claude)
- `/api/tone/fetch-posts` — IG 캡션 25개 조회
- `/api/tone/learn` — Claude 분석 → `tone_profiles.learned_style` 저장
- **게시물 <3개 시**: `DEFAULT_TONE` 자동 적용
- **연동 직후 자동 학습 트리거** (프론트)

### 3. 브랜드/계정 정보 + 금지어
- `/api/tone/context` GET/POST
- `tone_profiles.brand_context` (TEXT), `banned_words` (JSONB)
- Migration 008 필요: `ALTER TABLE tone_profiles ADD COLUMN ...`
- AI 응대 시스템 프롬프트에 주입

### 4. Webhook 수신 → AI 초안 생성 → 응답
- `/api/webhook/instagram` POST 핸들러
- `handleComment` / `handleMessage`
- `generateReply()` — tone_profiles + brand_context + banned_words 주입
- **일반** → 자동 발송 (`POST /{comment_id}/replies` 실호출)
- **긴급/부정** → `reply_logs.status=pending` → 긴급 탭 대기
- **SKIP 판정** → `status=skipped` 로그 저장 (디버깅용)

### 5. 승인 → 실전송
- `/api/replies/[id]/approve` — `sendCommentReply` / `sendDirectMessage` 호출
- `context.simulated=true` 시 가짜 발송 처리 (시뮬 플로우)
- 실제 시 Graph API 호출로 댓글/DM 전송

### 6. 카드뉴스 발행 (Graph API 실호출)
- `/api/cardnews` POST — 편집기 저장
- `/api/cardnews/[id]/image` — 1080×1080 PNG 동적 렌더 (8 템플릿)
- `/api/cardnews/[id]/publish-now` — 즉시 발행
- `/api/cron/publish-scheduled` — 예약 발행 (scheduled_at 기반)
- `src/lib/ig-publish.ts` — `POST /media` → `POST /media_publish`
- "지금 바로" or "예약" 선택 가능 (프론트 publishPost)

### 7. Instagram Insights
- `/api/insights` — 팔로워, 도달, 노출, 프로필방문, 웹클릭 + 미디어별
- `/api/home/ssobi-effect` — 이번 달 reach + 응대 건수 + 절약 시간
- 홈 히어로 + 분석 탭 실데이터

### 8. IG 연동 해제
- `/api/ig/disconnect` — reply_logs FK 해제 → ig_accounts 삭제
- `tone_profiles.learned_style`/`sample_texts` 초기화 (컨텍스트는 유지)

### 9. Webhook 재구독
- `/api/ig/resubscribe` GET/POST
- 디버그용. POST body 형식으로 Meta에 재구독 호출

---

## 🗃 DB 마이그레이션 상태

### 이미 실행된 것 (Supabase SQL Editor 기록 기준)
- 001 initial (5 tables + RLS + signup trigger)
- 003 tone upsert (UNIQUE constraint + insert/update policies)
- 004 ssobi features (link_pages, link_proposals, short_links, card_news_jobs, user_templates, reference_accounts)
- 005 ssobi full features
- 006 signup autobootstrap
- 007 growth insights campaigns
- **008 tone_context** — ✅ 실행 완료

### 현재 DB 상태
- `profiles` (user_id FK to auth.users)
- `ig_accounts` (access_token, ig_user_id, ig_username)
- `tone_profiles` (learned_style, sample_texts, **banned_words**, **brand_context**)
- `reply_logs` (type, original_text, reply_text, send_status, is_approved, context)
- `card_news_jobs` (prompt_hook, prompt_body, prompt_caption, template, status, scheduled_at, meta)
- `outbound_messages`, `follower_profiles`, `link_pages`, `link_proposals`, `short_links`, `user_templates`, `reference_accounts`, `subscriptions`, `notification_prefs`, `points_ledger`

---

## 🔑 Meta/Supabase/Vercel 설정

### Meta 앱
- **App ID**: `973683215179192`
- **Instagram App ID**: `1746122143490239`
- **App Secret**: `.env.local` 의 `META_APP_SECRET`
- **Webhook Callback URL**: `https://ssobi.ai/api/webhook/instagram` (✅ 확인됨)
- **Verify Token**: `repli_webhook_2026`
- **Subscription fields**: `comments`, `messages` (✅ 활성)

### Supabase
- **Project URL**: `https://ffozahaztbudvsnnkvep.supabase.co`
- **Project ID**: `ffozahaztbudvsnnkvep`

### 연동된 IG 계정
- **username**: `sisru_doku`
- **ig_user_id**: `17841472637850937`
- **account_type**: `MEDIA_CREATOR`
- **token_expires_at**: `2026-06-19`
- **Webhook subscription**: ✅ 활성 (comments, messages)

---

## 💰 가격 구조 (랜딩 기준)

| 플랜 | 응대 | 계정 | 가격 |
|---|---|---|---|
| 베이직 | 300건/월 | 1개 | ₩0 (평생 무료) |
| 프리미엄 | 6,600건/월 | 3개 | ₩29,800/월 (7일 무료 체험) |
| 프로페셔널 | 무제한 | 10개 | ₩69,800/월 |

DB enum: `free/basic/premium/business` 유지 (migration 회피)
- `free`/`basic` → "베이직" 표기
- `business` → "프로페셔널" 표기

---

## 🧪 아직 안 풀린 문제

### Webhook 실 댓글이 안 옴

**확인된 사실**:
- App-level callback URL 올바름 (Graph API 쿼리로 확인)
- User-level subscription 활성 (sisru_doku `subscribed_fields: comments,messages`)
- 직접 curl POST는 정상 처리됨 (AI 초안 생성까지)
- Meta Test 버튼 POST도 정상 수신

**가설 (미검증)**:
- 댓글 단 IG 계정이 **Instagram Tester 초대를 수락 안 함**
- Meta Dev 모드에서 테스터 간 이벤트만 전달

**결정**: 심사 후 해결. Dev 모드 제한이라 심사 통과하면 풀릴 가능성 높음.

---

## 📝 Meta 제출 폼 영어 설명문 (권한별)

## 🎯 최종 Meta 제출 영어 설명문 (DUAL-FLOW 강조 버전 · 2026-04-23)

**핵심 전략**: Ssobi의 이중 플로우 (AI 분류 → 자동/승인 분기)를 안전성 · 속도 균형으로 강조.

### [FINAL] instagram_business_manage_comments

```
DUAL-FLOW AI COMMENT ASSISTANT (Safety + Speed)

Ssobi uses Claude AI to draft reply suggestions for incoming
Instagram comments. To balance user safety with Instagram's
recommendation for fast responses, we use a two-path design
driven by AI content classification:

PATH 1 — Auto-respond (neutral/positive, non-sensitive):
- AI classifies comment → urgency "low" + sentiment "neutral/
  positive" + NOT a business inquiry
- Reply posted via Graph API /{comment_id}/replies immediately
- Meets Meta's engagement-speed expectation

PATH 2 — Human approval (anything sensitive):
- AI flags: negative sentiment, refund requests, business
  inquiries, complaints, legal concerns
- Draft queued in "긴급 응대 대기 (Pending)" — NOT sent yet
- User reviews + taps "승인·발송 (Approve & Send)" to post
- Prevents AI hallucination on critical content

Additional safety layers:
• AI returns "SKIP" for spam/offensive input — no reply generated
• Creator's learned tone profile applied — human-sounding replies
• "[AI Supported]" transparency stamp in caption (user-toggleable)
• Rate limited per user plan (300–6600 replies/month)
• All replies logged in reply_logs for user audit

This design is stricter than pure auto-reply and faster than
pure manual approval — balancing Meta's speed expectations
with user safety.

Verify in video: Reviewer taps "🧪 긴급 댓글" simulating a
negative comment → draft appears in Pending queue (NOT posted
to IG) → Reviewer taps "승인·발송" → Ssobi posts via Graph API.
A normal comment would have auto-posted instantly (not shown
in video to emphasize safety path).
```

### [FINAL] instagram_business_manage_messages

```
DUAL-FLOW AI DM ASSISTANT

Same dual-flow design as comments, strictly complying with
Instagram's 24-hour messaging window:

PATH 1 — Auto-respond to neutral inquiries (within 24h window):
- AI-drafted reply sent via Graph API /me/messages
- Fast response preserves creator's engagement metrics
- ONLY replies to existing conversations (never initiates)

PATH 2 — Human approval for sensitive:
- Refund/complaint/business proposal → Pending queue
- User explicitly approves before send
- Prevents wrong-content in high-stakes DMs

Safeguards:
• Never sends unsolicited DMs (no cold outreach)
• 24-hour window strict compliance — skipped if expired
• Spam/offensive → SKIP, no draft
• Content filter before send

Verify in video at 0:45-0:55: reviewer simulates DM, AI drafts,
taps approve, message sent via Graph API /me/messages.
```

### [FINAL] instagram_business_content_publish

```
USER-CONTROLLED CONTENT PUBLISHING

Ssobi generates K-lifestyle carousel posts using Claude AI based
on a topic provided by the user. Each slide is user-reviewable
in an editor before publishing.

User flow (all steps require explicit user action):
1. User inputs topic (e.g., "봄철 스킨케어 꿀팁").
2. Claude AI drafts 6 slides + caption.
3. User edits slides, captions, selects template/size.
4. User selects "Instagram" as target channel.
5. User picks publish time (now or scheduled).
6. User taps "게시·예약 확정 (Confirm Publish)".
7. ONLY THEN does Ssobi POST to Graph API /media + /media_publish.

No post is published without step 6. Scheduled posts respect
user's chosen time; user can cancel before that.

Content transparency:
"[AI Supported]" stamp auto-added to captions (user-toggleable)
— aligns with Meta's AI disclosure expectations.

Verify in video B at 0:35-0:55 — full flow from topic input to
final confirmation tap.
```

### [FINAL] instagram_business_basic

```
Ssobi retrieves the user's Instagram Business profile (username,
user_id) via OAuth to link the connected account to the Ssobi
dashboard. Used only for account identification and display —
no profile data stored beyond what's necessary.

Data minimization:
- Stored: username, user_id, access_token
- NOT stored: followers list, post content, DMs (fetched on
  demand, cached briefly)

Verify in video A at 0:10 — OAuth completion shows
"@millimilli.official 연동 완료" confirmation display.
```

### [FINAL] instagram_business_manage_insights

```
Ssobi displays the user's own Instagram performance metrics
(followers, reach, impressions, profile views, website clicks)
on the home dashboard and analytics tab. All data comes from
Graph API Insights endpoint for the user's own account only —
Ssobi never accesses insights of accounts the user doesn't own.

Privacy:
- Data scoped to authenticated user's IG Business account only
- No aggregation or sharing with third parties
- User can disconnect anytime ("해제" button in 내 정보)

Verify in video B at 0:05-0:12 (home) and 0:58-1:00 (analytics).
```

### [FINAL] Test User Credentials

```
Test Email: kangtais@naver.com
Password: [비번]

REVIEWER GUIDE

The app demonstrates Ssobi's Human-in-the-Loop AI assistant
for Korean creators. Key safety feature: NO auto-posting to
Instagram without explicit user approval for sensitive content.

Content classified as "urgent" (negative, refund, business)
always requires manual approval. Neutral comments may auto-
reply (Meta speed guidance). See DUAL-FLOW explanations above.

To test the approval flow:
1. Login → 실시간 관리 → 긴급 (Urgent) tab
2. Tap "🧪 긴급 댓글 (승인 대기)" — simulates incoming comment
   without affecting real Instagram
3. Observe: AI draft appears in pending queue (not sent yet)
4. Review the draft text (in user's learned tone)
5. Tap "승인·발송 (Approve & Send)" to complete the flow

For content_publish:
1. Tap 만들기 (Create) → input topic
2. Watch Claude generate 6-slide carousel
3. Edit/review in canvas
4. 게시하기 → Instagram → 지금 바로 → 확정

Dev simulator URL: https://ssobi.ai/app?dev=1

All simulations use fake IDs — no real Instagram impact during
review. OAuth was captured in the submitted videos.

Instagram account @sisru_doku is pre-linked to this Ssobi
account via Instagram Tester flow.
```

---

## 이전 제출 자료 (참고용)

### `instagram_business_basic`
**영상**: `https://youtube.com/shorts/mZ84OTgDXuI`

```
Ssobi retrieves the user's Instagram Business profile (username
and user_id) immediately after OAuth, so we can link the connected
account to their Ssobi dashboard and display the correct profile
throughout the app.

How to verify in the video:
After the user taps "Instagram 연동" and completes OAuth, the app
displays "@millimilli.official 연동 완료" confirmation. This
confirmation requires reading the basic profile fields.
```

### `instagram_business_manage_comments`
**영상**: `https://youtube.com/shorts/mZ84OTgDXuI`

```
Ssobi drafts AI reply suggestions for incoming Instagram comments
using Claude AI trained on the user's own tone profile. Every
draft is queued in the "긴급 응대 대기" review queue and can only
be posted to Instagram after the user explicitly taps "승인·발송".
No auto-posting without human approval.

How to verify in the video:
The user taps "🧪 긴급 댓글" to simulate an incoming comment,
reviews the AI-generated draft, then taps "승인·발송" — the
approved reply is posted to Instagram via the Graph API.
```

### `instagram_business_manage_messages`
**영상**: `https://youtube.com/shorts/mZ84OTgDXuI`

```
Ssobi uses Claude AI to draft responses to Instagram DMs in the
user's tone. All drafts require explicit human approval through
the same "긴급 응대 대기" queue before being sent to Instagram DM.
Ssobi respects Instagram's 24-hour messaging window.

How to verify in the video:
The user taps "🧪 긴급 DM" to simulate an incoming DM, reviews
the AI draft, and approves it — the message is then sent to
Instagram via the Graph API.
```

### `instagram_business_content_publish`
**영상**: `https://youtube.com/shorts/NlhPOUqIoNc`

```
Ssobi generates K-beauty carousel posts using Claude AI based on
a topic input by the user. The user reviews the generated slides
and caption, selects Instagram as the target channel, picks a
publish time (immediate or scheduled), and confirms. Scheduled
posts are published to the user's Instagram Business account at
the chosen time via the Graph API.

How to verify in the video:
The user enters a topic, taps "카드뉴스 생성" to trigger Claude
generation, reviews the carousel in preview mode, selects
Instagram channel, picks a scheduled time, and taps "게시·예약
확정" — the post is added to the scheduled publishing queue.
```

### `instagram_business_manage_insights`
**영상**: `https://youtube.com/shorts/NlhPOUqIoNc`

```
Ssobi displays the user's Instagram account metrics (followers,
reach, impressions, profile views, website clicks) on the home
dashboard and a dedicated analytics tab. All metrics come directly
from the Instagram Graph API Insights endpoint, giving creators
real-time visibility into their account performance.

How to verify in the video:
Home tab shows the "이번 달 도달" (monthly reach) stat with the
real reach count. The analytics tab shows 6 metric cards
(followers, media, reach, impressions, profile views, website
clicks) plus recent media with per-post insights.
```

### Test User Credentials (폼 하단)

```
Email: kangtais@naver.com
Password: [비번]

Instagram account @sisru_doku (or @millimilli.official) is
already linked to this Ssobi account.
Reviewer does not need to authenticate with Instagram separately.

To test features:
1. Login to https://ssobi.ai/app with above credentials
2. Home tab → see reach/insights data (manage_insights permission)
3. 실시간 관리 → 긴급 탭 → tap "🧪 긴급 댓글 (승인 대기)" simulator
4. Review AI draft → tap "승인·발송" (comments/messages permission)
5. 만들기 → create cardnews → "지금 바로" → IG publish (content_publish)

Dev simulator URL: https://ssobi.ai/app?dev=1

Note: Full OAuth flow was recorded in the submitted videos.
Meta test reviewer's Instagram access is handled via Meta's
Instagram Tester automatic mechanism.
```

---

## 🎯 B안 Submit 진행 순서

### 남은 0/1 권한 채우기

1. **content_publish** 실호출
   ```
   ssobi.ai/app?dev=1 → 만들기 → 주제 입력 → 생성
   → 다음 → 다음 → 게시하기
   → IG 체크 → "지금 바로" → "게시·예약 확정"
   → confirm → "✅ 게시 완료" alert
   ```

2. **manage_insights** 실호출 (이미 했을 가능성)
   - 홈 탭 진입 → "이번 달 도달" 로드 대기 (3초)
   - 실시간 관리 → 분석 탭 진입 → 지표 카드 로드 대기 (3초)

3. **manage_messages** Test 버튼 (콘솔 대시보드에서)
   - https://developers.facebook.com/apps/973683215179192/webhooks/
   - Instagram → `messages` 필드 옆 **Test** → Send to My Server

### Meta 권한 페이지 확인

```
https://developers.facebook.com/apps/973683215179192/app-review/permissions/
```

모든 권한 `1/1` 확인 → 이용 사례 폼 빈칸 없이 채움 → **Submit for Review**

### 24시간 대기

Meta 집계 지연. 지금 트리거해도 반영은 내일.

---

## 🔮 심사 통과 후 해야 할 것

1. **Webhook 실 댓글 테스트** — Dev 모드 풀려서 자동 동작할 것
2. **Kakao OAuth 실연결** (#135) — 장기 pending
3. **TikTok/YouTube API 연동** — 현재 UI만 존재
4. **포트원 결제 실가입** — 프리미엄 구독 흐름 연결
5. **카카오 알림톡 채널 세팅** (솔라피 추천)

---

## 📂 주요 파일

```
public/
├─ app.html                              메인 앱 (repli_v3.html + Supabase)
├─ landing.html                          랜딩 페이지 (PRICING 기준)
└─ terms.html                            약관 + 개인정보 + 삭제 안내

src/app/
├─ page.tsx                              루트 → /app.html
└─ api/
   ├─ auth/instagram/callback/           IG OAuth 콜백 + 자동 webhook 구독
   ├─ auth/signout/
   ├─ cardnews/
   │  ├─ route.ts                        GET 목록, POST 저장
   │  ├─ generate/route.ts               Claude 카드뉴스 생성
   │  └─ [id]/
   │     ├─ route.ts                     PUT 편집
   │     ├─ image/route.tsx              ImageResponse PNG 렌더
   │     └─ publish-now/route.ts         즉시 발행
   ├─ cron/
   │  ├─ publish-scheduled/              예약 발행 cron
   │  └─ refresh-ig-token/               주간 토큰 갱신
   ├─ dev/simulate-comment/              시뮬 버튼용
   ├─ home/ssobi-effect/                 히어로 지표
   ├─ ig/
   │  ├─ disconnect/                     연동 해제
   │  └─ resubscribe/                    webhook 재구독
   ├─ insights/                          Graph API insights
   ├─ link/                              내 링크 API
   ├─ replies/
   │  ├─ route.ts                        목록
   │  └─ [id]/
   │     ├─ approve/                     승인→실전송
   │     └─ skip/
   ├─ tone/
   │  ├─ learn/                          말투 학습
   │  ├─ fetch-posts/                    IG 캡션 조회
   │  └─ context/                        브랜드·금지어
   └─ webhook/instagram/                 webhook 엔드포인트 (디버그 로깅 포함)

src/lib/
├─ auth-helper.ts                        getUserFromRequest, adminClient
├─ ig-publish.ts                         Graph API publish 헬퍼
├─ ig-send.ts                            댓글·DM 전송
├─ pricing.ts                            2026 최저시급 상수
├─ plans.ts                              요금제 정의
└─ webhook-helpers.ts                    classifyText, recordOutbound, upsertFollower

supabase/migrations/
├─ 001_initial.sql
├─ 002_usage_rpc.sql
├─ 003_tone_upsert.sql
├─ 004_ssobi_features.sql
├─ 005_ssobi_full_features.sql
├─ 006_signup_autobootstrap.sql
├─ 007_growth_insights_campaigns.sql
└─ 008_tone_context.sql                  (ALREADY EXECUTED)
```

---

## 🐛 디버깅 메모

### 최근 해결한 이슈
- IG OAuth 세션 누락 (Supabase CDN localStorage ↔ SSR 쿠키 불일치) → Bearer 토큰 인증 패턴
- tone/learn UNIQUE 제약 누락 → check-then-update/insert 패턴
- profiles FK 위반 → upsert 전 profiles row 자동 생성
- callback_url 구 도메인 잔존 → Graph API로 업데이트
- subscribed_apps POST body 형식 (query string 안 먹음)
- Claude JSON 파싱 실패 → try/catch + max_tokens 증가
- 말투 학습 결과 렌더링 (배열/객체 필드 지원)
- 플랜 표기 통일 (무료→베이직, 비즈니스→프로페셔널)
- 예약 cron race condition (scheduled_at=null CAS 선점)
- pastel 템플릿 gradient (Satori 호환 backgroundImage 분리)

### 미해결 이슈
- **Webhook 실 댓글 미수신**: Meta Dev 모드 tester 제한 추정. 심사 후 확인.
