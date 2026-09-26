import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import fs from 'node:fs';
import { SceneProducer } from '../src/services/factory/scene-producer.js';
import { CreativeDirector } from '../src/agents/creative-director.js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';
const supabase = createClient(supabaseUrl, supabaseKey);

async function runTest() {
  console.log('=== TESTE ETAPA 2: PRODUÇÃO VISUAL POR CENAS ===');

  // 1. Localiza um Creative Blueprint real existente no banco
  let creativeRecord = null;
  const { data: creatives } = await supabase
    .from('creative_versions')
    .select('*')
    .not('script_data', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (creatives && creatives.length > 0 && creatives[0].script_data?.cenas?.length > 0) {
    creativeRecord = creatives[0];
    console.log(`[1] Creative Blueprint recuperado do banco [Creative ID: ${creativeRecord.id}]`);
  } else {
    console.log('[1] Nenhum blueprint prévio com cenas encontrado. Criando um via Diretor Criativo...');
    const { data: prod } = await supabase.from('products').select('*').order('created_at', { ascending: false }).limit(1).single();
    const director = new CreativeDirector({ supabaseClient: supabase });
    const bp = director.createBlueprint({ product: prod });
    const saved = await director.saveBlueprint({ productId: prod.id, blueprint: bp });
    const { data: fresh } = await supabase.from('creative_versions').select('*').eq('id', saved.creativeId).single();
    creativeRecord = fresh;
    console.log(`[1] Novo Creative Blueprint gerado [Creative ID: ${creativeRecord.id}]`);
  }

  const blueprint = creativeRecord.script_data;
  console.log(`    Produto: "${blueprint.metadata?.productTitle || creativeRecord.headline}"`);
  console.log(`    Total de cenas no Blueprint: ${blueprint.cenas.length}`);

  // Carrega produto para obter fotos reais
  const { data: product } = await supabase
    .from('products')
    .select('*')
    .eq('id', creativeRecord.product_id)
    .single();

  // 2. Executa o SceneProducer
  console.log('\n[2] Acionando SceneProducer para produzir cada cena individualmente...');
  const producer = new SceneProducer({ supabaseClient: supabase });

  const result = await producer.produceAllScenes({
    creativeId: creativeRecord.id,
    creativeVersion: creativeRecord.version_number || 1,
    blueprint,
    product,
  });

  console.log('\n[3] Relatório Detalhado da Produção por Cenas:');
  result.scenes.forEach(s => {
    console.log(`    - [${s.sceneId}] Estratégia: ${s.strategy.padEnd(20)} | Duração: ${s.durationSeconds}s | Resolução: ${s.resolution} | Foto Real: ${s.realPhotoUsed ? 'SIM' : 'NÃO'}`);
    console.log(`      Vídeo:   ${s.videoFilename} (${(s.fileSize / 1024).toFixed(1)} KB)`);
    console.log(`      Preview: ${s.previewFilename} (${s.previewDataUrl ? 'DataURL gerado' : 'Sem dataURL'})`);
    console.log(`      Vínculo: creative_id=${s.creativeId}, version=${s.creativeVersion}, scene_id=${s.sceneId}`);
  });

  // 4. Verificação de Integridade das Cenas
  console.log('\n[4] Verificando integridade e vinculação no banco...');
  const { data: updatedRecord } = await supabase
    .from('creative_versions')
    .select('id, video_url, script_data, metadata')
    .eq('id', creativeRecord.id)
    .single();

  const storyboardWithPreviews = updatedRecord?.script_data?.cenas?.every(c => c.previewDataUrl || c.status === 'PRODUCED');
  const videoFinalGerado = Boolean(updatedRecord?.video_url && (updatedRecord.video_url.includes('.mp4') || updatedRecord.video_url.includes('.webm')));

  console.log(`    Previews integrados ao Storyboard: ${storyboardWithPreviews ? 'SIM' : 'NÃO'}`);
  console.log(`    Vídeo Final Completo Gerado: ${videoFinalGerado ? 'SIM (ERRO)' : 'NÃO (CORRETO - apenas cenas individuais)'}`);

  // 5. Relatório no formato exigido
  console.log('\n======================================');
  console.log(`CENAS PLANEJADAS: ${result.cenasPlanejadas}`);
  console.log(`CENAS PRODUZIDAS: ${result.cenasProduzidas}`);
  console.log(`FOTOS REAIS UTILIZADAS: ${result.fotosReaisUtilizadas}`);
  console.log(`CENAS COMFYUI: ${result.cenasComfy}`);
  console.log(`ERROS: ${result.erros === 0 ? 'NENHUM' : result.erros}`);
  console.log(`VÍDEO FINAL GERADO: ${videoFinalGerado ? 'SIM' : 'NÃO'}`);
  console.log('======================================');
}

runTest().catch(err => {
  console.error('Falha no teste do SceneProducer:', err);
  process.exit(1);
});
