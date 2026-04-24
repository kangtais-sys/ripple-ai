-- 카드뉴스 영상 업로드 지원 — 버킷 용량 10MB → 100MB 상향
-- 이미지·영상 모두 같은 버킷 사용 (IG Graph API 가 public URL 로 fetch)
UPDATE storage.buckets
SET file_size_limit = 104857600  -- 100MB
WHERE id = 'cardnews';
