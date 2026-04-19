export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(160deg,#F9FAFB,#EEF2F5)', padding: 20, fontFamily: "'Pretendard',sans-serif"
    }}>
      <div style={{ fontSize: 72, marginBottom: 8, opacity: 0.3 }}>🔗</div>
      <h1 style={{ fontSize: 22, fontWeight: 900, color: '#1A1F27', letterSpacing: '-.4px', margin: 0 }}>이 링크 페이지는 없어요</h1>
      <p style={{ fontSize: 13, color: '#64748B', marginTop: 10, textAlign: 'center', lineHeight: 1.6 }}>
        아직 만들어지지 않았거나, 공개되지 않은 페이지예요.<br />
        <a href="https://ssobi.ai" style={{ color: '#00A87E', fontWeight: 700, textDecoration: 'none' }}>나만의 링크 페이지 만들기 →</a>
      </p>
    </div>
  )
}
