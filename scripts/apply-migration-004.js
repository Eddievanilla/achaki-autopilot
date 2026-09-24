import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
const dbUrl = 'postgresql://postgres:@Edv200568@Edv@db.fobehbttydmqupfpioux.supabase.co:5432/postgres';

async function migrate() {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  
  const sql = fs.readFileSync('supabase/migrations/004_prepared_publication.sql', 'utf-8');
  await client.query(sql);
  console.log('MIGRATION_004: SUCCESS');

  const pubCheck = await client.query("SELECT pubname, tablename FROM pg_publication_tables WHERE tablename = 'publications'");
  console.log('REALTIME_PUBLICATIONS_TABLE:', pubCheck.rows);

  await client.end();
}

migrate().catch(console.error);
