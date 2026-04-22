// 카드뉴스 AI 프롬프트 엔진
// 주제를 카테고리로 자동 분류 → 카테고리별 어조·후킹·이미지 방향 주입
// Claude system prompt 생성 로직 포함

// ─────────────────────────────────────────────────────────────
// 카테고리 정의
// ─────────────────────────────────────────────────────────────
export type CategoryKey =
  | 'beauty_treatment' | 'beauty_product' | 'beauty_ingredient' | 'beauty_trouble'
  | 'food' | 'cafe' | 'travel_domestic' | 'travel_abroad'
  | 'fashion' | 'interior' | 'fitness'
  | 'money_tip' | 'price_compare' | 'trend'
  | 'review' | 'life_tip' | 'etc'

export type CategoryInfo = {
  name: string
  tone: string                    // 추가 어조 지침
  imageDirection: string          // 이미지 방향 (Pinterest / 실제 제품 검색 단서)
  moodKeywords: string[]          // 감성 키워드 (글자 없는 이미지 유도)
  researchFocus: string[]         // Claude가 리서치할 항목
}

export const CATEGORIES: Record<CategoryKey, CategoryInfo> = {
  beauty_treatment: {
    name: '뷰티 시술·성형',
    tone: '솔직한 후기 느낌. 비용·다운타임·부작용 정확히',
    imageDirection: '피부 글로우 클로즈업 사진 감성 (시술 기구 X, 결과 얼굴 O)',
    moodKeywords: ['피부 클로즈업 감성', '얼굴 글로우 photography', 'natural skin aesthetic'],
    researchFocus: ['시술명', '실제 가격대', '다운타임', '주의사항', '실제 후기'],
  },
  beauty_product: {
    name: '뷰티 제품',
    tone: '써본 사람 말투. 단점도 솔직히',
    imageDirection: '스킨케어 플랫레이 감성 사진',
    moodKeywords: ['스킨케어 플랫레이', '제품 텍스처 클로즈업', '올리브영 감성'],
    researchFocus: ['제품명', '가격', '주요 성분', '실제 사용감', '대체 제품'],
  },
  beauty_ingredient: {
    name: '뷰티 성분',
    tone: '친근하게 과학적. 전문용어는 쉽게 풀어서',
    imageDirection: '세럼 텍스처 클로즈업 감성 photography',
    moodKeywords: ['세럼 텍스처', '화장품 클로즈업 감성', 'cosmetic close-up'],
    researchFocus: ['성분명', '효능', '주의 대상', '함께 쓰면 좋은 조합', '부작용'],
  },
  beauty_trouble: {
    name: '뷰티 트러블·케어',
    tone: '공감형. "나도 그랬어" 톤',
    imageDirection: '피부결 클로즈업 감성 사진',
    moodKeywords: ['피부결 클로즈업', '자연스러운 얼굴 감성', 'skin texture close-up'],
    researchFocus: ['원인', '해결법', '추천 제품', '병원 진료 필요 시점'],
  },
  food: {
    name: '음식·맛집',
    tone: '침 고이게 묘사. 실제 가본 사람 말투',
    imageDirection: '음식 플레이팅 클로즈업 감성 사진',
    moodKeywords: ['음식 플레이팅', '디저트 클로즈업', 'food aesthetic photography'],
    researchFocus: ['음식명', '가격대', '메뉴 특징', '방문 팁'],
  },
  cafe: {
    name: '카페·음료',
    tone: '감성적. 분위기 포함',
    imageDirection: '카페 음료 감성 필름 사진',
    moodKeywords: ['카페 감성', '음료 클로즈업', 'cafe aesthetic film'],
    researchFocus: ['카페명', '시그니처 메뉴', '가격', '분위기', '위치'],
  },
  travel_domestic: {
    name: '국내 여행',
    tone: '여행자 말투. 가기 전 정보 위주',
    imageDirection: '국내 여행 감성 필름 사진',
    moodKeywords: ['여행 감성', '풍경 필름', 'korean travel aesthetic'],
    researchFocus: ['지역명', '대중교통', '비용', '꼭 봐야 할 포인트', '실제 후기'],
  },
  travel_abroad: {
    name: '해외 여행',
    tone: '현지인 팁 뉘앙스',
    imageDirection: '해외 여행 풍경 감성 사진',
    moodKeywords: ['travel aesthetic', '해외 여행 필름', 'landscape photography'],
    researchFocus: ['도시/국가', '항공편', '숙소', '현지 팁', '예산'],
  },
  fashion: {
    name: '패션·코디',
    tone: 'MZ 패션 블로거 말투',
    imageDirection: '코디 감성 필름 사진 aesthetic',
    moodKeywords: ['오오티디 감성', '스트릿 패션 필름', 'fashion aesthetic photography'],
    researchFocus: ['브랜드', '가격', '스타일링 포인트', '구매처'],
  },
  interior: {
    name: '인테리어·공간',
    tone: '공간 감성 묘사',
    imageDirection: '인테리어 공간 감성 사진',
    moodKeywords: ['인테리어 감성', '미니멀 홈 photography', '방꾸미기 감성'],
    researchFocus: ['아이템', '가격', '배치 팁', '어디서 사는지'],
  },
  fitness: {
    name: '운동·헬스',
    tone: '동기부여 + 솔직한 리얼',
    imageDirection: '운동 라이프스타일 감성 사진',
    moodKeywords: ['헬스 감성', '필라테스 스튜디오', 'workout aesthetic'],
    researchFocus: ['운동명', '효과', '주의사항', '도구·장소'],
  },
  money_tip: {
    name: '돈 관리·절약',
    tone: '돈 아낀 사람 말투. 액수 구체적',
    imageDirection: '미니멀 라이프 감성 사진',
    moodKeywords: ['미니멀 감성', '알뜰 라이프', 'minimalist aesthetic'],
    researchFocus: ['구체 팁', '절약 금액', '시행 난이도'],
  },
  price_compare: {
    name: '가격 비교',
    tone: '꼼꼼한 비교',
    imageDirection: '플랫레이 감성 사진',
    moodKeywords: ['제품 플랫레이', '비교 감성 photography'],
    researchFocus: ['제품A/B', '가격차', '품질차', '추천 대상'],
  },
  trend: {
    name: '트렌드',
    tone: '최신 정보 포착 느낌',
    imageDirection: 'MZ 감성 일상 필름 사진',
    moodKeywords: ['트렌드 감성', 'MZ 라이프', 'youth aesthetic photography'],
    researchFocus: ['최근 트렌드', '기원', '참여 방법', '참여 사례'],
  },
  review: {
    name: '리뷰',
    tone: '써본 솔직 후기. 장단 모두',
    imageDirection: '제품 또는 장소 실물 감성',
    moodKeywords: ['리얼 리뷰 감성', '비교 사진 photography'],
    researchFocus: ['대상', '장점 3개', '단점 3개', '추천 대상'],
  },
  life_tip: {
    name: '생활 꿀팁',
    tone: '친구한테 알려주듯',
    imageDirection: '생활 소품 플랫레이 감성 사진',
    moodKeywords: ['라이프 감성', '일상 필름', 'everyday aesthetic'],
    researchFocus: ['상황', '팁', '효과', '준비물'],
  },
  etc: {
    name: '기타',
    tone: 'MZ 감성 일상 톤',
    imageDirection: '감성 일상 필름 사진 aesthetic',
    moodKeywords: ['감성 일상', 'MZ 라이프', 'daily aesthetic photography'],
    researchFocus: ['핵심 정보', '실제 사례', '주의점'],
  },
}

