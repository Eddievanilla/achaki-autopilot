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

  await client.query(`
    CREATE TABLE IF NOT EXISTS operator_interventions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type VARCHAR(50) NOT NULL,
      marketplace VARCHAR(50),
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      target_url TEXT NOT NULL,
      action_label VARCHAR(100) DEFAULT 'Intervir Agora ↗',
      status VARCHAR(30) DEFAULT 'PENDING',
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      metadata JSONB DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_operator_interventions_status ON operator_interventions(status);
  `);

  console.log('Table operator_interventions created successfully!');
  await client.end();
}

main().catch(console.error);
