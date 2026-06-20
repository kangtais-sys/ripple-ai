# Ssobi 학습 시스템 고도화 — 설계문서

작성일: 2026-06-20 · 결정권자: MINE (의사결정 위임, 설계는 Claude가 확정)

## 목표 (합격 기준)

> 유저가 **① 인스타를 연동**하고 **② 내 링크를 만들고/쓰고** **③ 학습탭에서 자료를 넣으면**,
> Ssobi가 **유저의 모든 콘텐츠(말투·캐릭터·상품·정책)를 학습**해서
> **댓글/DM 자동 응대에 실시간으로 반영**한다.
> 정보가 충돌하면 **가장 최신 업데이트를 기준**으로 답한다.

## 설계 원칙 (5개 서브시스템 공통)

1. **실시간 반영**: 학습 완료 → 다음 인입 댓글/DM부터 즉시 사용. 짧은 텍스트/파일은 동기(즉시 임베딩), URL/대용량은 백그라운드(Inngest, 완료 시 atomic 반영).
2. **최신 우선**: 같은 사실이 충돌하면 가장 최근 갱신본이 이긴다.
3. **학습 가시성**: 학습한 내용은 학습탭에서 유저가 보고(카드), 필요시 수정한다.
4. **손실 0**: 재학습은 항상 INSERT 먼저 → 성공 후 옛것 soft-deactivate (C단계 기조 유지). 하드 DELETE 금지.
5. **발송 흐름 보호**: webhook/instagram · v2-reply · ig-send · replies/approve 변경 최소화, 영향평가 후에만.

## 현재 상태 (조사 검증 완료, 2026-06-20)

- **인프라 대부분 존재**, 갭은 "고아 라우트 연결 / 비활성 코드 활성화 / 신규 추가" 셋.
- 응대 RAG: `search_knowledge` RPC(priority DESC, 코사인) → `generate.ts`가 `learned_style`/`persona_summary`/`persona_details`/`user_corrections` 읽음. 채워지면 즉시 응대 반영.
- 학습 파이프라인: `learn/url.requested` → fetch-url → chunk-text → embed-chunks (C단계 soft-deactivate 적용됨).
- **알려진 기술부채**: 마이그레이션 028·029 파일이 repo에 없음(learn_queue 컬럼이 live DB에만 존재). → 부채정리로 `032`에서 현재 스키마를 정식 문서화.

---

## 빌드 순서 (임팩트÷노력) — MINE 승인됨

① IG 페르소나 자동학습 → ② 파일 업로드 학습 → ③ OCR 커머스 → ④ 충돌 해소(최신) → ⑤ 링크 증분.
각 단계는 독립 배포 가능 + 직전 배포 후 검증.

---

## ① IG 연동 자동 페르소나 학습 (말투 + 캐릭터)

**문제**: 연동 시 캡션만(haiku) 학습. bio·캐릭터 미학습. 풍부한 `/api/learn/onboarding`(Sonnet) 라우트가 고아.

**결정 (확정)**:
- 트리거 = **서버사이드 Inngest 워커**(탭 닫아도 학습). 화면은 진행상태 폴링 표시.
- 페르소나 = **자동 적용** + 학습탭 카드 표시, 수정 가능(기존 `onboarding/validate`=user_corrections 활용).
- 게시물 **최근 10개** + bio.

**컴포넌트**:
- 🆕 `src/lib/kb/persona-learn.ts` — `fetchIgProfileAndPosts(token,10)` + `analyzePersona(bio,captions)`(Sonnet). 기존 onboarding 로직을 여기로 추출(중복 제거).
- 🆕 `src/inngest/workers/learn-ig-persona.ts` — event `learn/ig.connected`: ig_accounts에서 토큰 읽기(이벤트에 토큰 안 실음) → lib → tone_profiles upsert + status.
- ✏️ `api/auth/instagram/callback/route.ts` — ig_accounts 저장 후 tone_profiles(status=`learning`) + `inngest.send('learn/ig.connected',{userId})`.
- ✏️ `api/learn/onboarding/route.ts` — 공유 lib 사용(수동 재학습용 유지).
- 🆕 마이그레이션 `032` — `tone_profiles.learn_status`('learning'|'done'|'failed') + `learned_at`. (+028/029 부채 스키마 정식화)
- ✏️ `api/learn/overview/route.ts` — `learn_status` 포함.
- ✏️ `public/app.html`(최소) — `?ig_connected` 시 "말투·캐릭터 학습 중" + 폴링 → 완료 카드 + "수정".

**엣지**: 게시물<3 → 기본 말투 fallback. 토큰 실패 → status=failed + "다시 학습". 재연동 → 덮어쓰기.

**실시간성**: 백그라운드 학습(10~20s) 완료 시 tone_profiles 갱신 → 다음 응대부터 페르소나 사용.

---

## ② 파일 업로드 학습 (PDF/이미지) + 대화형 피드백 + 텍스트 영구학습

**문제**: 학습탭 파일 업로드가 `alert("곧 열려요")`로 막힘. 채팅 텍스트가 `urgent`(7일 만료)로 들어가 영구학습이 사라짐.

**결정 (확정)**:
- 🆕 `POST /api/learn/upload` — multipart(PDF/이미지). Supabase Storage 저장 → uploaded_files 행 → 파싱 → storeKnowledge.
  - PDF → 텍스트 추출(서버 파서). 이미지 → 기존 `image-ocr.ts` OCR.
  - 소용량 = 동기(즉시 임베딩, 즉시 반영). 대용량/다수 = Inngest + 진행표시.
