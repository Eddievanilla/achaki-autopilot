-- Migration 004: Publicações Preparadas, Aprovação Humana e Idempotência

ALTER TABLE public.publications
ADD COLUMN IF NOT EXISTS facebook_post_id TEXT,
ADD COLUMN IF NOT EXISTS price_published NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS original_price_published NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS discount_published INTEGER,
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS run_id TEXT,
ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Garantir que published_at possa ser NULL enquanto estiver em aprovação
ALTER TABLE public.publications ALTER COLUMN published_at DROP NOT NULL;

-- Índices
CREATE INDEX IF NOT EXISTS idx_publications_status ON public.publications (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_publications_idempotency_key ON public.publications (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Políticas RLS para publications (leitura/atualização segura)
DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Public update publications" ON public.publications;
    DROP POLICY IF EXISTS "Public insert publications" ON public.publications;
    DROP POLICY IF EXISTS "Public read publications" ON public.publications;
END $$;

CREATE POLICY "Public read publications" ON public.publications
    FOR SELECT TO anon, authenticated, service_role USING (true);

CREATE POLICY "Public insert publications" ON public.publications
    FOR INSERT TO anon, authenticated, service_role WITH CHECK (true);

CREATE POLICY "Public update publications" ON public.publications
    FOR UPDATE TO anon, authenticated, service_role USING (true) WITH CHECK (true);

-- Realtime para publications
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.publications;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;
