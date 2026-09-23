-- ============================================================
-- ACHAki Autopilot — Migration 005: Command Center & Autopilot (Fase 5.4)
-- ============================================================

-- 1. TABELA: goals (Configuração de Metas Diárias e Mensais)
CREATE TABLE IF NOT EXISTS public.goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name TEXT NOT NULL UNIQUE,
    target_value NUMERIC(10, 2) NOT NULL,
    current_value NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    period TEXT DEFAULT 'daily' NOT NULL,
    status TEXT DEFAULT 'active' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Inserir meta padrão de 20 cliques por dia
INSERT INTO public.goals (metric_name, target_value, current_value, period)
VALUES ('clicks_per_day', 20.00, 0.00, 'daily')
ON CONFLICT (metric_name) DO UPDATE 
SET target_value = EXCLUDED.target_value, updated_at = now();

-- 2. TABELA: content_strategies (Catálogo de Estratégias Orgânicas)
CREATE TABLE IF NOT EXISTS public.content_strategies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    objective TEXT NOT NULL,
    ideal_for TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

INSERT INTO public.content_strategies (id, name, description, objective, ideal_for) VALUES
('PRECO', 'Foco em Preço Baixo', 'Destaca o valor absoluto acessível do produto', 'Impulso Imediato', 'Produtos abaixo de R$ 50'),
('DESCONTO', 'Desconto Real Comprovado', 'Enfatiza a porcentagem de economia real vs histórico', 'Percepção de Oportunidade', 'Desconto >= 25%'),
('URGENCIA', 'Gatilho de Urgência', 'Evidencia escassez de estoque ou tempo limitado da promoção', 'Conversão Rápida', 'Ofertas relâmpago'),
('CURIOSIDADE', 'Gatilho de Curiosidade', 'Apresenta produto com chamada provocativa sobre sua utilidade', 'Cliques e Engajamento', 'Gadgets e utilidades inovadoras'),
('PROBLEMA_SOLUCAO', 'Problema e Solução', 'Demonstra uma dor cotidiana resolvida pelo item', 'Identificação Direta', 'Organizadores e itens de cozinha'),
('BENEFICIO', 'Foco no Benefício Prático', 'Enfatiza a praticidade, conforto ou economia gerada', 'Convencimento Racional', 'Ferramentas e organização'),
('COMPARACAO', 'Comparativo de Custo-Benefício', 'Compara a vantagem em relação a alternativas caras', 'Decisão Qualificada', 'Itens com similar de marca cara'),
('PROVA_SOCIAL', 'Validação Social', 'Ressalta milhares de vendidos e avaliação 4.8+', 'Confiança e Credibilidade', 'Produtos com alta contagem de vendas'),
('ACHADINHO', 'Achadinho Exclusivo', 'Comunicação informal no estilo garimpo/descoberta', 'Viralidade e Compartilhamento', 'Utilidades domésticas surpreendentes'),
('DEMONSTRACAO', 'Demonstração de Uso', 'Foco no passo a passo de como o produto funciona', 'Retenção e Desejo', 'Produtos visuais ou dinâmicos')
ON CONFLICT (id) DO NOTHING;

-- 3. TABELA: automation_runs (Execuções do Ciclo do Robô)
CREATE TABLE IF NOT EXISTS public.automation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT NOT NULL DEFAULT 'RUNNING',
    start_time TIMESTAMPTZ DEFAULT now() NOT NULL,
    end_time TIMESTAMPTZ,
    duration_seconds INTEGER,
    current_task TEXT,
    items_found INTEGER DEFAULT 0,
    items_selected INTEGER DEFAULT 0,
    strategy_used TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 4. TABELA: automation_events (Diário Detalhado do Robô com Metadados)
