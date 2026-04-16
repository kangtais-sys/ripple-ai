-- Repli 초기 스키마

-- 유저 프로필
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free','basic','premium','business')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 연동된 Instagram 계정
CREATE TABLE public.ig_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  ig_user_id TEXT NOT NULL,
  ig_username TEXT NOT NULL,
  access_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, ig_user_id)
);

-- 말투 학습 데이터
CREATE TABLE public.tone_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  sample_texts JSONB DEFAULT '[]',
  learned_style JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 월별 사용량 (과금 기준)
CREATE TABLE public.usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  comment_count INT DEFAULT 0,
  dm_count INT DEFAULT 0,
  UNIQUE(user_id, month)
);

-- 댓글/DM 응대 기록
CREATE TABLE public.reply_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  ig_account_id UUID REFERENCES public.ig_accounts(id),
  type TEXT CHECK (type IN ('comment','dm')),
  original_text TEXT,
  reply_text TEXT,
  platform_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS 활성화
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ig_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tone_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reply_logs ENABLE ROW LEVEL SECURITY;

-- RLS 정책: 유저는 자기 데이터만 접근
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users read own ig_accounts" ON public.ig_accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own ig_accounts" ON public.ig_accounts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own ig_accounts" ON public.ig_accounts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own ig_accounts" ON public.ig_accounts FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users read own tone" ON public.tone_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users manage own tone" ON public.tone_profiles FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users read own usage" ON public.usage_logs FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users read own replies" ON public.reply_logs FOR SELECT USING (auth.uid() = user_id);

-- 프로필 자동 생성 트리거
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'display_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
