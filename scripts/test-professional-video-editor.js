import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import fs from 'node:fs';
import { ProfessionalVideoEditor } from '../src/services/factory/professional-video-editor.js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';
const supabase = createClient(supabaseUrl, supabaseKey);

async function runTest() {
  console.log('=== TESTE ETAPA 4: EDITOR ACHAki ===');

  // 1. Localiza a creative_version já produzida nas etapas anteriores
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

  // 2. Executa ProfessionalVideoEditor
  console.log('\n[2] Acionando ProfessionalVideoEditor (sincronização de cenas, locução, ritmo, trilha e branding)...');
  const editor = new ProfessionalVideoEditor({ supabaseClient: supabase });

  const result = await editor.editAndAssemble({
    creativeId: targetCreativeId,
    version: creativeRecord.version_number || 1,
  });

  console.log('\n[3] Resultado da Montagem Publicitária:');
  console.log(`    Cenas Utilizadas: ${result.cenasUtilizadas}`);
  console.log(`    Duração Final:    ${result.duracao}`);
  console.log(`    Resolução:        ${result.resolucao}`);
  console.log(`    Tamanho do MP4:   ${(result.fileSizeBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`    URL no Storage:   ${result.storageUrl}`);
  console.log(`    URL Thumbnail:    ${result.thumbnailUrl}`);

  // 4. Verificação no banco de dados
  console.log('\n[4] Verificando integridade na tabela creative_versions...');
  const { data: updatedRecord } = await supabase
    .from('creative_versions')
    .select('id, video_url, thumbnail_url, duration, status, metadata')
    .eq('id', targetCreativeId)
    .single();

  const isMp4Valid = Boolean(updatedRecord?.video_url && updatedRecord.video_url.endsWith('.mp4'));
  const isStorageValid = Boolean(updatedRecord?.video_url && updatedRecord.video_url.includes('supabase.co/storage'));

  console.log(`    Status do Criativo no Banco: ${updatedRecord?.status}`);
  console.log(`    URL Final Gravada: ${updatedRecord?.video_url}`);

  // 5. Relatório no formato exigido
  console.log('\n======================================');
  console.log(`EDITOR: ${result.editorStatus}`);
  console.log(`CENAS UTILIZADAS: ${result.cenasUtilizadas}`);
  console.log(`DURAÇÃO: ${result.duracao}`);
  console.log(`RESOLUÇÃO: ${result.resolucao}`);
  console.log(`ÁUDIO: ${result.audioStatus}`);
  console.log(`MP4: ${isMp4Valid ? 'OK' : 'ERRO'}`);
  console.log(`STORAGE: ${isStorageValid ? 'OK' : 'ERRO'}`);
  console.log('======================================');
}

runTest().catch(err => {
  console.error('Falha no teste do ProfessionalVideoEditor:', err);
  process.exit(1);
});