// ─────────────────────────────────────────────────────────────
// 주제 → 카테고리 자동 분류
// ─────────────────────────────────────────────────────────────
export function classifyCategory(topic: string): CategoryKey {
  const t = topic.toLowerCase()

  // 뷰티 시술·성형
  if (/시술|성형|보톡스|필러|리프팅|레이저|피부과|코|턱|광대|쌍커풀|지방/.test(topic)) return 'beauty_treatment'
  // 뷰티 제품
  if (/스킨케어|크림|에센스|토너|선크림|파운데이션|립스틱|마스카라|쿠션|화장품|뷰티/.test(topic)) return 'beauty_product'
  // 뷰티 성분
  if (/성분|레티놀|비타민|펩타이드|히알루론|세라마이드|나이아신|아젤라익/.test(topic)) return 'beauty_ingredient'
  // 뷰티 트러블
  if (/여드름|트러블|모공|각질|홍조|기미|주근깨|민감성|지성|건성/.test(topic)) return 'beauty_trouble'

  // 음식·카페
  if (/카페|커피|라떼|아메리카노|음료|디저트 카페/.test(topic)) return 'cafe'
  if (/음식|맛집|식당|요리|레시피|디저트|빵|베이커리|밥|메뉴/.test(topic)) return 'food'

  // 여행
  if (/해외|유럽|일본|태국|미국|여행 추천.*해외|overseas/.test(t)) return 'travel_abroad'
  if (/여행|휴가|국내 여행|제주|부산|서울 여행|강릉|경주/.test(topic)) return 'travel_domestic'

  // 패션·인테리어·운동
  if (/패션|코디|옷|신발|가방|악세|스타일링|룩/.test(topic)) return 'fashion'
  if (/인테리어|방꾸미기|공간|홈|가구|소품|홈카페/.test(topic)) return 'interior'
  if (/운동|헬스|필라테스|요가|러닝|홈트|다이어트|스트레칭/.test(topic)) return 'fitness'

  // 돈·가격·트렌드·리뷰·꿀팁
  if (/절약|돈|재테크|월급|적금|투자|가계부|용돈|알뜰/.test(topic)) return 'money_tip'
  if (/가격|비교|저렴|싸|가성비|최저가/.test(topic)) return 'price_compare'
  if (/트렌드|유행|요즘|인기|MZ|Z세대|밈|핫/.test(topic)) return 'trend'
  if (/리뷰|후기|솔직|써본|사용기/.test(topic)) return 'review'
  if (/꿀팁|팁|방법|how to|하는 법/.test(topic)) return 'life_tip'

  return 'etc'
}

