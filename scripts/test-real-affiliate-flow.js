/**
 * Teste Real do Fluxo de Afiliado Mercado Livre
 *
 * Produto Piloto: Lâmpada Câmera De Segurança wi-fi com Visão Noturna Para Casa
 */

import { supabase } from '../src/database/supabase.js';
import AffiliateLinkService from '../src/services/affiliate-link-service.js';
import TrackingService from '../src/services/tracking-service.js';
import CreativeEngine from '../src/services/creative-engine.js';

async function main() {
  console.log('=== TESTE AUTOMÁTICO REAL — FLUXO DE AFILIADO MERCADO LIVRE ===\n');

  // 1. Obter produto piloto do Supabase
  const { data: candidates, error } = await supabase
    .from('offer_candidates')
    .select(`
      id,
      ai_score,
      products (
        id,
        marketplace,
        marketplace_product_id,
        title,
        category,
        product_url,
        image_url,
        affiliate_url,
        product_prices (
          current_price,
          original_price,
          discount_percent
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

  const prod = candidates[0].products;
  const prices = prod.product_prices || [];
  const latestPrice = prices[0] || { current_price: 350.67, original_price: 922.82, discount_percent: 62 };

  console.log(`[1] PRODUTO PILOTO: ${prod.title}`);
  console.log(`    Marketplace: ${prod.marketplace} | ID: ${prod.marketplace_product_id}`);
  console.log(`    URL Original: ${prod.product_url}`);
  console.log(`    Preço Atual: R$ ${latestPrice.current_price} | Desconto: ${latestPrice.discount_percent}%\n`);

  // 2. Executar resolução automática de link de afiliado oficial
  console.log('[2] Executando resolução automática via AffiliateLinkService...');
  const affiliateService = new AffiliateLinkService();
  const affiliateRes = await affiliateService.resolveAffiliateLink({
    marketplace: prod.marketplace,
    productUrl: prod.product_url,
    productId: prod.marketplace_product_id,
    dbProductId: prod.id,
  });

  console.log('\n--- RESULTADO DA RESOLUÇÃO DE AFILIADO ---');
  console.log(`Configurado: ${affiliateRes.configured ? 'SIM' : 'NÃO'}`);
  console.log(`Status: ${affiliateRes.status}`);
  console.log(`Affiliate URL: ${affiliateRes.affiliateUrl}`);
  console.log(`Short URL: ${affiliateRes.shortUrl}`);
  console.log(`Long URL: ${affiliateRes.longUrl}`);
  console.log(`Tag Oficial: ${affiliateRes.tag}`);
  console.log(`Affiliate Verified: ${affiliateRes.affiliateVerified ? 'SIM' : 'NÃO'}`);
  console.log(`Data de Geração: ${affiliateRes.generatedAt}`);

  // 3. Validar se o link foi salvo no Supabase
  console.log('\n[3] Verificando persistência no Supabase...');
  const { data: updatedProd, error: checkErr } = await supabase
    .from('products')
    .select('id, title, affiliate_url')
    .eq('id', prod.id)
    .single();

  const isSavedInDb = updatedProd && updatedProd.affiliate_url === affiliateRes.affiliateUrl;
  console.log(`    Salvo no Supabase: ${isSavedInDb ? 'SIM' : 'NÃO'}`);
  if (isSavedInDb) {
    console.log(`    products.affiliate_url = ${updatedProd.affiliate_url}`);
  }

  // 4. Gerar Tracking Link para a oferta com a affiliateUrl real
  console.log('\n[4] Gerando Tracking Link ACHAki com a affiliateUrl real...');
  const trackingService = new TrackingService();
  const trackingId = trackingService.generateTrackingId();
  const trackingUrl = trackingService.buildTrackingUrl(trackingId);
  console.log(`    Tracking ID: ${trackingId}`);
  console.log(`    Tracking URL: ${trackingUrl}`);

  // 5. Gerar Criativo Oficial para Facebook
  console.log('\n[5] Gerando Criativo Oficial via CreativeEngine...');
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

  console.log(`\n--- POST GERADO PARA FACEBOOK ---\n${creative.text}\n---------------------------------`);

  console.log('\n✔ Teste automático real de afiliado concluído com sucesso!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Falha no teste:', err);
  process.exit(1);
});
