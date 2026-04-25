// 카드뉴스 AI 프롬프트 엔진 (2026-04 재작성)
// 4개 프롬프트 섹션을 독립적으로 export:
//   TREND_RESEARCH_PROMPT   — 매일 23:00 실행되는 트렌드 리서치
//   CONTENT_GENERATION_PROMPT — 7장 카드뉴스 본문 생성 (후킹 점수 자체평가)
//   IMAGE_PROMPT            — 장별 이미지 소스 우선순위 (Pinterest → Gemini Imagen)
//   CAPTION_PROMPT          — 캡션 + 해시태그
// 뷰티 한정 제거, 범용 카테고리 전부 포함
// 규칙: 반말 강제, 금지어 필터, 이미지 글자 필터, 후킹 점수 7점 미만 재생성

// ─────────────────────────────────────────────────────────────
// 1. 카테고리 (뷰티·라이프·정보 전범주)
// ─────────────────────────────────────────────────────────────
export type CategoryKey =
  | 'beauty_treatment' | 'beauty_product' | 'beauty_ingredient' | 'beauty_trouble'
  | 'food' | 'cafe' | 'travel_domestic' | 'travel_abroad'
  | 'fashion' | 'interior' | 'fitness'
  | 'money_tip' | 'price_compare' | 'trend'
  | 'review' | 'life_tip' | 'book' | 'etc'

export type CategoryInfo = {
  name: string
  tone: string
  imageDirection: string
  moodKeywords: string[]
  researchFocus: string[]
  hashtags: string[]             // 캡션 해시태그 풀 (카테고리별 6~8개)
  productSource?: string         // 제품 실물 이미지 소스 (있으면 우선 참조)
}

