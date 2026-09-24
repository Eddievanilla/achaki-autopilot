import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
const dbUrl = 'postgresql://postgres:@Edv200568@Edv@db.fobehbttydmqupfpioux.supabase.co:5432/postgres';

async function migrate() {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  
  const sql = fs.readFileSync('supabase/migrations/003_robot_commands_and_heartbeats.sql', 'utf-8');
  await client.query(sql);
  console.log('MIGRATION_003: SUCCESS');
  
  const checkCmds = await client.query("SELECT count(table_name) FROM information_schema.tables WHERE table_name = 'robot_commands'");
  console.log('TABLE_ROBOT_COMMANDS_EXISTS:', checkCmds.rows[0].count === '1');

  const checkHb = await client.query("SELECT count(table_name) FROM information_schema.tables WHERE table_name = 'worker_heartbeats'");
  console.log('TABLE_WORKER_HEARTBEATS_EXISTS:', checkHb.rows[0].count === '1');
  
  const pubCheck = await client.query("SELECT pubname, tablename FROM pg_publication_tables WHERE tablename IN ('robot_commands', 'worker_heartbeats')");
  console.log('REALTIME_PUBLICATIONS:', pubCheck.rows);

  await client.end();
}

migrate().catch(console.error);
