-- ============================================================
-- ACHAki Autopilot — Migration 006: Publications Tracking (Primeiro Ciclo Real)
-- ============================================================

-- 1. Enriquecer tabela publications com dados de tracking e estratégia
ALTER TABLE public.publications
ADD COLUMN IF NOT EXISTS tracking_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS tracking_url TEXT,
ADD COLUMN IF NOT EXISTS strategy TEXT,
ADD COLUMN IF NOT EXISTS content TEXT,
ADD COLUMN IF NOT EXISTS media_url TEXT;

-- 2. Índices de busca rápida para redirecionamento e telemetria
CREATE INDEX IF NOT EXISTS idx_publications_tracking_id ON public.publications (tracking_id);
CREATE INDEX IF NOT EXISTS idx_click_events_tracking_id ON public.click_events (tracking_id);
CREATE INDEX IF NOT EXISTS idx_click_events_clicked_at ON public.click_events (clicked_at DESC);

-- 3. Políticas RLS para click_events e publications (leitura segura para redirecionamento)
ALTER TABLE public.publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.click_events ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'publications' AND policyname = 'Public read publications'
    ) THEN
        CREATE POLICY "Public read publications" ON public.publications
        FOR SELECT TO anon, authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'click_events' AND policyname = 'Public insert click_events'
    ) THEN
        CREATE POLICY "Public insert click_events" ON public.click_events
        FOR INSERT TO anon, authenticated WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'click_events' AND policyname = 'Public select click_events'
    ) THEN
        CREATE POLICY "Public select click_events" ON public.click_events
        FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;
