// 카테고리별 Tavily 검색 — 매일 다른 키워드 풀 회전 + 시간 한정자
//
// 목적:
//   1. 매일 06:00 KST cron 이 18개 카테고리 각각에 대해 Tavily 검색 실행
//   2. 키워드 풀 (카테고리당 10개) 에서 매일 다른 2개 자동 선택 → 결과 다양성
//   3. 시간 한정자 ("이번 주", "2026 5월") 자동 첨부 → 최신 페이지 위주 결과
//   4. 각 토픽에 sources (도메인 1~3개) 자동 수집 → multi-source 카드 가능
//
// 비용:
//   카테고리 18개 × query 3개 × 결과 4개 = 218 호출/일 → Tavily 무료 1,000/월 안에서 운영
//   초과 시 $0.10 per extra 100 search → 약 $3.5/월 (베타 30명 기준)
import { tavilySearch } from './tavily-search'

// 카테고리별 검색 키워드 풀 (각 10개) — 매일 다른 2개 선택해서 검색
//   다양한 angle 보장 (제품·시술·트렌드·비교·후기·가성비·실패담·노하우·인물 골고루)
const KEYWORD_POOL: Record<string, string[]> = {
  beauty: [
    'K뷰티 신상', '글래스 스킨', '성분 분석', '더마 코스메틱', '메이크업 트렌드',
    '시술 후기', '향수 추천', '뷰티 가성비', '올리브영 베스트', '피부 트러블',
  ],
  fashion: [
    '데일리룩', '무신사 픽', '직장인 룩', '봄 코디', '여름 코디',
    '명품 가성비', '쇼핑몰 베스트', 'OOTD 인플루언서', '체형별 코디', '중고나라',
  ],
  food: [
    '편의점 신메뉴', '맛집 추천', '5분 레시피', '에어프라이어', '집밥',
    '도시락 레시피', '디저트 트렌드', '베이커리', '한식 레시피', '비건 레시피',
  ],
  cafe: [
    '신메뉴 카페', '홈카페 레시피', '커피 트렌드', '디저트 카페', '핫플 카페',
    '저당 음료', '빈티지 카페', '브런치 맛집', '카페 굿즈', '시즌 한정',
  ],
  travel: [
    '국내 여행', '해외 여행', '호텔 추천', '에어비앤비', '여행 예산',
    '항공권 꿀팁', '주말 여행', '제주도', '도쿄 여행', '동남아 여행',
  ],
  interior: [
    '자취방 꾸미기', '셀프 인테리어', '이케아 추천', '무인양품', '원룸 인테리어',
    '주방 꾸미기', '침실 무드', '테이블 셋팅', '플랜테리어', '공간 정리',
  ],
  fitness: [
    '홈트 루틴', '필라테스', '러닝 입문', '다이어트 식단', '단백질 보충제',
    '요가 동작', '헬스장 루틴', '스트레칭', '근력 운동', '체중 감량',
  ],
  money: [
    '재테크 입문', 'ETF 추천', '월급 관리', '절약 꿀팁', '부업 아이디어',
    '카카오뱅크 vs 토스', '신용카드 비교', '주식 초보', '연말정산', '청년 지원금',
  ],
  book: [
    '베스트셀러', '소설 추천', '자기계발서', '에세이 추천', '북스타그램',
    '독서 노트', '오디오북', '독립서점', '시집 추천', '재테크 책',
  ],
  baby: [
    '신생아 용품', '이유식 레시피', '어린이집', '육아 꿀팁', '수면 교육',
    '유아식 메뉴', '아기 옷', '교육 장난감', '엄마 일상', '발달 단계',
  ],
  pet: [
    '강아지 사료', '고양이 행동', '펫 용품', '반려동물 보험', '동물병원',
    '강아지 산책', '고양이 장난감', '펫 호텔', '반려묘 식단', '훈련 팁',
  ],
  kpop: [
    '컴백 소식', '아이돌 무대', '음방 1위', '스밍 차트', '데뷔조',
    '아이돌 패션', '직캠 인기', '뮤직비디오', '굿즈 발매', '팬덤 이슈',
  ],
  movie: [
    'OTT 신작', '극장 개봉', '드라마 결말', '넷플릭스 추천', '디즈니 플러스',
    '영화 평점', '시리즈 명작', 'OST 화제', '배우 인터뷰', '독립영화',
  ],
  music: [
    '플레이리스트', '신보 발매', '인디 아티스트', '드라이브 음악', '카페 음악',
    '운동 음악', '잠 안 올 때', 'LP 추천', '헤드폰 비교', '차트 분석',
  ],
  psych: [
    '연애 심리', 'MBTI 분석', '자존감', '관계 갈등', '번아웃 회복',
    '심리 상담', '데이트 팁', '결별 회복', '친구 관계', '명상',
  ],
  mystery: [
    '미제 사건', '괴담', '도시전설', '실화 공포', 'CCTV 영상',
    '숨겨진 이야기', '이상한 장소', '범죄 분석', '음모론', '오컬트',
  ],
  life: [
    '1인 가구', '살림 꿀팁', '청소 루틴', '정리정돈', '시간 관리',
    '미니멀 라이프', '자기계발', '습관 만들기', '취미 추천', '주말 루틴',
  ],
  trend: [
    '요즘 핫한', '바이럴 콘텐츠', 'MZ 트렌드', '신상 인기', '화제',
    'SNS 유행', 'Z세대 픽', '인기 챌린지', '신조어', '핫템',
  ],
  etc: [
    '꿀팁', '가성비', '리뷰', '비교', '후기',
    '정리', '추천', '베스트', '신상', '트렌드',
  ],
}

