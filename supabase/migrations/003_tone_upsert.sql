-- tone_profiles upsert를 위한 unique constraint + insert 정책
ALTER TABLE public.tone_profiles ADD CONSTRAINT tone_profiles_user_id_key UNIQUE (user_id);

CREATE POLICY "Users insert own tone" ON public.tone_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own tone" ON public.tone_profiles
  FOR UPDATE USING (auth.uid() = user_id);