CREATE TABLE IF NOT EXISTS public.automation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID REFERENCES public.automation_runs(id) ON DELETE SET NULL,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    strategy_id TEXT REFERENCES public.content_strategies(id) ON DELETE SET NULL,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 5. TABELA: publication_metrics (Métricas Reais de Desempenho)
CREATE TABLE IF NOT EXISTS public.publication_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publication_id UUID REFERENCES public.publications(id) ON DELETE CASCADE,
    impressions INTEGER DEFAULT 0 NOT NULL,
    reach INTEGER DEFAULT 0 NOT NULL,
    views INTEGER DEFAULT 0 NOT NULL,
    clicks INTEGER DEFAULT 0 NOT NULL,
    ctr NUMERIC(5, 2) DEFAULT 0.00 NOT NULL,
    reactions INTEGER DEFAULT 0 NOT NULL,
    comments INTEGER DEFAULT 0 NOT NULL,
    shares INTEGER DEFAULT 0 NOT NULL,
    conversions INTEGER DEFAULT 0 NOT NULL,
    watch_time_seconds NUMERIC(10, 2),
    retention_percent NUMERIC(5, 2),
    collected_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 6. TABELA: click_events (Arquitetura de Rastreamento de Cliques)
CREATE TABLE IF NOT EXISTS public.click_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tracking_id TEXT NOT NULL,
    publication_id UUID REFERENCES public.publications(id) ON DELETE SET NULL,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    marketplace TEXT NOT NULL,
    social_network TEXT,
    strategy_id TEXT REFERENCES public.content_strategies(id) ON DELETE SET NULL,
    user_agent_hash TEXT,
    clicked_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 7. TABELA: strategy_performance (Aprendizado de Performance por Estratégia)
CREATE TABLE IF NOT EXISTS public.strategy_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id TEXT NOT NULL REFERENCES public.content_strategies(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    marketplace TEXT NOT NULL,
    social_network TEXT NOT NULL,
    total_posts INTEGER DEFAULT 0 NOT NULL,
    total_clicks INTEGER DEFAULT 0 NOT NULL,
    average_ctr NUMERIC(5, 2) DEFAULT 0.00 NOT NULL,
    total_conversions INTEGER DEFAULT 0 NOT NULL,
    last_applied_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uq_strategy_perf UNIQUE (strategy_id, category, marketplace, social_network)
);

-- 8. TABELA: optimizer_decisions (Justificativa "Por que o robô fez isso?")
CREATE TABLE IF NOT EXISTS public.optimizer_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID REFERENCES public.automation_runs(id) ON DELETE SET NULL,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    decision_type TEXT NOT NULL,
    reason TEXT NOT NULL,
    action_taken TEXT NOT NULL,
    metrics_context JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Adicionar colunas de modo Autopilot e meta de cliques à tabela system_state
ALTER TABLE public.system_state 
ADD COLUMN IF NOT EXISTS autopilot_mode TEXT DEFAULT 'ASSISTIDO',
ADD COLUMN IF NOT EXISTS target_clicks INTEGER DEFAULT 20,
ADD COLUMN IF NOT EXISTS current_strategy TEXT DEFAULT 'ACHADINHO';

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_automation_runs_created_at ON public.automation_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_events_created_at ON public.automation_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_events_product_id ON public.automation_events (product_id);
CREATE INDEX IF NOT EXISTS idx_publication_metrics_pub_id ON public.publication_metrics (publication_id);
CREATE INDEX IF NOT EXISTS idx_click_events_tracking_id ON public.click_events (tracking_id);
CREATE INDEX IF NOT EXISTS idx_click_events_clicked_at ON public.click_events (clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_optimizer_decisions_created_at ON public.optimizer_decisions (created_at DESC);

-- Habilitar RLS
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.click_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.optimizer_decisions ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso total para o backend service_role
CREATE POLICY "Service Role full access on goals" ON public.goals FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service Role full access on content_strategies" ON public.content_strategies FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service Role full access on automation_runs" ON public.automation_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service Role full access on automation_events" ON public.automation_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service Role full access on publication_metrics" ON public.publication_metrics FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service Role full access on click_events" ON public.click_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service Role full access on strategy_performance" ON public.strategy_performance FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service Role full access on optimizer_decisions" ON public.optimizer_decisions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Leitura pública segura (anon) para o Dashboard Vercel
CREATE POLICY "Allow public read on goals" ON public.goals FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public read on content_strategies" ON public.content_strategies FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public read on automation_runs" ON public.automation_runs FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public read on automation_events" ON public.automation_events FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public read on publication_metrics" ON public.publication_metrics FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public read on strategy_performance" ON public.strategy_performance FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public read on optimizer_decisions" ON public.optimizer_decisions FOR SELECT TO anon USING (true);