export const CATEGORIES: Record<CategoryKey, CategoryInfo> = {
  beauty_treatment: {
    name: '뷰티 시술·성형',
    tone: '솔직한 후기 톤. 가격·다운타임·부작용 숫자 필수',
    imageDirection: '클리닉 피부 감성 클로즈업 사진 (시술 기구 X, 결과 얼굴 O)',
    moodKeywords: ['피부 클로즈업 감성', '얼굴 글로우 photography', 'natural skin aesthetic'],
    researchFocus: ['시술명', '강남언니 평균가', '다운타임', '주의사항', '실제 후기 점수'],
    hashtags: ['#시술후기', '#피부시술', '#강남피부과', '#리프팅', '#스킨부스터'],
  },
  beauty_product: {
    name: '뷰티 제품',
    tone: '써본 사람 말투. 광고 아님 강조. 단점도 솔직',
    imageDirection: '스킨케어 플랫레이 감성 사진',
    moodKeywords: ['스킨케어 플랫레이', '제품 텍스처 클로즈업', '올리브영 감성'],
    researchFocus: ['제품명', '올리브영 가격', '주요 성분', '실제 사용감', '대체 제품'],
    hashtags: ['#화장품추천', '#올리브영', '#뷰티템', '#스킨케어', '#코스메틱'],
    productSource: 'global.oliveyoung.com',
  },
  beauty_ingredient: {
    name: '뷰티 성분',
    tone: '친근하게 과학적. 전문용어는 쉽게 풀어서',
    imageDirection: '세럼 텍스처 클로즈업 감성 photography',
    moodKeywords: ['세럼 텍스처', '화장품 클로즈업 감성', 'cosmetic close-up'],
    researchFocus: ['성분명', '효능', '주의 대상', '좋은 조합', '부작용 사례'],
    hashtags: ['#성분분석', '#스킨케어', '#뷰티꿀팁', '#피부관리', '#세럼'],
  },
  beauty_trouble: {
    name: '뷰티 트러블·케어',
    tone: '공감형. "나도 그랬어" 톤',
    imageDirection: '피부결 클로즈업 감성 사진',
    moodKeywords: ['피부결 클로즈업', '자연스러운 얼굴 감성', 'skin texture close-up'],
    researchFocus: ['원인', '해결법', '추천 제품', '병원 진료 필요 시점'],
    hashtags: ['#여드름', '#피부고민', '#트러블케어', '#스킨케어', '#피부관리'],
  },
  food: {
    name: '음식·맛집',
    tone: '침 고이게 묘사. 실제 가본 사람 말투',
    imageDirection: '[음식명] 플레이팅 클로즈업 감성 사진 필름',
    moodKeywords: ['음식 플레이팅', '디저트 클로즈업', 'food aesthetic photography'],
    researchFocus: ['음식명', '가격대', '메뉴 특징', '방문 팁', '웨이팅'],
    hashtags: ['#맛집', '#음식스타그램', '#맛집추천', '#푸드스타그램', '#먹스타그램'],
  },
  cafe: {
    name: '카페·음료',
    tone: '감성적. 분위기 포함',
    imageDirection: '카페 음료 감성 필름 사진',
    moodKeywords: ['카페 감성', '음료 클로즈업', 'cafe aesthetic film'],
    researchFocus: ['카페명', '시그니처 메뉴', '가격', '분위기', '위치'],
    hashtags: ['#카페', '#카페스타그램', '#카페투어', '#감성카페', '#디저트'],
  },
  travel_domestic: {
    name: '국내 여행',
    tone: '여행자 말투. 가기 전 정보 위주',
    imageDirection: '[장소명] 여행 감성 필름 사진',
    moodKeywords: ['여행 감성', '풍경 필름', 'korean travel aesthetic'],
    researchFocus: ['지역명', '대중교통', '비용', '꼭 봐야 할 포인트', '실제 후기'],
    hashtags: ['#국내여행', '#여행꿀팁', '#여행정보', '#여행스타그램', '#주말여행'],
  },
  travel_abroad: {
    name: '해외 여행',
    tone: '현지인 팁 뉘앙스',
    imageDirection: '[장소명] 해외 여행 풍경 감성 사진',
    moodKeywords: ['travel aesthetic', '해외 여행 필름', 'landscape photography'],
    researchFocus: ['도시/국가', '항공편', '숙소', '현지 팁', '예산'],
    hashtags: ['#해외여행', '#여행꿀팁', '#여행정보', '#여행스타그램', '#배낭여행'],
  },
  fashion: {
    name: '패션·코디',
    tone: 'MZ 패션 블로거 말투',
    imageDirection: '코디 감성 필름 사진 aesthetic',
    moodKeywords: ['오오티디 감성', '스트릿 패션 필름', 'fashion aesthetic photography'],
    researchFocus: ['브랜드', '가격', '스타일링 포인트', '구매처'],
    hashtags: ['#오오티디', '#코디', '#패션', '#데일리룩', '#무신사'],
  },
  interior: {
    name: '인테리어·공간',
    tone: '공간 감성 묘사',
    imageDirection: '인테리어 공간 감성 사진',
    moodKeywords: ['인테리어 감성', '미니멀 홈 photography', '방꾸미기 감성'],
    researchFocus: ['아이템', '가격', '배치 팁', '어디서 사는지'],
    hashtags: ['#인테리어', '#방꾸미기', '#홈인테리어', '#미니멀', '#자취'],
  },
  fitness: {
    name: '운동·헬스',
    tone: '동기부여 + 솔직한 리얼',
    imageDirection: '라이프스타일 운동 감성 사진',
    moodKeywords: ['헬스 감성', '필라테스 스튜디오', 'workout aesthetic'],
    researchFocus: ['운동명', '효과', '주의사항', '도구·장소'],
    hashtags: ['#운동', '#헬스', '#필라테스', '#홈트', '#다이어트'],
  },
  money_tip: {
    name: '돈 관리·절약',
    tone: '돈 아낀 사람 말투. 액수 구체적',
    imageDirection: '미니멀 라이프 감성 사진',
    moodKeywords: ['미니멀 감성', '알뜰 라이프', 'minimalist aesthetic'],
    researchFocus: ['구체 팁', '절약 금액', '시행 난이도'],
    hashtags: ['#절약', '#재테크', '#돈관리', '#가계부', '#짠테크'],
  },
  price_compare: {
    name: '가격 비교',
    tone: '꼼꼼한 비교',
    imageDirection: '플랫레이 비교 감성 사진',
    moodKeywords: ['제품 플랫레이', '비교 감성 photography'],
    researchFocus: ['제품A/B', '가격차', '품질차', '추천 대상'],
    hashtags: ['#가성비', '#가격비교', '#비교리뷰', '#쇼핑꿀팁', '#할인정보'],
  },
  trend: {
    name: '트렌드',
    tone: '최신 정보 포착 느낌',
    imageDirection: 'MZ 감성 일상 필름 사진',
    moodKeywords: ['트렌드 감성', 'MZ 라이프', 'youth aesthetic photography'],
    researchFocus: ['최근 트렌드', '기원', '참여 방법', '참여 사례'],
    hashtags: ['#트렌드', '#요즘뜨는', '#MZ', '#인기', '#핫템'],
  },
  review: {
    name: '리뷰',
    tone: '써본 솔직 후기. 장단 모두',
    imageDirection: '제품 또는 장소 실물 감성',
    moodKeywords: ['리얼 리뷰 감성', '비교 사진 photography'],
    researchFocus: ['대상', '장점 3개', '단점 3개', '추천 대상'],
    hashtags: ['#리뷰', '#직접써봄', '#비교리뷰', '#추천', '#후기'],
  },
  life_tip: {
    name: '생활 꿀팁',
    tone: '친구한테 알려주듯',
    imageDirection: '라이프스타일 감성 일상 사진',
    moodKeywords: ['라이프 감성', '일상 필름', 'everyday aesthetic'],
    researchFocus: ['상황', '팁', '효과', '준비물'],
    hashtags: ['#꿀팁', '#라이프해킹', '#일상꿀팁', '#생활팁', '#저장각'],
  },
  book: {
    name: '책·독서',
    tone: '밑줄 친 사람 말투. 실제 책 제목·작가 이름 필수',
    imageDirection: 'vintage book aesthetic photography',
    moodKeywords: ['책 감성', 'vintage book aesthetic', 'reading aesthetic'],
    researchFocus: ['책 제목', '작가', '유명 인용구', '출판 연도', '평점/베스트셀러 기록'],
    hashtags: ['#책스타그램', '#독서', '#북스타그램', '#책추천', '#밑줄'],
  },
  etc: {
    name: '기타',
    tone: 'MZ 감성 일상 톤',
    imageDirection: '라이프스타일 감성 일상 사진',
    moodKeywords: ['감성 일상', 'MZ 라이프', 'daily aesthetic photography'],
    researchFocus: ['핵심 정보', '실제 사례', '주의점'],
    hashtags: ['#일상', '#데일리', '#기록', '#라이프', '#요즘'],
  },
}

