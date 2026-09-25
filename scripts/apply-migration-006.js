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
  console.log('Connected to Postgres.');

  // 1. Adapta tabela goals existente sem quebrar
  await client.query(`
    ALTER TABLE goals 
      ADD COLUMN IF NOT EXISTS metric VARCHAR(50),
      ADD COLUMN IF NOT EXISTS mode VARCHAR(30) DEFAULT 'AUTONOMOUS',
      ADD COLUMN IF NOT EXISTS current_goal NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS current_result NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS progress NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS baseline NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS growth_velocity JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS trend VARCHAR(30) DEFAULT 'ESTAVEL',
      ADD COLUMN IF NOT EXISTS confidence VARCHAR(20) DEFAULT 'LOW',
      ADD COLUMN IF NOT EXISTS previous_goal NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS next_goal_candidate NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS strategy TEXT,
      ADD COLUMN IF NOT EXISTS reason TEXT;

    -- Se metric_name existir e metric for nulo, sincroniza
    UPDATE goals SET metric = metric_name WHERE metric IS NULL AND metric_name IS NOT NULL;
    UPDATE goals SET current_goal = target_value WHERE current_goal = 0 AND target_value IS NOT NULL;
    UPDATE goals SET current_result = current_value WHERE current_result = 0 AND current_value IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_goals_metric ON goals(metric);
    CREATE INDEX IF NOT EXISTS idx_goals_mode ON goals(mode);
  `);
  console.log('Table goals adapted successfully.');

  // 2. Tabela goal_history
  await client.query(`
    CREATE TABLE IF NOT EXISTS goal_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      goal_id TEXT,
      metric VARCHAR(50) NOT NULL,
      goal_value NUMERIC,
      achieved_value NUMERIC,
      status VARCHAR(40),
      reason TEXT,
      recorded_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_goal_history_goal ON goal_history(goal_id);
    CREATE INDEX IF NOT EXISTS idx_goal_history_metric ON goal_history(metric);
  `);
  console.log('Table goal_history created/verified.');

  // 3. Tabela social_metrics
  await client.query(`
    CREATE TABLE IF NOT EXISTS social_metrics (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      network VARCHAR(40) NOT NULL,
      metric VARCHAR(50) NOT NULL,
      value NUMERIC NOT NULL DEFAULT 0,
      period VARCHAR(30) DEFAULT 'DAILY',
      collected_at TIMESTAMPTZ DEFAULT NOW(),
      metadata JSONB DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_social_metrics_network ON social_metrics(network);
    CREATE INDEX IF NOT EXISTS idx_social_metrics_metric ON social_metrics(metric);
    CREATE INDEX IF NOT EXISTS idx_social_metrics_collected ON social_metrics(collected_at);
  `);
  console.log('Table social_metrics created/verified.');

  // 4. Tabela strategy_experiments
  await client.query(`
    CREATE TABLE IF NOT EXISTS strategy_experiments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      publication_id UUID,
      network VARCHAR(40) DEFAULT 'FACEBOOK',
      engine VARCHAR(30) DEFAULT 'GROWTH',
      content_type VARCHAR(40) DEFAULT 'OFFER',
      product_id UUID,
      cluster_demand VARCHAR(100),
      opportunity_origin VARCHAR(50) DEFAULT 'DEMAND',
      creative_format VARCHAR(40),
      creative_asset_id UUID,
      hook TEXT,
      copy TEXT,
      cta TEXT,
      strategy VARCHAR(100),
      published_at TIMESTAMPTZ,
      price NUMERIC,
      discount_percent NUMERIC,
      affiliate_url TEXT,
      metrics JSONB DEFAULT '{"reach": 0, "impressions": 0, "views": 0, "reactions": 0, "comments": 0, "shares": 0, "clicks": 0, "ctr": 0, "followers_gained": 0, "conversions": 0}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_strategy_experiments_engine ON strategy_experiments(engine);
    CREATE INDEX IF NOT EXISTS idx_strategy_experiments_origin ON strategy_experiments(opportunity_origin);
  `);
  console.log('Table strategy_experiments created/verified.');

  // 5. Tabela strategy_learning
  await client.query(`
    CREATE TABLE IF NOT EXISTS strategy_learning (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      strategy_key VARCHAR(100) NOT NULL,
      dimension VARCHAR(50) NOT NULL,
      dimension_value VARCHAR(100) NOT NULL,
      confidence VARCHAR(20) DEFAULT 'LOW',
      sample_size INT DEFAULT 0,
      success_rate NUMERIC DEFAULT 0,
      evidence_summary TEXT,
      weight NUMERIC DEFAULT 1.0,
      last_evaluated_at TIMESTAMPTZ DEFAULT NOW(),
      metadata JSONB DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_strategy_learning_dim ON strategy_learning(dimension, dimension_value);
  `);
  console.log('Table strategy_learning created/verified.');

  await client.end();
  console.log('Migration 006 completed successfully!');
}

main().catch(console.error);
