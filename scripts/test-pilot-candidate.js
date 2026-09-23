/**
 * Test Pilot Candidate & Validation
 */
import { supabase } from '../src/database/supabase.js';
import AffiliateLinkService from '../src/services/affiliate-link-service.js';
import TrackingService from '../src/services/tracking-service.js';
import CreativeEngine from '../src/services/creative-engine.js';
import GoalOptimizer from '../src/agents/goal-optimizer.js';

async function main() {
  console.log('=== SELEÇÃO E VALIDAÇÃO DA OFERTA PILOTO ===\n');

  // 1. Buscar a melhor oferta selecionada no Supabase
  const { data: candidates, error } = await supabase
    .from('offer_candidates')
    .select(`
      id,
      ai_score,
      ai_reason,
      ai_risk,
      status,
      created_at,
      products (
        id,
        marketplace,
        marketplace_product_id,
        title,
        category,
        product_url,
        image_url,
        seller_name,
        product_prices (
          current_price,
          original_price,
          discount_percent,
          collected_at
        )
      )
    `)
    .eq('status', 'selected')
    .order('ai_score', { ascending: false })
    .limit(1);

  if (error || !candidates || candidates.length === 0) {
    console.error('Nenhum candidato encontrado:', error?.message);
    process.exit(1);
  }

  const candidate = candidates[0];
  const prod = candidate.products;
  const prices = (prod.product_prices || []).sort(
    (a, b) => new Date(b.collected_at) - new Date(a.collected_at)
  );
  const latestPrice = prices[0] || { current_price: 80.9, original_price: 161.8, discount_percent: 50 };

  console.log(`PRODUTO: ${prod.title}`);
  console.log(`ID: ${prod.id} (${prod.marketplace} - ${prod.marketplace_product_id})`);
  console.log(`PREÇO ATUAL: R$ ${Number(latestPrice.current_price).toFixed(2)}`);
  console.log(`PREÇO ORIGINAL: R$ ${Number(latestPrice.original_price).toFixed(2)}`);
  console.log(`DESCONTO: ${latestPrice.discount_percent}%`);

  // 2. Validação de consistência de preço
  const isPriceValid = latestPrice.current_price > 0 && 
    (!latestPrice.original_price || latestPrice.current_price <= latestPrice.original_price);
  console.log(`PREÇO VALIDADO: ${isPriceValid ? 'SIM' : 'NÃO'}`);

  // 3. Validação do link de afiliado
  const affiliateService = new AffiliateLinkService();
  const affiliateRes = affiliateService.resolveAffiliateLink({
    marketplace: prod.marketplace,
    productUrl: prod.product_url,
    productId: prod.marketplace_product_id,
  });

  console.log(`AFFILIATE URL CONFIGURADA: ${affiliateRes.configured ? 'SIM' : 'NÃO'}`);
  console.log(`STATUS AFILIADO: ${affiliateRes.status}`);
  if (affiliateRes.reason) {
    console.log(`MOTIVO: ${affiliateRes.reason}`);
  }

  // 4. Geração de Tracking URL
  const trackingService = new TrackingService();
  const trackingId = trackingService.generateTrackingId();
  const trackingUrl = trackingService.buildTrackingUrl(trackingId);
  console.log(`TRACKING ID: ${trackingId}`);
  console.log(`TRACKING URL: ${trackingUrl}`);

  // 5. Estratégia e Creative Engine
  const creativeEngine = new CreativeEngine();
  const creative = creativeEngine.generatePost({
    title: prod.title,
    currentPrice: latestPrice.current_price,
    originalPrice: latestPrice.original_price,
    discountPercent: latestPrice.discount_percent,
    imageUrl: prod.image_url,
    trackingUrl: trackingUrl,
    strategy: { code: 'DESCONTO', name: 'Desconto Real Comprovado' },
    category: prod.category,
  });

  console.log(`\nESTRATÉGIA: ${creative.strategyCode}`);
  console.log(`IMAGEM: ${creative.imageUrl}`);
  console.log(`\nTEXTO GERADO:\n---\n${creative.text}\n---`);

  // 6. Teste GoalOptimizer antes de publicações
  const goalOptimizer = new GoalOptimizer();
  const goalEval = goalOptimizer.evaluate({ publicationsToday: 0 });
  console.log(`\nGOAL OPTIMIZER (Zero publicações):`);
  console.log(`STATUS: ${goalEval.status}`);
  console.log(`DECISÃO: ${goalEval.decisionType}`);
  console.log(`MOTIVO: ${goalEval.reason}`);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
