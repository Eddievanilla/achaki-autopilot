-- ============================================================
-- ACHAki Autopilot — Migration 002: JEV Decisions Cache (Fase 5.1)
-- ============================================================

-- Tabela para persistir decisões de curadoria (JEV e GPT) e viabilizar cache de alta performance
CREATE TABLE IF NOT EXISTS public.ai_decision_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    last_price NUMERIC(10, 2) NOT NULL,
    discount_percent INTEGER,
    local_score INTEGER,
    jev_decision_score NUMERIC(5, 2),
    jev_quality_tier TEXT,
    jev_is_achadinho NUMERIC(5, 2),
    jev_risk_level TEXT,
    jev_needs_escalation BOOLEAN DEFAULT false,
    ai_score INTEGER,
    ai_reason TEXT,
    ai_risk TEXT,
    model_used TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uq_ai_decision_cache_product UNIQUE (product_id)
);

-- Índices para consultas ultra rápidas por produto e expiração de cache
CREATE INDEX IF NOT EXISTS idx_ai_decision_cache_product_id ON public.ai_decision_cache (product_id);
CREATE INDEX IF NOT EXISTS idx_ai_decision_cache_updated_at ON public.ai_decision_cache (updated_at DESC);

-- Habilitar RLS
ALTER TABLE public.ai_decision_cache ENABLE ROW LEVEL SECURITY;

-- Política de acesso irrestrito para service_role (backend exclusivo)
CREATE POLICY "Service Role full access on ai_decision_cache"
    ON public.ai_decision_cache FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