// ─────────────────────────────────────────────────────────────
// 주제 → 카테고리 자동 분류
// ─────────────────────────────────────────────────────────────
export function classifyCategory(topic: string): CategoryKey {
  const t = topic.toLowerCase()
  if (/시술|성형|보톡스|필러|리프팅|레이저|피부과|코|턱|광대|쌍커풀|지방/.test(topic)) return 'beauty_treatment'
  if (/스킨케어|크림|에센스|토너|선크림|파운데이션|립스틱|마스카라|쿠션|화장품|뷰티/.test(topic)) return 'beauty_product'
  if (/성분|레티놀|비타민|펩타이드|히알루론|세라마이드|나이아신|아젤라익/.test(topic)) return 'beauty_ingredient'
  if (/여드름|트러블|모공|각질|홍조|기미|주근깨|민감성|지성|건성/.test(topic)) return 'beauty_trouble'
  if (/카페|커피|라떼|아메리카노|음료|디저트 카페/.test(topic)) return 'cafe'
  if (/음식|맛집|식당|요리|레시피|디저트|빵|베이커리|밥|메뉴/.test(topic)) return 'food'
  if (/해외|유럽|일본|태국|미국|overseas/.test(t)) return 'travel_abroad'
  if (/여행|휴가|국내 여행|제주|부산|서울 여행|강릉|경주/.test(topic)) return 'travel_domestic'
  if (/패션|코디|옷|신발|가방|악세|스타일링|룩/.test(topic)) return 'fashion'
  if (/인테리어|방꾸미기|공간|홈|가구|소품|홈카페/.test(topic)) return 'interior'
  if (/운동|헬스|필라테스|요가|러닝|홈트|다이어트|스트레칭/.test(topic)) return 'fitness'
  if (/절약|돈|재테크|월급|적금|투자|가계부|용돈|알뜰/.test(topic)) return 'money_tip'
  if (/가격|비교|저렴|싸|가성비|최저가/.test(topic)) return 'price_compare'
  if (/트렌드|유행|요즘|인기|MZ|Z세대|밈|핫/.test(topic)) return 'trend'
  if (/리뷰|후기|솔직|써본|사용기/.test(topic)) return 'review'
  if (/책|독서|소설|에세이|자기계발|베스트셀러|북스타그램|한 권|book|novel|reading/i.test(topic)) return 'book'
  if (/꿀팁|팁|방법|how to|하는 법/.test(topic)) return 'life_tip'
  return 'etc'
}

// ─────────────────────────────────────────────────────────────
// 콘텐츠 말투 프리셋 (계정 컨셉 어조 · 댓글/DM 학습 말투와 별개)
// ─────────────────────────────────────────────────────────────
export type ContentToneKey = 'warm' | 'friendly' | 'professional' | 'honest' | 'witty' | 'chic'

export const CONTENT_TONES: Record<ContentToneKey, { label: string; guide: string; examples: string }> = {
  warm: {
    label: '다정한',
    guide: '따뜻하고 부드러운 공감. "같이 해봐요" "괜찮아" 류. 부정 표현 최소화',
    examples: '예: "속상했지? 나도 그랬어" / "조금씩 가보자, 괜찮아질 거야"',
  },
  friendly: {
    label: '친근한',
    guide: 'MZ 캐주얼 반말. 친구한테 말하듯. "~했어" "완전 좋음" "찐" "진심" 사용',
    examples: '예: "이거 찐이야 진짜" / "완전 레전드임"',
  },
  professional: {
    label: '전문적',
    guide: '객관적·수치 중심·근거 기반. 감정·과장 표현 전부 제거. 단 "~입니다" 대신 "~야/~임" 단호한 반말 유지',
    examples: '예: "YES24 10주 연속 1위. 30만 독자 선택의 이유" / "클리닉 평균 50만원. 6개월 지속 87% (강남언니 기준)"',
  },
  honest: {
    label: '솔직한',
    guide: '직설·리얼. 단점도 있는 그대로. "광고 아님" "내돈내산" 강조. 돌려 말하지 않음',
    examples: '예: "3만원 아깝더라, 솔직히" / "이건 광고 아니고 그냥 내돈내산"',
  },
  witty: {
    label: '재치있는',
    guide: '유머·위트 강제. 반전·과장·재치 표현 필수. "레전드" "이게 말이 됨?" "???" "충격주의" 류',
    examples: '예: "이거 안 해본 나 바보... 진짜 레전드" / "3만원에 이 퀄리티? 제정신이야?"',
  },
  chic: {
    label: '시크한',
    guide: '간결·쿨. 미사여구 전부 제거. 짧은 단문. 감정 표현 없음. 여백감',
    examples: '예: "3만원. 15일 썼음." / "결과만 말함. 효과 있음."',
  },
}

// ─────────────────────────────────────────────────────────────
// 금지 표현 (CONTENT_GENERATION 필터 — 생성 시 제거 후 재요청)
// ─────────────────────────────────────────────────────────────
export const BANNED_PHRASES = [
  '추천합니다', '효과적인', '놀라운', '완벽한', '최고의',
  '도움이 됩니다', '좋은 제품', '사용해보세요',
  '~해보세요', '~입니다', '~습니다',
]

// ─────────────────────────────────────────────────────────────
// 고정 CTA 5패턴 (7장 마지막 슬라이드 · 랜덤 선택)
// ─────────────────────────────────────────────────────────────
export const CTA_PATTERNS = [
  '이 정보 나만 알기 아까워서 올림\n다음편은 팔로우하면 볼 수 있음',
  '저장해두면 나중에 찾기 편해\n다음편 계속 올릴 예정',
  '댓글에 \'나도\' 남기면\nDM으로 더 솔직한 정보 보내줄게',
  '이런 거 궁금한 친구 있으면 태그해줘\n같이 보는 게 더 재밌으니까',
  '팔로우하면 이런 정보 매일 올라옴\n광고 아님, 내 경험담',
]

