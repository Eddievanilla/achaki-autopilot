-- Migration 003: Fila de Comandos do Robô e Heartbeat do Worker Local

-- 1. Tabela robot_commands
CREATE TABLE IF NOT EXISTS public.robot_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    command TEXT NOT NULL DEFAULT 'RUN_NOW',
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    worker_id TEXT,
    run_id TEXT,
    error TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_robot_commands_status ON public.robot_commands(status);
CREATE INDEX IF NOT EXISTS idx_robot_commands_created_at ON public.robot_commands(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_robot_commands_command ON public.robot_commands(command);

-- RLS para robot_commands
ALTER TABLE public.robot_commands ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    DROP POLICY IF EXISTS "Permitir leitura de robot_commands" ON public.robot_commands;
    DROP POLICY IF EXISTS "Permitir insercao de robot_commands" ON public.robot_commands;
    DROP POLICY IF EXISTS "Permitir atualizacao de robot_commands" ON public.robot_commands;
END $$;

CREATE POLICY "Permitir leitura de robot_commands"
    ON public.robot_commands FOR SELECT
    TO anon, authenticated, service_role
    USING (true);

CREATE POLICY "Permitir insercao de robot_commands"
    ON public.robot_commands FOR INSERT
    TO anon, authenticated, service_role
    WITH CHECK (true);

CREATE POLICY "Permitir atualizacao de robot_commands"
    ON public.robot_commands FOR UPDATE
    TO anon, authenticated, service_role
    USING (true)
    WITH CHECK (true);

-- 2. Tabela worker_heartbeats
CREATE TABLE IF NOT EXISTS public.worker_heartbeats (
    worker_id TEXT PRIMARY KEY DEFAULT 'local-worker',
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'IDLE',
    current_step TEXT NOT NULL DEFAULT 'AGUARDANDO',
    current_run_id TEXT,
    hostname TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS para worker_heartbeats
ALTER TABLE public.worker_heartbeats ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    DROP POLICY IF EXISTS "Permitir leitura de worker_heartbeats" ON public.worker_heartbeats;
    DROP POLICY IF EXISTS "Permitir insercao de worker_heartbeats" ON public.worker_heartbeats;
    DROP POLICY IF EXISTS "Permitir atualizacao de worker_heartbeats" ON public.worker_heartbeats;
END $$;

CREATE POLICY "Permitir leitura de worker_heartbeats"
    ON public.worker_heartbeats FOR SELECT
    TO anon, authenticated, service_role
    USING (true);

CREATE POLICY "Permitir insercao de worker_heartbeats"
    ON public.worker_heartbeats FOR INSERT
    TO anon, authenticated, service_role
    WITH CHECK (true);

CREATE POLICY "Permitir atualizacao de worker_heartbeats"
    ON public.worker_heartbeats FOR UPDATE
    TO anon, authenticated, service_role
    USING (true)
    WITH CHECK (true);

-- 3. Adicionar tabelas à publicação supabase_realtime
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.robot_commands;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.worker_heartbeats;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;
