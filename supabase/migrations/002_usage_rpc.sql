-- 사용량 증가 RPC (webhook에서 호출)
CREATE OR REPLACE FUNCTION increment_usage(p_user_id UUID, p_month TEXT, p_type TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.usage_logs (user_id, month, comment_count, dm_count)
  VALUES (p_user_id, p_month, 0, 0)
  ON CONFLICT (user_id, month) DO NOTHING;

  IF p_type = 'comment' THEN
    UPDATE public.usage_logs SET comment_count = comment_count + 1
    WHERE user_id = p_user_id AND month = p_month;
  ELSIF p_type = 'dm' THEN
    UPDATE public.usage_logs SET dm_count = dm_count + 1
    WHERE user_id = p_user_id AND month = p_month;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
