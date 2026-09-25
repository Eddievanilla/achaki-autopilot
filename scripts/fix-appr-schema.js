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

  await client.query(`
    ALTER TABLE publication_approvals
      ADD COLUMN IF NOT EXISTS creative_id UUID,
      ADD COLUMN IF NOT EXISTS publication_id UUID,
      ADD COLUMN IF NOT EXISTS notes TEXT;

    -- Notifica o PostgREST para recarregar o schema cache
    NOTIFY pgrst, 'reload schema';
  `);
  console.log('Columns creative_id, publication_id, notes added to publication_approvals.');

  await client.end();
  console.log('Done!');
}

main().catch(console.error);
