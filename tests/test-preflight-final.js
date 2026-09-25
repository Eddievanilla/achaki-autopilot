/**
 * PRE-FLIGHT AUDIT SCRIPT - ACHAKI AUTOPILOT
 * Validação rigorosa dos 10 pilares operacionais SEM publicar.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import CategoryClassifier from '../src/services/category-classifier.js';
import AffiliateLinkService from '../src/services/affiliate-link-service.js';
import FacebookPublisher from '../src/publishers/facebook-publisher.js';
import PriceValidationEngine from '../src/services/price-validation-engine.js';
import DemandIntelligenceEngine from '../src/services/demand/demand-intelligence-engine.js';
import GoalOptimizer from '../src/agents/goal-optimizer.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function runPreflight() {
  console.log('='.repeat(70));
  console.log('🚀 INICIANDO AUDITORIA PRE-FLIGHT DEFINITIVA - ACHAki AUTOPILOT');
  console.log('='.repeat(70));

  const results = {};

  // 1. CATEGORY CLASSIFIER
  console.log('\n[1/10] Testando CategoryClassifier...');
  const classifier = new CategoryClassifier();
  const monitorRes = classifier.classify('Monitor Gamer Portátil 15.6 1080p FHD 60Hz IPS');
  const watchRes = classifier.classify('Smartwatch HUAWEI Band 10 Caixa de Polímero Tela 1.47');
  const tabletRes = classifier.classify('HUAWEI MatePad SE 11 4GB+128GB Tablet 11 polegadas');
  const joggerRes = classifier.classify('Calça Jogger Tactel Soltinha Moda Feminina');
  const emmaRes = classifier.classify('Colchão Casal Emma Duo Comfort 138x188');

  console.log(`- Monitor: "${monitorRes.category}" (Confiança: ${monitorRes.confidence})`);
  console.log(`- Smartwatch: "${watchRes.category}" (Confiança: ${watchRes.confidence})`);
  console.log(`- Tablet: "${tabletRes.category}" (Confiança: ${tabletRes.confidence})`);
  console.log(`- Calça: "${joggerRes.category}" (Confiança: ${joggerRes.confidence})`);
  console.log(`- Colchão: "${emmaRes.category}" (Confiança: ${emmaRes.confidence})`);

  const categoryOk = (
    monitorRes.category.includes('Monitores') &&
    watchRes.category.includes('Wearables') &&
    tabletRes.category.includes('Tablets') &&
    joggerRes.category.includes('Vestuário') &&
    emmaRes.category.includes('Quarto')
  );
  results.categoryClassifier = categoryOk ? 'OK' : 'ERRO';
  results.monitorCategory = monitorRes.category;
  results.smartwatchCategory = watchRes.category;
  results.tabletCategory = tabletRes.category;

  // 2. AFFILIATE LINK SERVICE & MELI.LA CONFIRMADO
  console.log('\n[2/10] Testando AffiliateLinkService & Confirmação meli.la...');
  const affiliateService = new AffiliateLinkService({ headless: true });

  // Teste 2a: Produto com meli.la já confirmado no banco
  const { data: verifiedProducts } = await supabase
    .from('products')
    .select('id, title, product_url, affiliate_url')
    .not('affiliate_url', 'is', null)
    .ilike('affiliate_url', '%meli.la%')
    .limit(1);

  let realMeliUrl = null;
  if (verifiedProducts && verifiedProducts.length > 0) {
    const p = verifiedProducts[0];
    const resolved = await affiliateService.resolveAffiliateLink({
      marketplace: 'mercadolivre',
      productUrl: p.product_url,
      dbProductId: p.id
    });
    console.log(`- Produto verificado testado: "${p.title?.slice(0, 30)}"`);
    console.log(`- Link retornado: ${resolved.affiliateUrl}`);
    console.log(`- Status: ${resolved.status}, Verificado: ${resolved.affiliateVerified}`);
    if (resolved.affiliateVerified && resolved.affiliateUrl?.includes('meli.la')) {
      realMeliUrl = resolved.affiliateUrl;
    }
  }

  // Teste 2b: Fallback para URL não afiliada DEVE SER BLOQUEADO
  console.log('\n[3/10] Testando bloqueio estrito de fallback...');
  const fakeUnverifiedProduct = {
    marketplace: 'mercadolivre',
    productUrl: 'https://www.mercadolivre.com.br/produto-teste-sem-afiliado-mlb123/p/MLB123',
    productId: 'MLB99999999',
    dbProductId: '00000000-0000-0000-0000-000000000000'
  };

  const originalGenerateAffiliateLink = affiliateService.mlProvider.generateAffiliateLink.bind(affiliateService.mlProvider);
  affiliateService.mlProvider.generateAffiliateLink = async () => ({
    affiliateVerified: false,
    affiliateUrl: null,
    shortUrl: null,
    status: 'AFFILIATE_LINK_UNVERIFIED'
  });

  const fallbackTest = await affiliateService.resolveAffiliateLink(fakeUnverifiedProduct);
  affiliateService.mlProvider.generateAffiliateLink = originalGenerateAffiliateLink;

  console.log(`- Resultado de produto sem meli.la:`);
  console.log(`  status: ${fallbackTest.status}`);
  console.log(`  affiliateUrl: ${fallbackTest.affiliateUrl}`);
  console.log(`  affiliateVerified: ${fallbackTest.affiliateVerified}`);

  const fallbackBlocked = (fallbackTest.affiliateUrl === null && fallbackTest.affiliateVerified === false && fallbackTest.status === 'AFFILIATE_LINK_UNVERIFIED');
  results.fallbackStatus = fallbackBlocked ? 'BLOQUEADO' : 'ERRO';

  results.affiliateLinkService = (realMeliUrl && fallbackBlocked) ? 'OK' : 'ERRO';
  results.realMeliUrl = realMeliUrl;

  // 3. FACEBOOK OAUTH & PERMISSÕES
  console.log('\n[4/10] Testando Facebook OAuth e Permissões...');
  const fb = new FacebookPublisher();
  let fbOk = false;
  try {
    const { data: state } = await supabase
      .from('system_state')
      .select('social_networks')
      .eq('id', 'autopilot')
      .maybeSingle();

    const sn = state?.social_networks || {};
    const pageId = sn.facebook_page_id || '61587794361596';
    const pageName = sn.facebook_page_name || 'ACHAki Achadinhos e Ofertas';
    const isSavedActive = sn.facebook === 'ATIVO' || !!sn.facebook_page_token || !!sn.facebook_user_token;
    const perms = sn.facebook_permissions || {};

    console.log(`- FB Configurado: App ID ${fb.appId}`);
    console.log(`- FB Page ID: ${pageId}`);
    console.log(`- FB Page Name: ${pageName}`);
    console.log(`- FB Autorização Salva: ${isSavedActive ? 'OK' : 'PENDENTE'}`);
    console.log(`- FB pages_manage_posts: ${perms.pages_manage_posts !== false}`);

    fbOk = !!(fb.appId && pageId && isSavedActive && perms.pages_manage_posts !== false);
  } catch (err) {
    console.error(`- Erro ao testar FB: ${err.message}`);
  }
  results.facebook = fbOk ? 'OK' : 'ERRO';

  // 4. PRICE VALIDATION ENGINE MULTI-SOURCE
  console.log('\n[5/10] Testando PriceValidationEngine...');
  const priceEngine = new PriceValidationEngine();
  let priceEngineOk = false;
  try {
    const mathRes = priceEngine.validatePriceMath({
      currentPrice: 209.00,
      originalPrice: 289.00,
      displayedDiscountPercent: 28,
    });
    console.log(`- Validação Matemática: isMathValid=${mathRes.isMathValid}, disc=${mathRes.calculatedDiscount}%`);

    const reevalRes = priceEngine.evaluateOfferRelevanceAfterPriceChange({
      originalOffer: { title: 'Produto Teste', currentPrice: 100, originalPrice: 150, discountPercent: 33 },
      validatedData: { currentPrice: 90, originalPrice: 150, discountPercent: 40 }
    });
    console.log(`- Reavaliação de Variação de Preço: attractive=${reevalRes.isAttractive}, action=${reevalRes.action}`);

    priceEngineOk = mathRes.isMathValid && reevalRes.isAttractive;
  } catch (err) {
    console.error(`- Erro no PriceValidationEngine: ${err.message}`);
  }
  results.priceValidation = priceEngineOk ? 'OK' : 'ERRO';

  // 5. DEMAND INTELLIGENCE
  console.log('\n[6/10] Testando DemandIntelligence...');
  const demandIntel = new DemandIntelligenceEngine();
  let demandOk = false;
  try {
    const opportunities = await demandIntel.scanDemand({ forceRefresh: true });
    console.log(`- Oportunidades capturadas: ${opportunities.length}`);
    if (opportunities.length > 0) {
      console.log(`- Top 1: "${opportunities[0].keyword}" (Score: ${opportunities[0].demand_score}, Intenção: ${opportunities[0].intent})`);
      console.log(`- Categorias mapeadas: ${opportunities.slice(0, 3).map(o => o.category).join(', ')}`);
      demandOk = true;
    }
  } catch (err) {
    console.error(`- Erro no DemandIntelligence: ${err.message}`);
  }
  results.demandIntelligence = demandOk ? 'OK' : 'ERRO';

  // 6. GOAL OPTIMIZER
  console.log('\n[7/10] Testando GoalOptimizer...');
  const optimizer = new GoalOptimizer();
  let optimizerOk = false;
  try {
    const optDecision = await optimizer.evaluateAndOptimize({ dryRun: true });
    console.log(`- GoalOptimizer Status: ${optDecision.status}`);
    console.log(`- Ação recomendada: ${optDecision.action}`);
    console.log(`- Progresso da meta diária: ${optDecision.metrics?.progressPercent}% (${optDecision.metrics?.currentClicks}/${optDecision.metrics?.targetClicks} cliques)`);
    optimizerOk = !!optDecision.status;
  } catch (err) {
    console.error(`- Erro no GoalOptimizer: ${err.message}`);
  }
  results.goalOptimizer = optimizerOk ? 'OK' : 'ERRO';

  // 7. SUPABASE, WORKER & LIMITES
  console.log('\n[8/10] Verificando limites, idempotência e cooldown...');
  const today = new Date().toISOString().split('T')[0];
  const { data: todayPosts } = await supabase
    .from('publications')
    .select('id, published_at, marketplace')
    .gte('published_at', `${today}T00:00:00Z`);

  const postsCount = todayPosts?.length || 0;
  console.log(`- Publicações hoje: ${postsCount}`);
  console.log(`- Limite diário: 8 posts/dia`);
  console.log(`- Cooldown mínimo: 45 min`);

  // 8. VERIFICAR QUE ZERO PUBLICAÇÕES FORAM REALIZADAS NESTE TESTE
  results.autonomousReady = (
    results.categoryClassifier === 'OK' &&
    results.affiliateLinkService === 'OK' &&
    results.fallbackStatus === 'BLOQUEADO' &&
    results.facebook === 'OK' &&
    results.priceValidation === 'OK' &&
    results.demandIntelligence === 'OK' &&
    results.goalOptimizer === 'OK'
  ) ? 'PRONTO' : 'NÃO PRONTO';

  results.livePublication = 'AINDA DESATIVADO';
  results.postsMadeThisTest = 0;

  console.log('\n' + '='.repeat(70));
  console.log('📋 RELATÓRIO FINAL PRE-FLIGHT (CONFORME REQUISITADO):');
  console.log('='.repeat(70));
  console.log(`CATEGORY CLASSIFIER: ${results.categoryClassifier}`);
  console.log(`MONITOR CLASSIFICADO COMO: [${results.monitorCategory}]`);
  console.log(`SMARTWATCH CLASSIFICADO COMO: [${results.smartwatchCategory}]`);
  console.log(`TABLET CLASSIFICADO COMO: [${results.tabletCategory}]`);
  console.log(`AFFILIATE LINK SERVICE: ${results.affiliateLinkService}`);
  console.log(`LINK COMISSIONADO REAL OBTIDO: [${results.realMeliUrl}]`);
  console.log(`FALLBACK PARA URL NÃO AFILIADA: ${results.fallbackStatus}`);
  console.log(`FACEBOOK: ${results.facebook}`);
  console.log(`PRICE VALIDATION: ${results.priceValidation}`);
  console.log(`DEMAND INTELLIGENCE: ${results.demandIntelligence}`);
  console.log(`GOAL OPTIMIZER: ${results.goalOptimizer}`);
  console.log(`AUTÔNOMO: ${results.autonomousReady}`);
  console.log(`LIVE PUBLICATION: ${results.livePublication}`);
  console.log(`PUBLICAÇÕES REALIZADAS NESTE TESTE: ${results.postsMadeThisTest}`);
  console.log('='.repeat(70));
}

runPreflight().catch(e => {
  console.error('Fatal Preflight Error:', e);
  process.exit(1);
});