// ─────────────────────────────────────────────────────────────
// 캡션 참여유도 5패턴
// ─────────────────────────────────────────────────────────────
export const CAPTION_CTA_PATTERNS = [
  '아는 사람한테 알려주고 싶으면 태그해',
  '저장해두고 나중에 봐',
  '댓글에 [키워드] 남기면 DM 줄게',
  '이거 어때? 댓글로 알려줘',
  '다음편도 팔로우하고 봐',
]

// ─────────────────────────────────────────────────────────────
// 이미지 글자 필터 (검색 금지 키워드)
// ─────────────────────────────────────────────────────────────
export const IMAGE_BAD_KEYWORDS = [
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
// 후킹 점수 자체 평가 (CONTENT_GENERATION에서 Claude가 스스로 채점)
// 숫자/가격 +3, 결말 예측 불가 +2, 태그 욕구 +3, 금지어 없음 +2
// 7점 미만 → 재생성 (최대 2회)
// ─────────────────────────────────────────────────────────────
export type HookScore = {
  hasNumber: boolean
  unpredictable: boolean
  tagWorthy: boolean
  noBanned: boolean
  total: number
}
export function scoreHook(hook: string): HookScore {
  const hasNumber = /\d/.test(hook)
  const noBanned = !BANNED_PHRASES.some(p => hook.includes(p.replace(/^~/, '')))
  // unpredictable·tagWorthy 는 휴리스틱 — 반전/소외/폭로 키워드 있으면 true
  const unpredictable = /의외|반전|사실|몰랐|역효과|진짜|오히려|vs/.test(hook)
  const tagWorthy = /\?|😱|🤯|🔥|진짜|대박|레전드|소문/.test(hook)
  const total =
    (hasNumber ? 3 : 0) +
    (unpredictable ? 2 : 0) +
    (tagWorthy ? 3 : 0) +
    (noBanned ? 2 : 0)
  return { hasNumber, unpredictable, tagWorthy, noBanned, total }
}

// ═════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════
//                 1. TREND_RESEARCH_PROMPT
//         매일 23:00 cron에서 Claude에 보내는 프롬프트
// ═════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════
export const TREND_RESEARCH_PROMPT = `너는 한국 MZ 세대 SNS 트렌드 큐레이터다.
매일 밤 전날 수집된 데이터를 받아 다음 날 올릴 카드뉴스 주제 TOP 3를 추천한다.

## 소스 리스트 (이 중 뷰·반응 높은 TOP5 추출)
[해외]
- Reddit: r/SkincareAddiction, r/AsianBeauty, r/beauty, r/LifeProTips, r/travel, r/food
- Quora 인기 질문

[국내 SNS]
- X(트위터) 실시간 인기 트윗
- 스레드 인기 게시물
- 인스타그램 인기 해시태그

[쇼핑/커뮤니티]
- 올리브영 실시간 랭킹
- 무신사 베스트
- 네이버 카페 인기글

## 입력 데이터 형식
{rawFeedItems}
(각 아이템: { source, title, excerpt, engagement, url })

## TOP5 추출 기준
- 중복 주제 병합
- 최근 24시간 내 engagement 상위

## TOP5 각각에 대해 Claude 분석
1. 공통 관심사 파악
2. 정보 수집 가능성 평가 (실제 제품명/가격/후기 확인 가능한 것 우선)
3. 카테고리 분류: 시술 / 제품 / 트렌드 / 라이프 / 음식 / 여행 / 패션 / 꿀팁
4. 후킹 가능성 점수 1~10

## 최종 출력 (JSON only)
{
  "top5": [
    { "title": "...", "source": "...", "engagement": 숫자, "category": "...",
      "researchable": true/false, "hook_score": 1~10 }
  ],
  "recommended_topics": [
    {
      "topic": "유저에게 보여줄 주제 한 줄 (30자 이내)",
      "category": "카테고리 키",
      "why": "왜 이 주제가 오늘 좋은지 한 줄",
      "preview_hook": "1장 후킹 예상 문구 (15자 이내)"
    }
    // 정확히 3개
  ]
}
`

// ═════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════
//             2. CONTENT_GENERATION_PROMPT
//       주제 + 리서치 데이터 → 7장 카드뉴스
// ═════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════
export function buildContentGenerationPrompt(args: {
  accountConcept: string         // "K-뷰티 인플루언서 유민혜" 같은 컨셉 한 줄
  topic: string
  researchData: string           // 실제 조사된 정보 블록 (없으면 빈 문자열)
  slideCount?: number            // 기본 7
  toneStyle?: Record<string, unknown>
  contentTone?: ContentToneKey
}): string {
  const slideCount = args.slideCount || 7
  const cat = classifyCategory(args.topic)
  const info = CATEGORIES[cat]
  const ctaPick = CTA_PATTERNS[Math.floor(Math.random() * CTA_PATTERNS.length)]
  const toneGuide = args.toneStyle ? `\n[학습된 유저 말투 — 부가 참고용만]\n${JSON.stringify(args.toneStyle, null, 2)}` : ''
  const toneInfo = args.contentTone && CONTENT_TONES[args.contentTone] ? CONTENT_TONES[args.contentTone] : null
  const contentToneBlock = toneInfo
    ? `

## 🎨 어조 강제 (최우선 · 다른 모든 지시보다 우선)
유저가 선택한 어조: **${toneInfo.label}**

${toneInfo.guide}

톤 예시 (반드시 이 느낌으로):
${toneInfo.examples}

이 어조가 후킹·본문·CTA 전체에 일관되게 드러나야 함.
어조에 어긋나면 재작성.
`
    : ''
  const researchBlock = args.researchData?.trim()
    ? args.researchData.trim()
    : '※ 별도 리서치 데이터는 없음. 네가 학습한 공개 지식(잘 알려진 책·제품·장소·통계 등)은 적극 활용해도 됨. 단, 지어내지 말고 "확실하지 않은 건 빼는" 방향으로 작성. "정확 수치 확인 필요" 같은 placeholder 문구는 절대 출력 금지.'

  return `너는 ${args.accountConcept}다.
아래 실제 조사된 정보로 카드뉴스 ${slideCount}장을 기획해.
**절대 정보 지어내지 마. 모르면 모른다고 써.**

## 🚨 주제 절대 변경 금지
입력 주제: "${args.topic}"
이 주제로만 작성. 다른 주제로 변형하면 즉시 실패.
예: "봄 데이트룩 코디" → 옷 코디만. 성형·시술·다른 카테고리로 빠지면 안 됨.

## 🚨 안전 가이드 (의학·건강·금융 주제)
다음은 절대 작성 금지:
  · 비현실적·위험 다이어트 ("7일 5kg 감량" 등 - 안전한 감량은 주 0.5~1kg)
  · 의료 시술 효과 단정 ("절대 부작용 없음" 등)
  · "100% 보장" 같은 단정형 보장 (투자·재테크·다이어트 등)
  · 의사·전문가 사칭하는 의학 조언
  · 출처 없는 통계 (✗ "10명 중 9명이..." → ✓ "(서울대 2023 조사 기준)")

위 주제는 후킹 약하게 가더라도 **안전 우선**. 거짓 정보로 후킹 점수 채우지 마.
${contentToneBlock}
## 주제
"${args.topic}"
카테고리: ${info.name}
카테고리 어조 지침: ${info.tone}${toneGuide}

## 조사된 실제 정보
${researchBlock}

## ⚠️⚠️ 절대 규칙
- 반말 필수 (~입니다/~습니다 금지)
- body 배열은 **정확히 ${slideCount - 1}개** 원소 (1장 hook + ${slideCount - 1}개 body = 총 ${slideCount}장)
  · **하나라도 적거나 많으면 재작성**. 절대 타협 X.
  · body 배열은 네가 세상에 알려진 충분한 데이터로 반드시 채울 수 있어.
- 각 슬라이드의 title·text 필드에 "슬라이드 N", "N장", "N번째 슬라이드" 같은 메타 라벨 절대 금지
  · 이건 내부 구조일 뿐. 유저가 읽을 카피만 써.
- **🚫 이모지 전면 금지** — hook / cover_subtitle / body / cta 어디에도 이모지 0개.
  · 😱 🤯 ✨ 💯 🔥 등 모든 이모티콘 / 픽토그램 / 심볼 사용 금지
  · 이모지 들어가는 순간 카드뉴스 톤이 떨어짐. 텍스트만으로 임팩트 만들어
  · 단 ❤️ 🔖 ➕ 같은 IG 액션 심볼은 CTA 슬라이드에서만 허용 (저장·팔로우·댓글 유도용)

## 🔴 구체성 규칙 (유저가 제일 중요하게 보는 부분)
- 각 본론 슬라이드는 **구체적 사례·이름·숫자** 중 최소 1개 포함
  · 책 이름(예: 《원씽》, 《미드나잇 라이브러리》)
  · 공개된 가격대(예: "2~3만원대", "스탠다드 9,900원")
  · 기간/빈도(예: "주 3회", "6개월", "매일 아침 10분")
  · 순위·평점(예: "YES24 베스트 10주 연속")
  · 실제 작가·공인 인물의 공개 발언
- **placeholder 문구 절대 금지** (너무 자주 나와서 심각)
  · "정확 수치 확인 필요" 금지
  · "리서치 데이터 부족" 금지
  · "데이터가 없어서" 금지
  · "~일 수도 있어" 식의 회피 금지
- 공개된 잘 알려진 정보는 적극 사용해도 됨 (네 학습 지식 기반). 단 확실한 것만.
  · 예: "《원씽》은 '한 번에 한 가지만' 원칙을 강조한 책"
  · 예: "스타벅스 아메리카노 톨 사이즈 4,700원 (2026년 기준)"
- **확실하지 않으면 그 수치·이름을 빼고, 대신 구체적인 '상황 묘사'로 대체**
  · (나쁨) "독서가 습관이 된 사람들의 비율 - 정확 수치 확인 필요"
  · (좋음) "출근길 지하철에서 매일 한 챕터씩 읽는 독서가들의 공통점"
- 모호 표현 금지: "케이스마다 달라" · "사람마다 달라" · "천차만별" · "상황에 따라"

## 금지 표현
${BANNED_PHRASES.map(p => `  · "${p}"`).join('\n')}
추가 금지: "케이스마다", "사람마다", "상황에 따라", "다양해", "천차만별", "확인 필요", "데이터 부족"

## 장별 구성 (인스타 캐러셀 최적)

### 1번 슬라이드 — 후킹 제목 + 부제목
- hook 필드: 15자 이내, 엄지 멈추게 하는 한 줄
- cover_subtitle 필드(별도): 한 줄 부제목 — 1번 후킹을 부연하거나 궁금증 증폭 (20자 이내)
- 예시 hook: "강남 50만원 시술 vs 3만원 크림, 써봄"
  예시 cover_subtitle: "3개월 실제 써본 솔직 후기"
- 숫자 충격 / 반전 / 소외감 / 비밀 공개 중 1개
- 이모지 1~2개 이내. 물음표·말줄임표 과다 금지

### 2번 슬라이드 — 이중 후킹 (중요!!)
- body[0] 이 2번 슬라이드가 됨
- **이유**: 인스타가 알고리즘상 피드에서 2번째 슬라이드부터 먼저 보여주는 경우 있음
  → 2번이 단독으로 봐도 후킹 되게 써야 함
- 1번과 다른 각도로 한 번 더 후킹 (예: "근데 이거 몰랐으면 5만원 날릴 뻔")
- title: 6자 이내 임팩트 소제목
- text: 2~3줄, "궁금증 폭발 + 댓글 유도"

### 3번~${slideCount - 1}번 슬라이드 — 본문 (핵심)
- body[1]~body[${slideCount - 3}] 이 여기 해당
- **"저장·공유할 만한" 퀄리티만 작성**. 두루뭉술하거나 흔한 내용은 그 슬라이드를 삭제하고 다른 포인트로 대체
- title: 6자 이내 소제목 (예: "10억 만든", "새벽 기상법")
- **text: 반드시 5~7줄 (각 줄 18~35자) · 총 130~250자**
  · 너무 짧으면 정보 부족 → 저장 가치 X. **5줄 미만이면 무조건 재작성**.
  · 정보를 충분히 담아야 함. 한 슬라이드가 그 자체로 완결된 정보
- **줄바꿈(\\n) 반드시 사용. 한 줄 = 한 의미** — 절대 한 덩어리로 쓰지 마
  · (나쁨, 정보 부족) "매일 10분 걷기"
  · (나쁨, 한덩어리) "매일 10분 걷기부터 시작해서 심박수 120-140 유지하면 6주 만에..."
  · (좋음) "매일 아침 6시 30분 기상\\n공복에 미지근한 물 500ml\\n10분 동안 가볍게 걷기 시작\\n심박수 120-140 유지가 핵심\\n6주 차에 5km 비공식 기록 단축\\n(러닝 입문자 평균 기준)"
- 숫자·책제목·브랜드·가격·시간 중 **최소 2개** 필수
- 출처 한 줄 필수 (예: "(YES24 베스트셀러 10주)", "(올리브영 평균가)")
- 비교 구조 권장: A vs B vs C

**모든 본문은 role="body" 만 사용** — checklist/number/toc 옵션 제거됨. 일관된 본문 슬라이드만.

### ${slideCount}번 슬라이드 (마지막) — 저장·팔로우·댓글 유도 CTA
- body[${slideCount - 2}] 이 여기 해당
- title: 한 줄 후킹 (예: "다음편 놓치지 마")
- text 반드시 아래 톤으로:
  "${ctaPick}"
- "❤️ 저장" / "👉 팔로우" / "💬 댓글" 중 **구체 액션 2~3개** 포함
- 단순 인사말 금지 ("감사합니다" 금지)

## 후킹 점수 자체 평가
1장 생성 후 점수 체크 (만점 10):
  · 숫자/가격 포함 여부 (+3)
  · 결말 예측 안 됨 (+2)
  · 친구한테 태그하고 싶음 (+3)
  · 금지어 없음 (+2)
→ 7점 미만이면 hook 재작성 (내부에서 최대 2회). 최종만 출력.

## 🔥 저장·공유 가치 자체 평가 (가장 중요 · 콘텐츠의 본질)
**카드뉴스의 목적은 "저장 + 공유" 다.** 후킹만 좋고 내용 부실하면 0점.
각 본문 슬라이드(role: body/checklist/number)는 다음 5가지 중 최소 3개 충족해야 함:

  ✅ 즉시 적용 가능한 구체 행동 / 레시피 / 단계
     예: "오후 2시 이후 카페인 금지" / "냉동딸기 5개 + 연유 2숟갈"
  ✅ 실제 가격·시간·수치 (추정 X, 공식 자료 기반)
     예: "유니클로 크롭니트 29,000원" / "다이소 막대걸레 3,000원"
  ✅ 실명 (브랜드·제품·앱·사람·장소)
     예: "신한 페이북 / 우리 스마트포인트 / 현대 M포인트"
  ✅ 비교 구조 (A vs B vs C)
     예: "스타벅스 빅맥보다 칼로리 높은 음료 3개"
  ✅ 출처 명시 (괄호 안)
     예: "(올리브영 평균가)" / "(소아과학회 가이드라인)"

⛔ 다음은 절대 통과 X — 위험·거짓·두루뭉:
  · "7일에 5kg 감량" 류 비현실적·의학적 위험 정보
  · "이거 하나면 끝" 같은 만능 표현 (구체 액션 없음)
  · "사람마다 다름" 같은 회피 (당연한 말 = 정보 0)
  · 출처 없는 통계·수치 (지어내는 것)

본문 슬라이드별로 위 5개 중 몇 개 충족했는지 self-check.
**3개 미만이면 그 슬라이드 재작성 (내부에서). 최종 답만 출력.**

저장·공유 점수 (만점 10):
  · 캡쳐해두고 싶은 정보? (+3)
  · 친구한테 보내주고 싶은 정보? (+3)
  · 1주일 뒤에 다시 봐도 유용? (+2)
  · 가격·시간·이름 등 구체성 있음? (+2)
→ 7점 미만이면 본문 전부 재작성. 최종만 출력.

## 출력 형식 (JSON only, 코드블록·설명 없이)
{
  "hook": "후킹 제목 한 줄 (15자 이내)",
  "cover_subtitle": "부제목 한 줄 (20자 이내)",
  "hook_score": 8,
  "body": [
    { "role": "hook2",  "title": "이중 후킹 소제목", "text": "인스타 2번째 단독 노출 대비 다른 각도 후킹 2~3줄", "entities": [] },
    { "role": "body",   "title": "본문 소제목 1",  "text": "수치·책·가격·출처 포함된 4~6줄\\n줄바꿈 필수", "entities": [{"type":"book","name":"원씽"}] },
    { "role": "body",   "title": "본문 소제목 2",  "text": "...", "entities": [{"type":"product","name":"제품 정확한 이름"}] },
    { "role": "body",   "title": "본문 소제목 3",  "text": "..." },
    { "role": "body",   "title": "본문 소제목 4",  "text": "..." },
    { "role": "cta",    "title": "CTA 후킹",      "text": "${ctaPick.replace(/\n/g, '\\n')}" }
  ],
  "category": "${cat}",
  "image_keywords": [
    "cover 영어 감성 키워드",
    "hook2 영어 키워드",
    "body1 키워드",
    "body2 키워드",
    "body3 키워드",
    "body4 키워드",
    ""
  ]
}

주의: body 배열 길이는 반드시 ${slideCount - 1}. 위 예시는 ${slideCount}=7 일 때. body[0]=hook2, 마지막=cta, 중간이 body.
title/text 에 "슬라이드 N"·"N장" 같은 라벨 절대 쓰지 마. 이건 내부 구조용 메타라벨.

## 🔵 entities 필드 (실존 이미지 자동 매칭용)
각 body 슬라이드에 등장하는 **실존하는 책·제품·브랜드** 가 있으면 entities 배열에 명시:
- type: "book" (책 제목 — 《...》 표기된 거)
- type: "product" (특정 제품명 — 라네즈 워터슬리핑마스크, 아이허브 비타민C 등)
- type: "brand" (브랜드 — 스타벅스, 올리브영, 무신사)
- type: "place" (특정 장소 — 강남 삼원가든, 제주 협재해변)
- name: 정확한 한국어 명칭
- **name_en: 영어 원제·영문명** (책은 거의 모두 있음, 알면 반드시 명시)
  · 《원씽》 → name_en: "The ONE Thing"
  · 《미드나잇 라이브러리》 → name_en: "The Midnight Library"
  · 《돈의 심리학》 → name_en: "The Psychology of Money"
  · 라네즈 → name_en: "Laneige"
  · 올리브영 → name_en: "Olive Young"

→ 이 정보로 백엔드가 실제 책표지·제품 이미지를 fetch 해서 슬롯에 넣음.
→ 모르겠으면 entities 배열은 비워둬. 지어내지 마.

## 🔴 role 필드 사용 시 필수 추가 필드
role 을 hook2/body/cta 외 다른 값으로 쓸 거면 해당 필드 **반드시** 채울 것:
- role: "checklist" → "list": [{"ok": true|false, "text": "..."}] 3~6개 필수
- role: "number"    → "big_number": "...", "sub": "..." 필수
- role: "toc"       → "items": ["...", ...] 3~5개 필수

이 필드들이 빠지면 슬라이드가 빈 화면으로 보임. 못 채울 거면 그냥 role: "body" 로 작성.
`
}

// 기존 이름 호환 (generate/route.ts 이미 사용 중)
export function buildCardnewsSystemPrompt(args: {
  topic: string
  slideCount: number
  toneStyle?: Record<string, unknown>
  contentTone?: ContentToneKey
  researchData?: string
  accountConcept?: string
}): string {
  return buildContentGenerationPrompt({
    accountConcept: args.accountConcept || '한국 MZ 세대 SNS 크리에이터',
    topic: args.topic,
    researchData: args.researchData || '',
    slideCount: args.slideCount,
    toneStyle: args.toneStyle,
    contentTone: args.contentTone,
  })
}

// ═════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════
//                   3. IMAGE_PROMPT
//    장별 이미지 소스 우선순위 (Pinterest → Gemini Imagen)
// ═════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════
export const IMAGE_PROMPT = `장별 이미지 소스 우선순위:

1장: Pinterest → "감성 [주제키워드] 사진 aesthetic"
2장: Pinterest → "[카테고리] 클로즈업 감성 사진 필름"
3~5장:
  제품류 → 올리브영 global.oliveyoung.com 제품 실물 이미지
  시술류 → Pinterest → "클리닉 피부 감성 클로즈업 사진"
  여행류 → Pinterest → "[장소명] 여행 감성 필름 사진"
  음식류 → Pinterest → "[음식명] 플레이팅 클로즈업 감성 사진"
  패션류 → Pinterest → "코디 감성 필름 사진 aesthetic"
  기타   → Pinterest → "라이프스타일 감성 일상 사진"
6장: Pinterest 무드 이미지 또는 텍스트 카드
7장: 고정 (교체 없음)

Fallback: Gemini Imagen
  프롬프트: "photorealistic [주제] photo, Korean style, natural lighting, no text, no illustration"

글자 없는 이미지 필터:
  · 검색어에 반드시 '감성 사진' 또는 'aesthetic photography' 포함
  · 금지 키워드: 'tips', 'tutorial', 'how to', 'infographic', '방법', '꿀팁'
  · URL 앞 5개 스킵 (광고/배너)
  · 3~15번째 중 랜덤 선택
`

// 장별 Pinterest 검색어 생성기 — 프론트에서 사용
// idx: 0-based (0=1장, 1=2장, …)
export function buildPinterestQuery(args: {
  idx: number
  topic: string
  category: CategoryKey
  hookKeyword?: string
}): string {
  const info = CATEGORIES[args.category]
  const base = args.idx === 0
    ? `감성 ${args.topic} 사진 aesthetic`
    : args.idx === 1
    ? `${info.name} 클로즈업 감성 사진 필름`
    : args.idx === 5
    ? info.moodKeywords[0] || `${info.name} 감성`
    : info.imageDirection.replace('[음식명]', args.topic)
                        .replace('[장소명]', args.topic)
                        .replace('[주제키워드]', args.topic)
  return cleanImageKeyword(base)
}

// Gemini Imagen fallback 프롬프트 생성기
export function buildGeminiImagenPrompt(topic: string): string {
  return `photorealistic ${topic} photo, Korean style, natural lighting, no text, no illustration, no typography`
}

// 7장 카드뉴스의 장별 이미지 소스 결정 (우선순위 반영)
//   1,2,6장: Pinterest만
//   3~5장: 카테고리별 (제품류 → 올리브영 직링크, 나머지 → Pinterest)
//   7장: 고정 (교체 없음)
export type SlideImagePlan = {
  mode: 'pinterest' | 'oliveyoung' | 'fixed'
  pinterestQuery?: string
  oliveYoungQuery?: string
  geminiPrompt?: string           // fallback 전용
}
export function planSlideImages(args: {
  topic: string
  category: CategoryKey
  slideCount: number
}): SlideImagePlan[] {
  const plans: SlideImagePlan[] = []
  for (let i = 0; i < args.slideCount; i++) {
    if (i === args.slideCount - 1) {
      plans.push({ mode: 'fixed' })  // 마지막 CTA 고정
      continue
    }
    if (i >= 2 && i <= 4 && args.category === 'beauty_product') {
      plans.push({
        mode: 'oliveyoung',
        oliveYoungQuery: args.topic,
        geminiPrompt: buildGeminiImagenPrompt(args.topic),
      })
      continue
    }
    plans.push({
      mode: 'pinterest',
      pinterestQuery: buildPinterestQuery({ idx: i, topic: args.topic, category: args.category }),
      geminiPrompt: buildGeminiImagenPrompt(args.topic),
    })
  }
  return plans
}

// Pinterest 검색 URL (프론트에서 window.open 용)
export function pinterestSearchUrl(query: string): string {
  return `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`
}
// 올리브영 검색 URL
export function oliveYoungSearchUrl(query: string): string {
  return `https://global.oliveyoung.com/search?query=${encodeURIComponent(query)}`
}

// ═════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════
//                  4. CAPTION_PROMPT
//           캡션 (첫줄=hook · 본문 · CTA · 해시태그)
// ═════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════
export const CAPTION_PROMPT = `캡션 구조:
첫줄: 1장 후킹 문구 그대로 (알고리즘용)
.
.
본문: 핵심 정보 2~3줄 (반말)
.
참여유도: 아래 패턴 중 랜덤 1개
  · "아는 사람한테 알려주고 싶으면 태그해"
  · "저장해두고 나중에 봐"
  · "댓글에 [키워드] 남기면 DM 줄게"
.
.
해시태그: (카테고리별 자동 선택, 최대 5개)
  · 일반 공통 해시태그(#솔직후기·#내돈내산·#시수르더쿠) 금지
  · 오직 콘텐츠 주제와 카테고리에 직접 관련된 태그만 (CATEGORIES[cat].hashtags)
  · 개수는 정확히 5개 이하
`

// 서버/프론트에서 hook/body 에서 캡션을 조립할 때 사용
export function buildCaption(args: {
  hook: string
  bodyTexts: string[]          // 3~5장 본문 2~3줄씩
  category: CategoryKey
  dmKeyword?: string           // DM 유도 키워드 (예: '후기')
}): string {
  const info = CATEGORIES[args.category]
  const ctaRaw = CAPTION_CTA_PATTERNS[Math.floor(Math.random() * CAPTION_CTA_PATTERNS.length)]
  const cta = ctaRaw.replace('[키워드]', args.dmKeyword || '후기')
  const body = args.bodyTexts
    .filter(Boolean)
    .slice(0, 3)
    .map(t => t.trim().replace(/\s+/g, ' '))
    .join('\n')
  // 공통 일반 태그 제거, 카테고리 전용 5개만
  const tags = info.hashtags
    .filter((t, i, a) => t.startsWith('#') && a.indexOf(t) === i)
    .slice(0, 5)
    .join(' ')
  return [
    args.hook.trim(),
    '',
    '',
    body,
    '',
    cta,
    '',
    '',
    tags,
  ].join('\n')
}

// 서버 응답에서 캡션이 비어있을 때 fallback
export function ensureCaption(args: {
  rawCaption?: string | null
  hook: string
  bodySlides: Array<{ title?: string; text?: string }>
  category: CategoryKey
}): string {
  if (args.rawCaption && args.rawCaption.trim().length > 10) return args.rawCaption
  const bodyTexts = (args.bodySlides || [])
    .slice(1, 4)
    .map(s => s.text || '')
    .filter(Boolean)
  return buildCaption({
    hook: args.hook,
    bodyTexts,
    category: args.category,
  })
}
