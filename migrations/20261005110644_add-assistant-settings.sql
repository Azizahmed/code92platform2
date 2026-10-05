-- One workspace provider, accessible only by trusted server code. Even an
-- admin's browser JWT cannot retrieve ciphertext or write settings directly.
CREATE TABLE public.assistant_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  base_url TEXT,
  model TEXT,
  key_ciphertext TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assistant_settings_complete CHECK (
    num_nonnulls(base_url, model, key_ciphertext) IN (0, 3)
  )
);

ALTER TABLE public.assistant_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.assistant_settings FROM PUBLIC, anon, authenticated;
CREATE TRIGGER assistant_settings_updated_at
BEFORE UPDATE ON public.assistant_settings
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

INSERT INTO public.assistant_settings (id) VALUES (TRUE);