// ─────────────────────────────────────────────────────────────
// 콘텐츠 말투 프리셋 (카드뉴스 전용 — 댓글/DM 학습 말투와 별개)
// ─────────────────────────────────────────────────────────────
export type ContentToneKey = 'warm' | 'friendly' | 'professional' | 'honest' | 'witty' | 'chic'

export const CONTENT_TONES: Record<ContentToneKey, { label: string; guide: string }> = {
  warm: {
    label: '다정한',
    guide: '따뜻하고 부드러운 어조. "~해요", "같이 해봐요" 느낌. 공감 표현 자주.',
  },
  friendly: {
    label: '친근한',
    guide: 'MZ 캐주얼 톤. 반말 살짝 섞음. "~했어", "완전 좋음" 같은 스타일.',
  },
  professional: {
    label: '전문적',
    guide: '정보·신뢰 위주. 감정 표현 절제, 근거·수치 중심. "~입니다" 격식 있는 존댓말.',
  },
  honest: {
    label: '솔직한',
    guide: '직설적·리얼. 단점도 있는 그대로 말함. "광고 아님", "진짜 그랬음" 같은 뉘앙스.',
  },
  witty: {
    label: '재치있는',
    guide: '가벼운 유머·위트. 과장·반전. "레전드", "이게 말이 됨?" 같은 표현.',
  },
  chic: {
    label: '시크한',
    guide: '간결·쿨한 톤. 미사여구 없음. 짧은 단문 위주. 감정 표현 최소.',
  },
}

// ─────────────────────────────────────────────────────────────
// 후킹 패턴 (카테고리 불문 공통)
// ─────────────────────────────────────────────────────────────
export const HOOK_PATTERNS = [
  { name: '가격 반전', example: '"OOO원짜리가 OOO랑 같다고?"' },
  { name: '장소 반전', example: '"의외의 곳에서 이걸 팔고 있었음"' },
  { name: '소외감', example: '"이미 아는 사람은 다 아는데 나만 몰랐던"' },
  { name: '돈 아까움', example: '"이거 알았으면 OO만원 아꼈을텐데"' },
  { name: '반전 결말', example: '"열심히 했는데 오히려 역효과난 이유"' },
  { name: '내부자 폭로', example: '"업계 사람이 직접 알려주는"' },
  { name: '숫자 충격', example: '"10명 중 8명이 모르는 것"' },
]

// ─────────────────────────────────────────────────────────────
// CTA 마지막 슬라이드 패턴 (카테고리 불문)
// ─────────────────────────────────────────────────────────────
export const CTA_PATTERNS = [
  '더 솔직한 거 알고 싶어?\n댓글에 나도 남겨줘 👇\nDM으로 직접 알려줄게',
  '직접 써보고 경험한 것만 공유해\n진짜 아는 사람만 아는 정보\n댓글에 궁금한 거 남겨 👀',
  '광고 아님. 진짜 경험담임\n댓글에 나도 남기면 더 솔직하게 DM 줄게',
  '돈 써보고 깨달은 것\n아끼고 싶으면 꼭 봐\n댓글에 나도 남겨줘 👇',
  '이거 나만 몰랐던 거야? 😅\n진짜 경험자의 솔직한 후기\n댓글에 나도 남기면 DM 보내줄게',
]

