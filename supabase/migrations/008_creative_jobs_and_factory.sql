-- ============================================================
-- ACHAki Autopilot — Migration 008: Creative Jobs & Local Factory
-- ============================================================

-- 1. Fila de Jobs Criativos (creative_jobs)
CREATE TABLE IF NOT EXISTS creative_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  offer_candidate_id UUID,
  creative_id UUID REFERENCES creative_versions(id) ON DELETE SET NULL,
  creative_version INT DEFAULT 1,
  job_type VARCHAR(50) DEFAULT 'VIDEO_9_16',
  provider VARCHAR(50) DEFAULT 'LOCAL_COMFYUI',
  priority VARCHAR(20) DEFAULT 'NORMAL', -- HIGH, NORMAL, LOW
  status VARCHAR(50) DEFAULT 'PENDING',
  input_assets JSONB DEFAULT '{}'::jsonb,
  workflow VARCHAR(100) DEFAULT 'wan2_2_i2v',
  prompt TEXT,
  negative_prompt TEXT,
  target_networks JSONB DEFAULT '["FACEBOOK", "INSTAGRAM", "TIKTOK", "YOUTUBE"]'::jsonb,
  aspect_ratio VARCHAR(20) DEFAULT '9:16',
  duration_target INT DEFAULT 20,
  worker_id VARCHAR(100),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_code VARCHAR(100),
  error_message TEXT,
  retry_count INT DEFAULT 0,
  output_asset_id UUID REFERENCES creative_assets(id) ON DELETE SET NULL,
  idempotency_key TEXT UNIQUE,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creative_jobs_status ON creative_jobs(status);
CREATE INDEX IF NOT EXISTS idx_creative_jobs_priority ON creative_jobs(priority, created_at);
CREATE INDEX IF NOT EXISTS idx_creative_jobs_product ON creative_jobs(product_id);
CREATE INDEX IF NOT EXISTS idx_creative_jobs_worker ON creative_jobs(worker_id);

-- 2. Deduplicação e contagem de tentativas em operator_interventions
ALTER TABLE operator_interventions
ADD COLUMN IF NOT EXISTS first_detected_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS last_detected_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS attempt_count INT DEFAULT 1;

-- 3. Métricas e status da fábrica em tempo real no heartbeat do worker
ALTER TABLE worker_heartbeats
ADD COLUMN IF NOT EXISTS creative_factory JSONB DEFAULT '{}'::jsonb;

-- 4. Modos de frequência de publicação em goal_configurations
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'goal_configurations') THEN
    ALTER TABLE goal_configurations
    ADD COLUMN IF NOT EXISTS publication_frequency_mode VARCHAR(20) DEFAULT 'AUTONOMOUS',
    ADD COLUMN IF NOT EXISTS publication_frequency_target INT DEFAULT 2;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