- **채팅 텍스트 영구학습 분리**: 일반 텍스트 → `source_type='manual'`, **만료 없음**(현행 urgent 7일 제거). "긴급:" 프리픽스만 urgent(만료).
- **대화형 피드백**: 낙관적 버블 — "업로드 확인했어요" → "학습 중…" → "N개로 외워뒀어요" / 실패 시 "오류났어요(사유)". (app.html 학습탭 버블 인프라 재사용)
- 막는 `alert` 제거.

**실시간성**: 텍스트·소형 파일 = 동기 즉시. 완료 즉시 응대 반영.

---

## ③ OCR 활성화 + 커머스 필드 (가격·프로모션·배너·상품명·상품설명·배송일정)

**문제**: OCR 인프라(엔진·캐시·쿼터·브랜드사전) 완성됐으나 파이프라인에 미연결. 프로모션/배너 추출 없음(배너는 일부러 제외됨).

**결정 (확정)**:
- ✏️ `fetch-url.ts`에 OCR 단계 활성화: `extractContent` 결과의 `contentImages`(현재 버려짐)를 `ExtractedContent`에 추가 → 쿼터 체크 → `ocrImages`(cap 7) → `brand-dict` 정규화 → OCR 텍스트를 raw_text에 합침.
- **프로모션 추출 추가**: OCR/추출 프롬프트에 할인·프로모션·이벤트·쿠폰·기간 포함. 상품 청크 카테고리화.
- **배너 재포함(상세페이지 한정)**: 프로모션은 배너에 있음 → 상품 상세 영역 배너는 OCR 대상에 포함(로고/아이콘/팝업은 계속 제외).
- 배송일정 = OCR 프롬프트에 이미 있음 → 활성화로 작동.
- **쿼터/비용 가드**: plans.ts의 OCR 쿼터(FREE trial 10, STARTER 50…) 적용. 비용 폭주 방지.

**실시간성**: URL 학습 파이프라인(백그라운드) 안에서 처리, 완료 시 반영.

---

## ④ 충돌 해소 — 최신 업데이트 기준

**문제**: `search_knowledge`가 priority·유사도만 봄(최신순 없음). 교차출처 충돌 시 최신이 진다는 보장 없음.

**결정 (확정)**:
- ✏️ `search_knowledge` RPC: 정렬에 **`updated_at DESC` 동점처리** 추가(`priority DESC, updated_at DESC, 유사도`) + 반환에 `updated_at` 포함.
- ✏️ `generate.ts`: 검색된 청크에 **"기준일(updated_at)" 메타를 프롬프트에 주입** → 모델이 충돌 시 최신 우선하도록 지시.
- **유저 직접 교정 우대**: 학습탭 채팅으로 넣은 사실(manual)은 priority 상향 + 최신 → 크롤 정보보다 우선.
- 동일 출처(URL/label)는 기존 soft-deactivate로 이미 최신본만 active.

**예시 보장**: 사이트 "배송비 5만↑무료" + 유저 채팅 "10만↑무료"(나중) → 채팅이 더 최신·manual → 응대는 "10만↑무료".

---

## ⑤ 링크 URL 증분 재학습

**문제**: 링크 저장마다 모든 URL 전체 재크롤(변경 감지 없음). 자동 sync는 C단계 전 안전이유로 주석처리됨.

**결정 (확정)**:
- ✏️ learn_queue에 `content_hash` 추가(크롤 raw_text 해시). 재크롤 시 해시 동일 → 재청크/재임베딩 스킵(변경 없음).
- ✏️ enqueue 시 변경/신규 URL만 이벤트 발사(이미 done+active chunks 있고 블록 안 바뀐 URL 스킵).
- ✏️ `runSyncLinksLoop` 자동호출 복원(C단계로 안전) + 5분 throttle 유지.

**실시간성**: 링크 추가/변경 → 해당 URL만 학습 → 완료 시 반영. 변경 없으면 재학습 안 함(비용·시간 절약).

---

## 테스트/검증 전략 (공통)

- 단위: 새 lib(persona-learn, 파서, OCR 합성, 해시) 목킹 테스트.
- 통합: 이벤트→워커→DB 반영. 실제 토큰/URL로 워커 직접 호출 1회(임시 검증, 정리).
- 실시간 반영 검증: 학습 직후 `search_knowledge`가 새 청크 반환 + mock 응대에 인용되는지.
- E2E(MINE 손): 테스터 millimilli.kr 연동→페르소나 카드, 링크 학습→탭 표시, 채팅/파일 학습→즉시 응대, 충돌 케이스→최신 답변.
- 각 단계 배포 후 발송흐름 무변경 git diff 입증.

## 위험/주의

- OCR·Sonnet = 비용. 쿼터·캐시로 가드(이미 설계됨).
- 마이그레이션 028/029 부재 → 032에서 현 스키마 정식화(재현성 회복).
- app.html 디자인 동결 → UI 변경은 최소(상태 표시·버블만), 재설계 금지.
- 학습탭/내링크 수동 트리거는 안전수칙 준수.

## 빌드 단위 (각자 spec→plan→구현→배포→검증)

①(이번) → ② → ③ → ④ → ⑤. ①부터 writing-plans로 구현계획 작성 후 진행.