// ─────────────────────────────────────────────────────────────
// 이미지 품질 필터 (글자 많은 이미지 유발 단어 제거)
// ─────────────────────────────────────────────────────────────
const IMAGE_BAD_KEYWORDS = [
  'tips', 'tutorial', 'guide', 'how to', 'recipe', 'infographic',
  'quote', 'checklist', 'routine', 'steps', '방법', '순서', '꿀팁',
]

export function cleanImageKeyword(keyword: string): string {
  let clean = keyword
  IMAGE_BAD_KEYWORDS.forEach(bad => {
    clean = clean.replace(new RegExp(bad, 'gi'), '').trim()
  })
  return clean
}

// ─────────────────────────────────────────────────────────────
// System Prompt 빌더 — Claude에게 전달할 전체 프롬프트 생성
// ─────────────────────────────────────────────────────────────
export function buildCardnewsSystemPrompt(args: {
  topic: string
  slideCount: number
  toneStyle?: Record<string, unknown>
  contentTone?: ContentToneKey
}) {
  const { topic, slideCount, toneStyle, contentTone } = args
  const cat = classifyCategory(topic)
  const info = CATEGORIES[cat]

  const toneGuide = toneStyle
    ? `\n유저 말투 참고:\n${JSON.stringify(toneStyle, null, 2)}`
    : ''
  const contentToneInfo = contentTone && CONTENT_TONES[contentTone]
    ? `\n콘텐츠 말투 (${CONTENT_TONES[contentTone].label}):\n${CONTENT_TONES[contentTone].guide}`
    : ''

  const hookExamples = HOOK_PATTERNS
    .map(h => `  · ${h.name}: ${h.example}`)
    .join('\n')

  const researchList = info.researchFocus.map(r => `  · ${r}`).join('\n')
  const ctaPick = CTA_PATTERNS[Math.floor(Math.random() * CTA_PATTERNS.length)]

  return `너는 Instagram 카드뉴스 카피라이터다. 주제를 받으면 ${slideCount}장짜리 감성 캐러셀을 만든다.

## 주제
"${topic}"

## 분류
카테고리: ${info.name}
카테고리 어조 지침: ${info.tone}
${contentToneInfo}
${toneGuide}

## 슬라이드 구성 원칙

### 1장 (표지) — 강한 후킹
아래 패턴 중 1개 선택:
${hookExamples}

20자 이내, 스크롤 멈추게. "${topic}"을 직접 언급하되 궁금증 유발.

### 2장 (프리뷰 / 목차)
"오늘 알려드릴 ${slideCount - 2}가지" 형태. 각 항목 10자 이내.

### 3~${slideCount - 1}장 (본론)
각 슬라이드: 10자 이내 제목 + 2~3줄 본문
리서치 필수 항목:
${researchList}

추상적 이야기 금지. 숫자·가격·브랜드·장소 구체적으로.
광고 아님을 자연스럽게 느끼게.

### ${slideCount}장 (마지막 CTA)
아래 문구 사용:
"${ctaPick}"

## 이미지 방향 (별도 참고)
이 주제의 이미지는 다음 스타일로 찾는다:
${info.imageDirection}
추천 키워드: ${info.moodKeywords.join(', ')}

## 캡션
슬라이드 요약 + 해시태그 6~10개. 카테고리 관련 + 일반 감성 해시태그 섞어서.

## 출력 형식 (JSON only, 코드블록·설명 없이)
{
  "hook": "1장 후킹 문구 (20자 이내)",
  "body": [
    {"title": "2장 제목", "text": "2장 본문 (개행 \\n)"},
    {"title": "3장 제목", "text": "3장 본문"},
    ...
    {"title": "${slideCount}장 제목 (CTA)", "text": "${slideCount}장 본문 (CTA)"}
  ],
  "caption": "게시 캡션 + 해시태그",
  "category": "${cat}",
  "image_keywords": ["이미지 검색 키워드 1", "키워드 2", "키워드 3"]
}`
}
