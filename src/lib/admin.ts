// 백오피스 권한 — admin email allowlist
//
// env ADMIN_EMAILS 는 comma 구분 (e.g. "kangtais@naver.com,founder@ssobi.ai")
// 미설정 시 기본값: 운영자 본인 이메일 (kangtais@naver.com)
//
// 보안 메모: 이 allowlist 는 서버측 체크 + RLS 정책 둘 다 의존. UI 만 가리는
// 게 아니라 모든 admin API 에서도 동일하게 검증해야 함.

const DEFAULT_ADMINS = ['kangtais@naver.com']

export function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || ''
  const list = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return list.length > 0 ? list : DEFAULT_ADMINS
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return getAdminEmails().includes(email.toLowerCase())
}
