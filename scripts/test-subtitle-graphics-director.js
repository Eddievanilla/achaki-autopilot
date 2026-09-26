import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import fs from 'node:fs';
import { SubtitleAndGraphicsDirector } from '../src/services/factory/subtitle-graphics-director.js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';
const supabase = createClient(supabaseUrl, supabaseKey);

async function runTest() {
  console.log('=== TESTE ETAPA 5: LEGENDAS E MOTION GRAPHICS ===');

  let targetCreativeId = 'c1c95f85-4556-408b-b037-c22416912b35';
  let { data: creativeRecord } = await supabase
    .from('creative_versions')
    .select('*')
    .eq('id', targetCreativeId)
    .maybeSingle();

  if (!creativeRecord) {
    const { data: latest } = await supabase
      .from('creative_versions')
      .select('*')
      .not('script_data', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    creativeRecord = latest;
    targetCreativeId = creativeRecord.id;
  }

  console.log(`[1] Creative Version selecionada [Creative ID: ${targetCreativeId}] (v${creativeRecord.version_number || 1})`);
  console.log(`    Produto: "${creativeRecord.script_data?.metadata?.productTitle || creativeRecord.headline}"`);

  // 2. Executa SubtitleAndGraphicsDirector
  console.log('\n[2] Acionando SubtitleAndGraphicsDirector (Legendas dinâmicas PT-BR, sincronização e safe-area)...');
  const director = new SubtitleAndGraphicsDirector({ supabaseClient: supabase });

  const result = await director.processAndMasterVideo({
    creativeId: targetCreativeId,
    version: creativeRecord.version_number || 1,
  });

  console.log('\n[3] Cartões de Legendas Gerados:');
  result.captions.forEach((c, idx) => {
    console.log(`    - [${idx + 1}] (${c.start.toFixed(1)}s -> ${c.end.toFixed(1)}s): "${c.text}" [Cor: ${c.color}]`);
  });

  console.log('\n[4] Validação de Métricas e Conformidade:');
  console.log(`    Duração Master: ${result.duracao}`);
  console.log(`    Resolução:      ${result.resolucao} (Formato 9:16)`);
  console.log(`    Safe Area:      ${result.safeArea}`);
  console.log(`    Storage URL:    ${result.storageUrl}`);

  // 5. Verificação na tabela creative_versions
  const { data: updatedRecord } = await supabase
    .from('creative_versions')
    .select('id, video_url, status, metadata')
    .eq('id', targetCreativeId)
    .single();

  const isMp4Valid = Boolean(updatedRecord?.video_url && updatedRecord.video_url.endsWith('.mp4'));
  const isStorageValid = Boolean(updatedRecord?.video_url && updatedRecord.video_url.includes('supabase.co/storage'));

  console.log('\n======================================');
  console.log(`LEGENDAS PT-BR: ${result.legendasPtBr}`);
  console.log(`SINCRONIZAÇÃO: ${result.sincronizacao}`);
  console.log(`SAFE AREA: ${result.safeArea}`);
  console.log(`MOTION GRAPHICS: ${result.motionGraphics}`);
  console.log(`CTA: ${result.cta}`);
  console.log(`MP4 FINAL: ${isMp4Valid && isStorageValid ? 'OK' : 'ERRO'}`);
  console.log('======================================');
}

runTest().catch(err => {
  console.error('Falha no teste do SubtitleAndGraphicsDirector:', err);
  process.exit(1);
});
