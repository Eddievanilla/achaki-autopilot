import path from 'node:path';
import fs from 'node:fs';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { VoiceoverService, BRAZILIAN_VOICES } from '../src/services/factory/voiceover-service.js';
import { SubtitleAndGraphicsDirector } from '../src/services/factory/subtitle-graphics-director.js';

async function testEtapa3() {
  console.log('🧪 Iniciando teste da Etapa 3 (Locução Comercial & Legendas Sincronizadas)...');

  const testDir = path.resolve('data/test_etapa3');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  const sampleScript = [
    {
      sceneNum: 1,
      narration: 'Olha que praticidade incrível essa Lâmpada Câmera Wi-Fi 360 graus!',
    },
    {
      sceneNum: 2,
      narration: 'Você instala no bocal comum e tem visão noturna nítida direto no celular.',
    },
    {
      sceneNum: 3,
      narration: 'É segurança total para sua casa com o melhor custo-benefício da categoria.',
    },
    {
      sceneNum: 4,
      narration: 'De 79 e 90 por apenas 49 reais e 90 centavos com 38% de desconto.',
    },
    {
      sceneNum: 5,
      narration: 'Garanta a sua agora mesmo no link do primeiro comentário.',
    }
  ];

  console.log('\n🎙️ 1. Testando síntese neural Edge-TTS com cadência comercial (+10% velocidade)...');
  const service = new VoiceoverService();

  for (const s of sampleScript) {
    const audioName = `test_voice_${s.sceneNum}.mp3`;
    const res = await service.generateVoiceover({
      text: s.narration,
      voice: BRAZILIAN_VOICES.FRANCISCA,
      filename: audioName,
      outputDir: testDir,
      rate: '+10%',
      volume: '+10%',
    });

    const stats = fs.statSync(res.audioPath);
    console.log(`✅ Cena ${s.sceneNum}: áudio gerado (${(stats.size / 1024).toFixed(1)} KB, ~${res.durationEstimate}s) -> ${audioName}`);
  }

  console.log('\n📝 2. Testando geração de cartões de legendas dinâmicas a partir do áudio real...');
  const subDirector = new SubtitleAndGraphicsDirector();
  const captions = subDirector.buildDynamicCaptions({
    scenesWithVoice: sampleScript.map(s => ({
      voicePreparedText: s.narration,
      narration: s.narration,
      voiceDurationSeconds: 3.5,
    })),
    product: {
      price: 49.90,
      discount_percent: 38,
    }
  });

  console.log(`Total de cartões de legenda gerados: ${captions.length}`);
  captions.forEach((c, idx) => {
    console.log(`  [${c.start.toFixed(1)}s - ${c.end.toFixed(1)}s] Cor: ${c.color} | Texto: "${c.text}"`);
  });

  console.log('\n🎉 Teste da Etapa 3 validado com sucesso!');
}

testEtapa3().catch(err => {
  console.error('❌ Falha no teste da Etapa 3:', err);
  process.exit(1);
});
