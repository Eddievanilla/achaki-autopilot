-- ============================================================
-- ACHAki Autopilot — Migration 001: Initial Schema (Fase 4.3)
-- ============================================================

-- Habilitar extensão pgcrypto para suporte a gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. TABELA: products
-- Catálogo normalizado de produtos coletados dos marketplaces
-- ============================================================
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    marketplace TEXT NOT NULL,
    marketplace_product_id TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT,
    product_url TEXT NOT NULL,
    image_url TEXT,
    seller_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uq_products_marketplace_product UNIQUE (marketplace, marketplace_product_id)
);

-- ============================================================
-- 2. TABELA: product_prices
-- Histórico temporal de preços e descontos dos produtos
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    current_price NUMERIC(10, 2) NOT NULL,
    original_price NUMERIC(10, 2),
    discount_percent INTEGER,
    collected_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============================================================
-- 3. TABELA: offer_candidates
-- Produtos avaliados e ranqueados pela curadoria de IA (OpenRouter)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.offer_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    ai_score INTEGER,
    ai_reason TEXT,
    ai_risk TEXT,
    status TEXT DEFAULT 'pending' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============================================================
-- 4. TABELA: publications
-- Registro de postagens publicadas nas redes sociais
-- ============================================================
CREATE TABLE IF NOT EXISTS public.publications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    marketplace TEXT NOT NULL,
    affiliate_url TEXT,
    social_network TEXT NOT NULL,
    publication_url TEXT,
    published_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    status TEXT DEFAULT 'published' NOT NULL
);

-- ============================================================
-- 5. TABELA: performance_metrics
-- Métricas de engajamento, cliques e conversões das publicações
-- ============================================================
CREATE TABLE IF NOT EXISTS public.performance_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publication_id UUID NOT NULL REFERENCES public.publications(id) ON DELETE CASCADE,
    impressions INTEGER DEFAULT 0 NOT NULL,
    clicks INTEGER DEFAULT 0 NOT NULL,
    reactions INTEGER DEFAULT 0 NOT NULL,
    comments INTEGER DEFAULT 0 NOT NULL,
    shares INTEGER DEFAULT 0 NOT NULL,
    conversions INTEGER DEFAULT 0 NOT NULL,
    revenue NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    collected_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============================================================
-- ÍNDICES PARA OTIMIZAÇÃO DE BUSCA E PERFORMANCE
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_products_marketplace ON public.products (marketplace);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products (category);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON public.products (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_prices_product_id ON public.product_prices (product_id);
CREATE INDEX IF NOT EXISTS idx_product_prices_collected_at ON public.product_prices (collected_at DESC);

CREATE INDEX IF NOT EXISTS idx_offer_candidates_product_id ON public.offer_candidates (product_id);
CREATE INDEX IF NOT EXISTS idx_offer_candidates_status ON public.offer_candidates (status);
CREATE INDEX IF NOT EXISTS idx_offer_candidates_score ON public.offer_candidates (ai_score DESC);

CREATE INDEX IF NOT EXISTS idx_publications_product_id ON public.publications (product_id);
CREATE INDEX IF NOT EXISTS idx_publications_social_network ON public.publications (social_network);
CREATE INDEX IF NOT EXISTS idx_publications_published_at ON public.publications (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_performance_metrics_publication_id ON public.performance_metrics (publication_id);
CREATE INDEX IF NOT EXISTS idx_performance_metrics_collected_at ON public.performance_metrics (collected_at DESC);

-- ============================================================
-- SEGURANÇA: ROW LEVEL SECURITY (RLS)
-- O acesso operacional é exclusivo do backend via service_role
-- ============================================================
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_metrics ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso total para o service_role (backend)
CREATE POLICY "Service Role full access on products"
    ON public.products FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service Role full access on product_prices"
    ON public.product_prices FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service Role full access on offer_candidates"
    ON public.offer_candidates FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service Role full access on publications"
    ON public.publications FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service Role full access on performance_metrics"
    ON public.performance_metrics FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
