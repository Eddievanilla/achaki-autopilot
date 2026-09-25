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

  // 1. Tabela creative_versions
  await client.query(`
    CREATE TABLE IF NOT EXISTS creative_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id UUID,
      version_number INT DEFAULT 1,
      status VARCHAR(50) DEFAULT 'CREATIVE_READY',
      aspect_ratio VARCHAR(20) DEFAULT '9:16',
      video_url TEXT,
      thumbnail_url TEXT,
      duration NUMERIC DEFAULT 15,
      headline TEXT,
      script_data JSONB DEFAULT '{}'::jsonb,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_creative_versions_product ON creative_versions(product_id);
    CREATE INDEX IF NOT EXISTS idx_creative_versions_status ON creative_versions(status);
  `);
  console.log('Table creative_versions created/verified.');

  // 2. Tabela publication_approvals
  await client.query(`
    CREATE TABLE IF NOT EXISTS publication_approvals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      creative_version_id UUID,
      product_id UUID,
      marketplace VARCHAR(50),
      marketplace_product_id TEXT,
      approval_token TEXT UNIQUE,
      status VARCHAR(50) DEFAULT 'PENDING',
      approved_by VARCHAR(100),
      approved_at TIMESTAMPTZ,
      rejection_reason TEXT,
      remake_reason TEXT,
      affiliate_link_status VARCHAR(50) DEFAULT 'WAITING',
      affiliate_url TEXT,
      validated_at TIMESTAMPTZ,
      idempotency_key TEXT UNIQUE,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_pub_approvals_creative ON publication_approvals(creative_version_id);
    CREATE INDEX IF NOT EXISTS idx_pub_approvals_status ON publication_approvals(status);
    CREATE INDEX IF NOT EXISTS idx_pub_approvals_idempotency ON publication_approvals(idempotency_key);
  `);
  console.log('Table publication_approvals created/verified.');

  // 3. Tabela affiliate_link_events
  await client.query(`
    CREATE TABLE IF NOT EXISTS affiliate_link_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      approval_id UUID,
      product_id UUID,
      raw_link TEXT,
      validation_status VARCHAR(50),
      matched_marketplace VARCHAR(50),
      detected_product_id TEXT,
      failure_reason TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_aff_events_approval ON affiliate_link_events(approval_id);
    CREATE INDEX IF NOT EXISTS idx_aff_events_status ON affiliate_link_events(validation_status);
  `);
  console.log('Table affiliate_link_events created/verified.');

  // 4. Garante colunas adicionais em operator_interventions se necessário
  await client.query(`
    ALTER TABLE operator_interventions
      ADD COLUMN IF NOT EXISTS creative_id UUID,
      ADD COLUMN IF NOT EXISTS product_id UUID,
      ADD COLUMN IF NOT EXISTS version_number INT DEFAULT 1;
  `);
  console.log('Table operator_interventions updated.');

  await client.end();
  console.log('Migration 007 applied successfully!');
}

main().catch(console.error);
