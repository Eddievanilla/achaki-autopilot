-- Migration 002: Tabela de Telemetria e Logs em Tempo Real (system_events)

CREATE TABLE IF NOT EXISTS system_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    level VARCHAR(20) NOT NULL DEFAULT 'INFO',
    category VARCHAR(50) NOT NULL DEFAULT 'SYSTEM',
    source VARCHAR(100),
    action VARCHAR(100),
    message TEXT NOT NULL,
    status VARCHAR(50),
    metadata JSONB DEFAULT '{}'::jsonb,
    run_id UUID,
    product_id UUID,
    publication_id UUID,
    duration_ms INTEGER
);

-- Índices otimizados para busca e ordenação
CREATE INDEX IF NOT EXISTS idx_system_events_created_at ON system_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_category ON system_events (category);
CREATE INDEX IF NOT EXISTS idx_system_events_level ON system_events (level);
CREATE INDEX IF NOT EXISTS idx_system_events_run_id ON system_events (run_id);

-- Habilitar Row Level Security (RLS)
ALTER TABLE system_events ENABLE ROW LEVEL SECURITY;

-- Política de leitura irrestrita para SELECT (necessária para Anon / Dashboard / Realtime)
DROP POLICY IF EXISTS "system_events_read_policy" ON system_events;
CREATE POLICY "system_events_read_policy" ON system_events
    FOR SELECT TO anon, authenticated, service_role
    USING (true);

-- Política de inserção para o backend
DROP POLICY IF EXISTS "system_events_insert_policy" ON system_events;
CREATE POLICY "system_events_insert_policy" ON system_events
    FOR INSERT TO anon, authenticated, service_role
    WITH CHECK (true);

-- Habilitar Supabase Realtime para a tabela system_events
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'system_events'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE system_events;
    END IF;
END $$;
