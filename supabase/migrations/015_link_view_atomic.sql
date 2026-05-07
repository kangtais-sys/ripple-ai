-- 015: 링크 페이지 조회수 atomic 증가 RPC
--
-- 현재 trackPageView 는 read-then-write 패턴이라 동시 트래픽에서 race condition 발생.
-- 실제 베타 트래픽 (분당 수회) 에선 거의 발생 안 하지만, 정식 launch 시 atomic 보장 필요.
--
-- 사용:
--   await sb.rpc('increment_link_view', { p_id: link_page_id })
--
-- SECURITY DEFINER 로 RLS 우회 (anon 이든 누구든 호출 가능, 단 함수 내부는 정확한 페이지만 update)

CREATE OR REPLACE FUNCTION public.increment_link_view(p_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.link_pages
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.increment_link_view(UUID) TO anon, authenticated, service_role;

-- 일일 통계 atomic upsert RPC
--   trackPageView 의 두번째 단계 (link_page_daily_stats upsert) 도 race-prone
CREATE OR REPLACE FUNCTION public.increment_link_day_view(p_id UUID, p_date DATE)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.link_page_daily_stats (link_page_id, date, views, unique_visitors)
  VALUES (p_id, p_date, 1, 1)
  ON CONFLICT (link_page_id, date)
  DO UPDATE SET views = public.link_page_daily_stats.views + 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.increment_link_day_view(UUID, DATE) TO anon, authenticated, service_role;
