import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
const dbUrl = 'postgresql://postgres:@Edv200568@Edv@db.fobehbttydmqupfpioux.supabase.co:5432/postgres';

async function migrate() {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  
  const sql = fs.readFileSync('supabase/migrations/002_system_events.sql', 'utf-8');
  await client.query(sql);
  console.log('MIGRATION_002: SUCCESS');
  
  const check = await client.query("SELECT count(table_name) FROM information_schema.tables WHERE table_name = 'system_events'");
  console.log('TABLE_SYSTEM_EVENTS_EXISTS:', check.rows[0].count === '1');
  
  const pubCheck = await client.query("SELECT pubname, tablename FROM pg_publication_tables WHERE tablename = 'system_events'");
  console.log('REALTIME_PUBLICATION:', pubCheck.rows);

  await client.end();
}

migrate().catch(console.error);
