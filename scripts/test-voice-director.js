import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import fs from 'node:fs';
import { VoiceDirector } from '../src/agents/voice-director.js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';
const supabase = createClient(supabaseUrl, supabaseKey);

async function runTest() {
  console.log('=== TESTE ETAPA 3: DIREÇÃO DE VOZ PT-BR ===');

  // 1. Busca o mesmo creative_id testado anteriormente
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

  console.log(`[1] Creative Version selecionada para o teste [Creative ID: ${targetCreativeId}]`);
  console.log(`    Produto: "${creativeRecord.script_data?.metadata?.productTitle || creativeRecord.headline}"`);
  console.log(`    Total de cenas no Blueprint: ${creativeRecord.script_data?.cenas?.length}`);

  const blueprint = creativeRecord.script_data;

  // 2. Executa VoiceDirector com estilo e prosódia PT-BR
  console.log('\n[2] Acionando VoiceDirector (preparação de texto fonético e síntese cena por cena)...');
  const director = new VoiceDirector({ supabaseClient: supabase });

  const voiceReport = await director.directAllScenes({
    creativeId: targetCreativeId,
    creativeVersion: creativeRecord.version_number || 1,
    blueprint,
    config: {
      gender: 'FEMALE',
      style: 'NATURAL',
      speed: 1.0,
    },
  });

  console.log('\n[3] Relatório da Locução por Cena:');
  voiceReport.voices.forEach(v => {
    console.log(`    - [${v.sceneId}] Arquivo: ${v.filename} (${(v.fileSizeBytes / 1024).toFixed(1)} KB) | Duração: ${v.durationSeconds}s`);
    console.log(`      Voz: ${v.voiceName} | Estilo: ${v.style} | Ênfase: "${v.sceneEmphasis}"`);
    console.log(`      Texto Adaptado PT-BR: "${v.preparedText}"`);
    console.log(`      DataURL gerado: ${v.audioDataUrl ? 'SIM' : 'NÃO'}`);
  });

  console.log(`\n    Duração Total da Locução: ${voiceReport.duracaoTotalVoz}s`);
  console.log(`    Custo de API: ${voiceReport.apiCost}`);

  // 4. Verificação no banco de dados e arquivos locais
  console.log('\n[4] Verificando integridade no banco de dados...');
  const { data: updatedRecord } = await supabase
    .from('creative_versions')
    .select('id, video_url, script_data, metadata')
    .eq('id', targetCreativeId)
    .single();

  const allScenesHaveVoice = updatedRecord?.script_data?.cenas?.every(c => c.voiceAudioDataUrl || c.voiceStatus === 'PRODUCED');
  const videoFinalGerado = Boolean(updatedRecord?.video_url && (updatedRecord.video_url.includes('.mp4') || updatedRecord.video_url.includes('.webm')));

  console.log(`    Storyboard atualizado com locução: ${allScenesHaveVoice ? 'SIM' : 'NÃO'}`);
  console.log(`    Vídeo Final Montado: ${videoFinalGerado ? 'SIM (ERRO)' : 'NÃO (CORRETO - locução independente)'}`);

  // 5. Relatório no formato exigido
  console.log('\n======================================');
  console.log(`VOICE DIRECTOR: ${voiceReport.directorStatus}`);
  console.log(`IDIOMA: ${voiceReport.language}`);
  console.log(`VOZ: ${voiceReport.voice}`);
  console.log(`CENAS COM LOCUÇÃO: ${voiceReport.scenesWithVoice}`);
  console.log(`CUSTO DE API: ${voiceReport.apiCost}`);
  console.log(`VÍDEO FINAL GERADO: ${videoFinalGerado ? 'SIM' : 'NÃO'}`);
  console.log('======================================');
}

runTest().catch(err => {
  console.error('Falha no teste do VoiceDirector:', err);
  process.exit(1);
});
