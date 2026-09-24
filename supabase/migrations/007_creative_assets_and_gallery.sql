-- ==============================================================================
-- Migration 007: Galeria de Criativos, Gestão de Assets e Performance Multimídia
-- ACHAki Autopilot — Fase: Galeria de Criativos + Mídia Automática
-- ==============================================================================

-- 1. Tabela creative_assets
CREATE TABLE IF NOT EXISTS public.creative_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    marketplace TEXT NOT NULL DEFAULT 'mercadolivre',
    marketplace_product_id TEXT,
    type TEXT NOT NULL CHECK (type IN ('IMAGE', 'VIDEO')),
    source_url TEXT NOT NULL,
    storage_url TEXT NOT NULL,
    thumbnail_url TEXT,
    mime_type TEXT,
    width INTEGER,
    height INTEGER,
    duration NUMERIC,
    file_size BIGINT,
    checksum TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'MARKETPLACE' CHECK (source IN ('MARKETPLACE', 'GENERATED', 'COMPOSED', 'LISTING_GALLERY', 'API')),
    usage_status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (usage_status IN ('AVAILABLE', 'IN_USE', 'ARCHIVED')),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_creative_asset_product_checksum UNIQUE (product_id, checksum)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_creative_assets_product_id ON public.creative_assets(product_id);
CREATE INDEX IF NOT EXISTS idx_creative_assets_type ON public.creative_assets(type);
CREATE INDEX IF NOT EXISTS idx_creative_assets_usage_status ON public.creative_assets(usage_status);
CREATE INDEX IF NOT EXISTS idx_creative_assets_checksum ON public.creative_assets(checksum);
CREATE INDEX IF NOT EXISTS idx_creative_assets_created_at ON public.creative_assets(created_at DESC);

-- 2. Tabela creative_usage (Histórico de Utilizações de cada Criativo)
CREATE TABLE IF NOT EXISTS public.creative_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES public.creative_assets(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    publication_id UUID REFERENCES public.publications(id) ON DELETE SET NULL,
    offer_candidate_id UUID REFERENCES public.offer_candidates(id) ON DELETE SET NULL,
    format TEXT NOT NULL DEFAULT 'SINGLE_IMAGE' CHECK (format IN ('SINGLE_IMAGE', 'MULTI_IMAGE', 'CAROUSEL', 'VIDEO')),
    channel TEXT NOT NULL DEFAULT 'Facebook',
    commercial_angle TEXT DEFAULT 'DEMANDA' CHECK (commercial_angle IN ('DEMANDA', 'PROBLEMA_SOLUCAO', 'IMPULSO', 'CUSTO_BENEFICIO', 'DESCONTO', 'PROVA_SOCIAL', 'PADRAO')),
    used_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_creative_usage_asset_id ON public.creative_usage(asset_id);
CREATE INDEX IF NOT EXISTS idx_creative_usage_product_id ON public.creative_usage(product_id);
CREATE INDEX IF NOT EXISTS idx_creative_usage_publication_id ON public.creative_usage(publication_id);
CREATE INDEX IF NOT EXISTS idx_creative_usage_used_at ON public.creative_usage(used_at DESC);

-- 3. Tabela creative_performance (Métricas de Performance por Criativo)
CREATE TABLE IF NOT EXISTS public.creative_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES public.creative_assets(id) ON DELETE CASCADE,
    publication_id UUID NOT NULL REFERENCES public.publications(id) ON DELETE CASCADE,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    ctr NUMERIC(5,2) DEFAULT 0.00,
    conversions INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_creative_performance_asset_pub UNIQUE (asset_id, publication_id)
);

CREATE INDEX IF NOT EXISTS idx_creative_performance_asset_id ON public.creative_performance(asset_id);
CREATE INDEX IF NOT EXISTS idx_creative_performance_publication_id ON public.creative_performance(publication_id);

-- 4. Habilitar RLS e Permissões de Leitura Anon
ALTER TABLE public.creative_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creative_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creative_performance ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'creative_assets' AND policyname = 'Allow read for all users'
    ) THEN
        CREATE POLICY "Allow read for all users" ON public.creative_assets FOR SELECT USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'creative_assets' AND policyname = 'Allow full access for service_role'
    ) THEN
        CREATE POLICY "Allow full access for service_role" ON public.creative_assets FOR ALL USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'creative_usage' AND policyname = 'Allow read for all users'
    ) THEN
        CREATE POLICY "Allow read for all users" ON public.creative_usage FOR SELECT USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'creative_usage' AND policyname = 'Allow full access for service_role'
    ) THEN
        CREATE POLICY "Allow full access for service_role" ON public.creative_usage FOR ALL USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'creative_performance' AND policyname = 'Allow read for all users'
    ) THEN
        CREATE POLICY "Allow read for all users" ON public.creative_performance FOR SELECT USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'creative_performance' AND policyname = 'Allow full access for service_role'
    ) THEN
        CREATE POLICY "Allow full access for service_role" ON public.creative_performance FOR ALL USING (true);
    END IF;
END $$;
