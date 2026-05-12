// 백오피스 권한 — admin email allowlist
//
// env ADMIN_EMAILS 는 comma 구분 (e.g. "kangtais@naver.com,founder@ssobi.ai")
// 미설정 시 기본값: 운영자 본인 이메일 (kangtais@naver.com)
//
// 보안 메모: 이 allowlist 는 서버측 체크 + RLS 정책 둘 다 의존. UI 만 가리는
// 게 아니라 모든 admin API 에서도 동일하게 검증해야 함.

// 운영자 본인은 항상 admin — 환경변수 사고/덮어쓰기에도 잠기지 않음.
//   추가 admin 은 ADMIN_EMAILS env (comma 구분) 로 확장.
const HARDCODED_ADMINS = ['kangtais@naver.com']

export function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || ''
  const envList = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  // 항상 HARDCODED + env 모두 포함 (중복 제거)
  return Array.from(new Set([...HARDCODED_ADMINS, ...envList]))
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return getAdminEmails().includes(email.toLowerCase())
}
