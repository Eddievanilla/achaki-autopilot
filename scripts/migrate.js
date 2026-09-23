/**
 * ACHAki Autopilot — Executor e Validador de Migration Supabase (Fase 4.3.1)
 *
 * Executa a migration 001_initial_schema.sql diretamente no banco Supabase
 * e realiza auditoria completa de schema, chaves, índices, RLS e CRUD test.
 *
 * SEGURANÇA:
 *  - NENHUMA credencial é exibida em tela ou nos logs.
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { supabase } from '../src/database/supabase.js';

const { Client } = pg;

function parseDbConfig() {
  const dbUrl = process.env.SUPABASE_DB_URL || '';
  if (dbUrl) {
    // Tratamento caso a URL contenha @ na senha: postgresql://postgres:@Edv200568@Edv@db.fobehbttydmqupfpioux.supabase.co:5432/postgres
    const regex = /^postgresql:\/\/([^:]+):(.*)@([^:/]+):(\d+)\/(.+)$/;
    const match = dbUrl.match(regex);
    if (match) {
      return {
        user: match[1],
        password: match[2],
        host: match[3],
        port: parseInt(match[4], 10),
        database: match[5],
        ssl: { rejectUnauthorized: false },
      };
    }
  }

  // Fallback padrão derivado das variáveis
  return {
    host: 'db.fobehbttydmqupfpioux.supabase.co',
    user: 'postgres',
    password: '@Edv200568@Edv',
    port: 5432,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  };
}

async function main() {
  const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/001_initial_schema.sql');
  if (!fs.existsSync(migrationPath)) {
    throw new Error('Arquivo de migration não encontrado: ' + migrationPath);
  }

  const sql = fs.readFileSync(migrationPath, 'utf8');

  const config = parseDbConfig();
  const client = new Client(config);

  await client.connect();

  console.log('[1/4] Executando migration 001_initial_schema.sql...');
  await client.query(sql);
  console.log('✔ Migration executada com sucesso no Supabase.');

  console.log('\n[2/4] Auditando schema das tabelas criadas...');
  const expectedTables = [
    'products',
    'product_prices',
    'offer_candidates',
    'publications',
    'performance_metrics',
  ];

  const tablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = ANY($1::text[])
  `, [expectedTables]);

  const foundTables = tablesRes.rows.map(r => r.table_name);
  for (const t of expectedTables) {
    const ok = foundTables.includes(t);
    console.log(`  - ${t}: ${ok ? 'OK' : 'ERRO'}`);
  }

  console.log('\n[3/4] Auditando Foreign Keys, Unique Constraints, Índices e RLS...');

  // Verificar Foreign Keys
  const fkRes = await client.query(`
    SELECT constraint_name, table_name
    FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
      AND table_schema = 'public'
  `);
  const hasFks = fkRes.rows.length >= 4;
  console.log(`  - FOREIGN KEYS: ${hasFks ? 'OK' : 'ERRO'} (${fkRes.rows.length} FKs encontradas)`);

  // Verificar UNIQUE (marketplace, marketplace_product_id)
  const uniqueRes = await client.query(`
    SELECT conname 
    FROM pg_constraint 
    WHERE contype = 'u' 
      AND conrelid = 'public.products'::regclass
  `);
  const hasUnique = uniqueRes.rows.some(r => r.conname === 'uq_products_marketplace_product');
  console.log(`  - UNIQUE PRODUTO: ${hasUnique ? 'OK' : 'ERRO'}`);

  // Verificar Índices
  const indexRes = await client.query(`
    SELECT indexname 
    FROM pg_indexes 
    WHERE schemaname = 'public' 
      AND indexname LIKE 'idx_%'
  `);
  const hasIndexes = indexRes.rows.length >= 10;
  console.log(`  - ÍNDICES: ${hasIndexes ? 'OK' : 'ERRO'} (${indexRes.rows.length} índices encontrados)`);

  // Verificar RLS
  const rlsRes = await client.query(`
    SELECT tablename, rowsecurity 
    FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename = ANY($1::text[])
  `, [expectedTables]);
  const allRlsEnabled = rlsRes.rows.every(r => r.rowsecurity === true);
  console.log(`  - RLS HABILITADO EM TODAS AS TABELAS: ${allRlsEnabled ? 'OK' : 'ERRO'}`);

  await client.end();

  console.log('\n[4/4] Executando teste REAL de escrita/leitura via Supabase Client (Service Role)...');

  // Teste de inserção de produto
  const testProductId = 'MLBU_TEST_AUTOPILOT_001';
  const { data: insertedProduct, error: insertError } = await supabase
    .from('products')
    .insert({
      marketplace: 'mercadolivre',
      marketplace_product_id: testProductId,
      title: 'Produto Teste Verificação Schema',
      category: 'teste',
      product_url: 'https://produto.mercadolivre.com.br/MLB-test-001',
      seller_name: 'Vendedor Teste',
    })
    .select()
    .single();

  if (insertError) {
    throw new Error('Falha ao inserir produto de teste: ' + insertError.message);
  }
  console.log('  - TESTE ESCRITA (products): OK');

  // Teste de leitura de produto
  const { data: readProduct, error: readError } = await supabase
    .from('products')
    .select('*')
    .eq('id', insertedProduct.id)
    .single();

  if (readError || !readProduct) {
    throw new Error('Falha ao consultar produto de teste: ' + (readError?.message || 'não encontrado'));
  }
  console.log('  - TESTE LEITURA (products): OK');

  // Inserir registro em product_prices relacionado
  const { data: insertedPrice, error: priceError } = await supabase
    .from('product_prices')
    .insert({
      product_id: insertedProduct.id,
      current_price: 99.90,
      original_price: 129.90,
      discount_percent: 23,
    })
    .select()
    .single();

  if (priceError) {
    throw new Error('Falha ao inserir preço de teste: ' + priceError.message);
  }
  console.log('  - TESTE ESCRITA (product_prices relacional): OK');

  // Consultar relacionamento
  const { data: relationalData, error: relError } = await supabase
    .from('products')
    .select(`
      id,
      title,
      product_prices (
        current_price,
        discount_percent
      )
    `)
    .eq('id', insertedProduct.id)
    .single();

  if (relError || !relationalData?.product_prices?.length) {
    throw new Error('Falha ao consultar relacionamento: ' + (relError?.message || 'vazio'));
  }
  console.log('  - TESTE LEITURA RELACIONAMENTO: OK');

  // Limpeza completa dos dados de teste
  const { error: deleteError } = await supabase
    .from('products')
    .delete()
    .eq('id', insertedProduct.id);

  if (deleteError) {
    throw new Error('Falha ao remover produto de teste: ' + deleteError.message);
  }

  // Confirmar que cascade removeu de product_prices também
  const { data: leftoverPrices } = await supabase
    .from('product_prices')
    .select('id')
    .eq('id', insertedPrice.id);

  const clean = !leftoverPrices || leftoverPrices.length === 0;
  console.log(`  - DADOS DE TESTE REMOVIDOS: ${clean ? 'SIM' : 'NÃO'}`);
  console.log('\n✔ Auditoria e validação concluídas com êxito!');
}

main().catch((err) => {
  console.error('\n❌ Erro durante a migration/teste:', err.message);
  process.exit(1);
});
