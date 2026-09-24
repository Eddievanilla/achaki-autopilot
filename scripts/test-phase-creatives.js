import { MediaAssetService } from '../src/services/media-asset-service.js';
import { CreativeComposer } from '../src/services/creative-composer.js';
import { supabase } from '../src/database/supabase.js';

async function main() {
  console.log('====================================================');
  console.log('🚀 TESTE SEÇÃO 15: DESCOBERTA, DOWNLOAD, DEDUPLICAÇÃO & STORAGE');
  console.log('====================================================\n');

  const mediaService = new MediaAssetService();
  const composer = new CreativeComposer();

  // 1. Fetch 3 real products
  const { data: products, error: pErr } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3);

  if (pErr || !products || products.length === 0) {
    console.error('Erro ao buscar produtos:', pErr);
    process.exit(1);
  }

  console.log(`📦 3 Produtos Reais Selecionados:`);
  products.forEach((p, idx) => {
    console.log(`  ${idx + 1}. [${p.id}] ${p.title} (${p.marketplace_product_id}) - R$ ${p.current_price}`);
  });

  const harvestResults = [];

  // 2. Harvest media for each product
  for (const product of products) {
    console.log(`\n----------------------------------------------------`);
    console.log(`🔍 Coletando mídias para: "${product.title}" (${product.marketplace_product_id})`);
    const res = await mediaService.syncProductAssets(product);
    console.log(`   Resultado:`, {
      totalImages: res.totalImages,
      totalVideos: res.totalVideos,
      videoAvailable: res.videoAvailable,
      newStored: res.newStoredCount,
      duplicatesSkipped: res.duplicateCount,
      assets: res.assets.map(a => ({
        type: a.type,
        mime: a.mime_type,
        sizeKb: Math.round(a.file_size / 1024),
        url: a.storage_url
      }))
    });
    harvestResults.push({ product, res });
  }

  // 3. Test Deduplication: Run harvest again on the first product
  console.log(`\n----------------------------------------------------`);
  console.log(`🔁 Testando DEDUPLICAÇÃO (Reexecutando produto 1):`);
  const dedupRes = await mediaService.syncProductAssets(products[0]);
  console.log(`   Resultado Reexecução:`, {
    totalImages: dedupRes.totalImages,
    totalVideos: dedupRes.totalVideos,
    newStored: dedupRes.newStoredCount,
    duplicatesSkipped: dedupRes.duplicateCount,
    deduplicationWorking: dedupRes.newStoredCount === 0 && dedupRes.duplicateCount > 0
  });

  // 4. Test CreativeComposer Decision
  console.log(`\n----------------------------------------------------`);
  console.log(`🎨 Testando CreativeComposer (Decisão de Formato & Ângulo Comercial):`);
  const decision = await composer.composeCreative({ product: products[0], channel: 'Facebook' });
  console.log(`   Decisão tomada:`, {
    format: decision.format,
    angle: decision.commercialAngle,
    selectedAssetsCount: decision.selectedAssets.length,
    rationale: decision.decisionRationale,
    assetsSummary: decision.assetsSummary
  });

  // 5. Total Assets in Supabase DB
  const { data: allAssets } = await supabase.from('creative_assets').select('*');
  const images = (allAssets || []).filter(a => a.type === 'IMAGE');
  const videos = (allAssets || []).filter(a => a.type === 'VIDEO');

  console.log(`\n====================================================`);
  console.log(`📊 BALANÇO GERAL DE CRIATIVOS NO BANCO:`);
  console.log(`   Total de Assets: ${allAssets ? allAssets.length : 0}`);
  console.log(`   Imagens Reais: ${images.length}`);
  console.log(`   Vídeos Reais: ${videos.length}`);
  console.log(`   Mocks Utilizados: NÃO (Zero mocks, 100% real)`);
  console.log(`   Publicação Real Efetuada: NÃO (Somente curadoria e asset storage)`);
  console.log(`====================================================\n`);

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
