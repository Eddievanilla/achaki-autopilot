import 'dotenv/config';
import pg from 'pg';

async function main() {
  const client = new pg.Client({
    host: 'db.fobehbttydmqupfpioux.supabase.co',
    user: 'postgres',
    password: '@Edv200568@Edv',
    port: 5432,
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('Connected to Supabase Postgres.');

  // 1. Tabela creative_jobs
  await client.query(`
    CREATE TABLE IF NOT EXISTS creative_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id UUID REFERENCES products(id) ON DELETE SET NULL,
      offer_candidate_id UUID,
      creative_id UUID REFERENCES creative_versions(id) ON DELETE SET NULL,
      creative_version INT DEFAULT 1,
      job_type VARCHAR(50) DEFAULT 'VIDEO_9_16',
      provider VARCHAR(50) DEFAULT 'LOCAL_COMFYUI',
      priority VARCHAR(20) DEFAULT 'NORMAL',
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
  `);
  console.log('Table creative_jobs created/verified.');

  // 2. Colunas de deduplicação em operator_interventions
  await client.query(`
    ALTER TABLE operator_interventions
    ADD COLUMN IF NOT EXISTS first_detected_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS last_detected_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS attempt_count INT DEFAULT 1;
  `);
  console.log('Columns added to operator_interventions.');

  // 3. Colunas de Creative Factory em worker_heartbeats
  await client.query(`
    ALTER TABLE worker_heartbeats
    ADD COLUMN IF NOT EXISTS creative_factory JSONB DEFAULT '{}'::jsonb;
  `);
  console.log('Columns added to worker_heartbeats.');

  // 4. Colunas de Frequência de Publicação em goal_configurations (se a tabela existir)
  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'goal_configurations') THEN
        ALTER TABLE goal_configurations
        ADD COLUMN IF NOT EXISTS publication_frequency_mode VARCHAR(20) DEFAULT 'AUTONOMOUS',
        ADD COLUMN IF NOT EXISTS publication_frequency_target INT DEFAULT 2;
      END IF;
    END $$;
  `);
  console.log('Columns verified in goal_configurations.');

  // 5. Reload PostgREST schema cache
  await client.query("NOTIFY pgrst, 'reload schema';");
  console.log("Notified PostgREST schema reload.");

  await client.end();
  console.log("Migration 008 completed successfully!");
}

main().catch(err => {
  console.error("Migration 008 failed:", err);
  process.exit(1);
});
