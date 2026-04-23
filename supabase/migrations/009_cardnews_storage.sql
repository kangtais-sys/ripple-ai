-- 카드뉴스 캔버스 캡처·유저 업로드 이미지 저장용 public 버킷
-- IG 크롤러가 fetch 가능한 공개 URL 필요
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('cardnews', 'cardnews', true, 10485760)  -- 10MB
ON CONFLICT (id) DO UPDATE SET public = true;

-- 공개 read (IG 크롤러용)
DROP POLICY IF EXISTS "Public read cardnews" ON storage.objects;
CREATE POLICY "Public read cardnews" ON storage.objects
  FOR SELECT USING (bucket_id = 'cardnews');

-- service_role 이 insert (서버에서만)
DROP POLICY IF EXISTS "Service upload cardnews" ON storage.objects;
CREATE POLICY "Service upload cardnews" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'cardnews');

DROP POLICY IF EXISTS "Service delete cardnews" ON storage.objects;
CREATE POLICY "Service delete cardnews" ON storage.objects
  FOR DELETE USING (bucket_id = 'cardnews');
