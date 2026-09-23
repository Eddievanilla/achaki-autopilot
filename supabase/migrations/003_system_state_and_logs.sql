-- ============================================================
-- ACHAki Autopilot — Migration 003: System State & Activity Logs (Fase 5.3)
-- ============================================================

-- Tabela singleton para armazenar o estado operacional do robô em tempo real
CREATE TABLE IF NOT EXISTS public.system_state (
    id TEXT PRIMARY KEY DEFAULT 'autopilot',
    status TEXT NOT NULL DEFAULT 'ONLINE',
    current_step TEXT DEFAULT 'Aguardando próximo ciclo de coleta...',
    last_run_at TIMESTAMPTZ DEFAULT now(),
    last_duration_seconds INTEGER DEFAULT 0,
    next_run_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '30 minutes'),
    today_products_found INTEGER DEFAULT 0,
    today_offers_selected INTEGER DEFAULT 0,
    today_publications INTEGER DEFAULT 0,
    today_errors INTEGER DEFAULT 0,
    ai_cache_hits INTEGER DEFAULT 0,
    ai_jev_calls INTEGER DEFAULT 0,
    ai_gpt_calls INTEGER DEFAULT 0,
    ai_tokens INTEGER DEFAULT 0,
    ai_savings_percent INTEGER DEFAULT 0,
    marketplaces JSONB DEFAULT '{"mercadolivre":"ATIVO","shopee":"BLOQUEADO","amazon":"NAO_CONFIGURADO","aliexpress":"NAO_CONFIGURADO"}'::jsonb,
    social_networks JSONB DEFAULT '{"facebook":"NAO_CONFIGURADO","instagram":"NAO_CONFIGURADO","tiktok":"EM_BREVE","youtube":"EM_BREVE","x":"EM_BREVE"}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Tabela de histórico de atividades em tempo real para o feed
CREATE TABLE IF NOT EXISTS public.system_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message TEXT NOT NULL,
    level TEXT DEFAULT 'INFO' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Índices para consultas otimizadas no feed
CREATE INDEX IF NOT EXISTS idx_system_activity_logs_created_at ON public.system_activity_logs (created_at DESC);

-- Habilitar RLS
ALTER TABLE public.system_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_activity_logs ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso total para o backend service_role
CREATE POLICY "Service Role full access on system_state"
    ON public.system_state FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service Role full access on system_activity_logs"
    ON public.system_activity_logs FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Inserir estado padrão caso ainda não exista
INSERT INTO public.system_state (id, status, current_step)
VALUES ('autopilot', 'ONLINE', 'Aguardando próximo ciclo de coleta...')
ON CONFLICT (id) DO NOTHING;
