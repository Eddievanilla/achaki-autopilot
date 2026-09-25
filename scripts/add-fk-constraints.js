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

  try {
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_pub_approvals_product'
        ) THEN
          ALTER TABLE publication_approvals
            ADD CONSTRAINT fk_pub_approvals_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_pub_approvals_creative'
        ) THEN
          ALTER TABLE publication_approvals
            ADD CONSTRAINT fk_pub_approvals_creative FOREIGN KEY (creative_id) REFERENCES creative_versions(id) ON DELETE SET NULL;
        END IF;
      END $$;

      NOTIFY pgrst, 'reload schema';
    `);
    console.log('Foreign keys created and schema reloaded.');
  } catch (err) {
    console.error('Error adding constraints:', err.message);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
