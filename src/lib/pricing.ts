// Ssobi 시간·금전 절약 계산 상수
// 최저시급은 매년 변경됨 → 이 파일만 수정

export const MIN_WAGE_KRW = 10_320  // 2026년 한국 최저시급 (확정)

// 작업별 평균 소요 시간 (분) — 보수적 추정
// 실제는 더 오래 걸리는 경우가 많음 (허위·과장 방지 위해 낮게 설정)
export const TASK_MINUTES = {
  comment: 3,       // 댓글 응대 (읽기 + 답장 작성 + 등록)
  dm: 5,            // DM 응대 (컨텍스트 파악 + 답장)
  cardnews: 60,     // 카드뉴스 제작 (기획·카피·슬라이드 구성)
  schedule: 5,      // 게시 예약/업로드
}

export function calculateSavings(counts: {
  comment: number
  dm: number
  cardnews: number
  schedule: number
}) {
  const totalMinutes =
    counts.comment * TASK_MINUTES.comment +
    counts.dm * TASK_MINUTES.dm +
    counts.cardnews * TASK_MINUTES.cardnews +
    counts.schedule * TASK_MINUTES.schedule
  const totalHours = totalMinutes / 60
  const totalKrw = Math.round(totalHours * MIN_WAGE_KRW)
  return { totalMinutes, totalHours, totalKrw }
}