// 시드 기반 셔플 — 같은 날짜에는 같은 키워드 선택 (deterministic)
function pickByDate(arr: string[], dateSeed: string, count: number): string[] {
  if (arr.length === 0) return []
  // 날짜를 숫자 시드로 (yyyy-mm-dd → 정수)
  let seed = 0
  for (let i = 0; i < dateSeed.length; i++) {
    seed = (seed * 31 + dateSeed.charCodeAt(i)) >>> 0
  }
  const pool = arr.slice()
  // Fisher-Yates with seeded random
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) >>> 0
    return seed / 0xFFFFFFFF
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t
  }
  return pool.slice(0, Math.min(count, pool.length))
}

// 시간 한정자 — 매일 다른 표현으로 신선도 시그널
function temporalModifier(dateKst: string): string {
  const month = parseInt(dateKst.slice(5, 7), 10)
  const variants = [
    `${dateKst.slice(0, 4)} ${month}월`,  // "2026 5월"
    '이번 주',
    '요즘',
    '최근',
  ]
  // 날짜 시드로 회전
  const idx = parseInt(dateKst.slice(8, 10), 10) % variants.length
  return variants[idx]
}

export type CategorySearchItem = {
  title: string
  url: string
  snippet: string
  domain: string
  category: string
  query: string  // 어떤 query 로 잡혔는지 (디버깅 용)
}

// 카테고리별 Tavily 검색 — 풀에서 2개 키워드 선택 + 시간 한정자 → 3개 query 병렬 실행
//   query 3개 × 결과 4개 = 풀 12개 (도메인 다양성 자동, 한 도메인 max 3)
export async function searchCategory(category: string, dateKst: string): Promise<CategorySearchItem[]> {
  const pool = KEYWORD_POOL[category] || KEYWORD_POOL.etc
  const keywords = pickByDate(pool, dateKst + ':' + category, 2)
  const time = temporalModifier(dateKst)

  // 3개 query 자동 생성:
  //   1. 첫 키워드 + 시간 한정자
  //   2. 두 번째 키워드 + 시간 한정자
  //   3. 두 키워드 조합 (다른 angle)
  const queries = [
    `${keywords[0]} ${time}`,
    `${keywords[1]} ${time}`,
    `${keywords[0]} ${keywords[1]} 추천`,
  ]

  const results = await Promise.all(
    queries.map(q =>
      tavilySearch(q, { maxResults: 4 }).then(r =>
        r.map(item => {
          let domain = ''
          try { domain = new URL(item.url).hostname.replace(/^www\./, '') } catch { domain = '' }
          return {
            title: (item.title || '').trim(),
            url: item.url,
            snippet: (item.content || '').slice(0, 250).trim(),
            domain,
            category,
            query: q,
          } satisfies CategorySearchItem
        })
      ).catch(() => [] as CategorySearchItem[])
    )
  )

  // 합치기 + URL 중복 제거 + 도메인 다양성 (한 도메인 최대 3개)
  const seenUrl = new Set<string>()
  const perDomain: Record<string, number> = {}
  const flat: CategorySearchItem[] = []
  for (const arr of results) {
    for (const it of arr) {
      if (!it.url || seenUrl.has(it.url)) continue
      seenUrl.add(it.url)
      const c = perDomain[it.domain] || 0
      if (c >= 3) continue
      perDomain[it.domain] = c + 1
      flat.push(it)
    }
  }
  return flat
}

// 18개 카테고리 동시 검색 — Promise.all
export async function searchAllCategories(dateKst: string): Promise<Record<string, CategorySearchItem[]>> {
  const cats = Object.keys(KEYWORD_POOL).filter(c => c !== 'etc')
  const results = await Promise.all(
    cats.map(cat => searchCategory(cat, dateKst).then(items => [cat, items] as const).catch(() => [cat, []] as const))
  )
  return Object.fromEntries(results)
}
