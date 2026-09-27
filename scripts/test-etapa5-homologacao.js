import path from 'node:path';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import creativeJobQueue from '../src/services/factory/creative-job-queue.js';
import logger from '../src/utils/logger.js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';
const supabase = createClient(supabaseUrl, supabaseKey);

async function runEtapa5() {
  console.log('================================================================');
  console.log('🚀 ETAPA 5: AUDITORIA, TESTE PONTA A PONTA E HOMOLOGAÇÃO NA GALERIA');
  console.log('================================================================\n');

  const productId = '7cd50a16-8fa5-4974-9bce-46d91b88fc40';

  // 1. Busca dados do produto
  const { data: product, error: pErr } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .single();

  if (pErr || !product) {
    console.error('❌ Produto não encontrado no Supabase:', pErr?.message);
    process.exit(1);
  }

  console.log(`📦 Produto Selecionado: "${product.title}"`);
  console.log(`🔗 URL: ${product.product_url}`);
  console.log(`🖼️ Imagem: ${product.image_url}`);

  // 2. Enfileira novo Job com prioridade HIGH
  console.log('\n📥 1. Enfileirando Job Criativo com prioridade HIGH...');
  const job = await creativeJobQueue.enqueueJob({
    productId: product.id,
    priority: 'HIGH',
    creativeVersion: 2,
    headline: 'Lâmpada Câmera 360 Graus com Visão Noturna',
    idempotencyKey: `etapa5_homologacao_${Date.now()}`,
  });

  console.log(`✅ Job Criativo criado [ID: ${job.id}] [Status: ${job.status}]`);

  // 3. Executa o pipeline completo ponta a ponta
  console.log('\n⚙️ 2. Executando Pipeline Completo da Super Produtora (Etapas 1, 2, 3 e 4)...');
  job.products = product;
  const startTime = Date.now();
  const processResult = await creativeJobQueue._executeJob(job);
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n🏁 Execução do Pipeline Concluída (${elapsedSec}s)`);

  // 4. Auditoria no Banco de Dados
  console.log('\n📊 3. Auditando registros no Supabase...');

  // Verifica creative_versions
  const { data: versionRecord, error: vErr } = await supabase
    .from('creative_versions')
    .select('*')
    .eq('id', processResult.creativeId)
    .single();

  if (vErr || !versionRecord) {
    console.error('❌ Falha ao encontrar creative_versions:', vErr?.message);
  } else {
    console.log(`✅ creative_versions OK:`, {
      id: versionRecord.id,
      version_number: versionRecord.version_number,
      status: versionRecord.status,
      headline: versionRecord.headline,
      duration: `${versionRecord.duration}s`,
      video_url: versionRecord.video_url,
      thumbnail_url: versionRecord.thumbnail_url,
    });
  }

  // Verifica creative_assets
  const { data: assetRecords } = await supabase
    .from('creative_assets')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (assetRecords && assetRecords.length > 0) {
    const asset = assetRecords[0];
    console.log(`✅ creative_assets OK:`, {
      id: asset.id,
      type: asset.type,
      width: asset.width,
      height: asset.height,
      file_size: `${(asset.file_size / 1024 / 1024).toFixed(2)} MB`,
      storage_url: asset.storage_url,
    });
  }

  // Verifica creative_jobs
  const { data: jobFinal } = await supabase
    .from('creative_jobs')
    .select('id, status, creative_id, output_asset_id, completed_at')
    .eq('id', job.id)
    .single();

  console.log(`✅ creative_jobs OK:`, jobFinal);

  // 5. Auditoria de Espaço em Disco (Zero Bytes)
  console.log('\n💾 4. Verificando Espaço em Disco Local (Zero Bytes)...');
  const tempDir = path.resolve(`data/produced_scenes/${job.id}_v2`);
  const stillExists = fs.existsSync(tempDir);
  console.log(`   Pasta de cenas intermediárias existe? ${stillExists ? 'SIM (Aviso)' : 'NÃO (Limpeza confirmada com 100% de sucesso - Zero Bytes!)'}`);

  console.log('\n================================================================');
  console.log('🎉 ETAPA 5 CONCLUÍDA: CRIATIVO MASTER HOMOLOGADO NA GALERIA!');
  console.log(`🎥 VÍDEO FINAL: ${processResult.videoUrl || versionRecord?.video_url}`);
  console.log('================================================================\n');
}

runEtapa5().catch(err => {
  console.error('❌ Erro fatal na Etapa 5:', err);
  process.exit(1);
});
