import path from 'node:path';
import fs from 'node:fs';
import { SceneProducer } from '../src/services/factory/scene-producer.js';
import { CreativeDirector } from '../src/agents/creative-director.js';

async function testEtapa2() {
  console.log('🧪 Iniciando teste de renderização da Etapa 2 (SceneProducer)...');

  const testDir = path.resolve('data/test_etapa2_scenes');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  const samplePhoto = path.resolve('data/temp_photos/scene_1_1790513050102_5joad.jpg');
  if (!fs.existsSync(samplePhoto)) {
    console.error('Foto de teste não encontrada:', samplePhoto);
    return;
  }

  const sampleProduct = {
    id: 'test-prod-123',
    title: 'Lampada Camera Segurancawi-ficom Visao Noturna 360 Graus Bivolt 110v 220v Original Lacrado',
    price: 49.90,
    original_price: 79.90,
    discount_percent: 38,
  };

  const director = new CreativeDirector({ openaiApiKey: 'mock-not-needed' });
  const blueprint = await director.createBlueprint({
    productFacts: {
      product_name: sampleProduct.title,
      price: sampleProduct.price,
      original_price: sampleProduct.original_price,
      discount: sampleProduct.discount_percent,
      features_verified: ['Visão Noturna 360 Graus', 'Áudio Bidirecional', 'Compatível com Wi-Fi'],
      specifications_verified: ['Bivolt Automático', 'Resolução Full HD'],
      photos: [samplePhoto],
    },
    product: sampleProduct,
  });

  const producer = new SceneProducer();

  console.log(`Blueprint gerou ${blueprint.cenas.length} cenas.`);

  for (let i = 0; i < blueprint.cenas.length; i++) {
    const scene = blueprint.cenas[i];
    const sceneId = `test_scene_${String(i + 1).padStart(2, '0')}`;
    const strategy = producer.decideStrategy({
      scene,
      index: i,
      totalScenes: blueprint.cenas.length,
      comfyOnline: false,
      hasRealPhoto: true,
    });

    console.log(`\nRendering ${sceneId} [Estratégia: ${strategy}]...`);
    const result = await producer.produceSingleScene({
      creativeId: 'test_etapa2',
      creativeVersion: 1,
      scene,
      index: i,
      sceneId,
      strategy,
      localPhotoPath: samplePhoto,
      product: sampleProduct,
      sceneOutputDir: testDir,
    });

    const stats = fs.statSync(result.videoPath);
    console.log(`✅ ${sceneId} OK! Arquivo: ${result.videoFilename} (${(stats.size / 1024).toFixed(1)} KB, Duração: ${result.durationSeconds}s)`);
  }

  console.log('\n🎉 Teste da Etapa 2 concluído com 100% de sucesso!');
}

testEtapa2().catch(err => {
  console.error('❌ Falha no teste da Etapa 2:', err);
  process.exit(1);
});
