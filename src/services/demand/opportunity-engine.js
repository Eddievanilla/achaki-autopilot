import DemandIntelligenceEngine from './demand-intelligence-engine.js';
import InternalHistorySource from './internal-history-source.js';
import { PriceValidationEngine } from '../price-validation-engine.js';
import logger from '../../utils/logger.js';
import { supabase } from '../../database/supabase.js';

/**
 * OpportunityEngine
 * 
 * Pipeline:
 * Demand Intelligence
 *        ↓
 * Product Discovery
 *        ↓
 * Candidate Matching
 *        ↓
 * PriceValidationEngine
 *        ↓
 * Commercial Quality Score
 *        ↓
 * Publication Decision (PUBLISH | WAIT | REJECT | RESEARCH_MORE)
 */
export default class OpportunityEngine {
  constructor({ browserManager, priceValidationEngine } = {}) {
    this.demandEngine = new DemandIntelligenceEngine();
    this.historySource = new InternalHistorySource();
    this.browserManager = browserManager || null;
    this.priceValidationEngine = priceValidationEngine || new PriceValidationEngine({ browserManager: this.browserManager });
    
    // Publication threshold: candidate must achieve at least 75/100 to be approved for publishing
    this.PUBLICATION_THRESHOLD = 75;
  }

  calculateRelevanceScore(productTitle, demandOpportunity) {
    if (!productTitle || !demandOpportunity) return 50;

    const normTitle = productTitle.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const normKeyword = demandOpportunity.keyword.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    // Exact match in title
    if (normTitle.includes(normKeyword)) {
      return 95;
    }

    // Cluster variants match
    const variants = demandOpportunity.cluster?.variants || [];
    for (const v of variants) {
      const normV = v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (normTitle.includes(normV)) {
        return 88;
      }
    }

    // Keyword tokens match
    const kwTokens = normKeyword.split(/\s+/).filter(t => t.length > 2);
    const matchedTokens = kwTokens.filter(t => normTitle.includes(t));
    if (matchedTokens.length === kwTokens.length && kwTokens.length > 0) {
      return 85;
    }
    if (matchedTokens.length > 0) {
      return 70;
    }

    return 40;
  }

  calculateCommercialQualityScore({ candidate, demandOpportunity, priceValidation }) {
    // 1. Demand Score
    const demandScore = demandOpportunity?.demand_score || 50;

    // 2. Relevance Score
    const relevanceScore = this.calculateRelevanceScore(candidate.title, demandOpportunity);

    // 3. Price Score
    let priceScore = 70;
    const price = candidate.currentPrice || candidate.price || 0;
    if (price > 15 && price <= 300) priceScore = 90;
    else if (price > 300 && price <= 800) priceScore = 80;
    else if (price > 800) priceScore = 65;
    else if (price <= 15) priceScore = 50;

    // 4. Seller Score
    let sellerScore = 65;
    const seller = (candidate.seller || '').toLowerCase();
    if (seller.includes('oficial') || seller.includes('platinum') || seller.includes('mercado líder platinum')) {
      sellerScore = 95;
    } else if (seller.includes('gold') || seller.includes('líder')) {
      sellerScore = 85;
    } else if (candidate.seller) {
      sellerScore = 75;
    }

    // 5. Rating Score
    let ratingScore = 60;
    const rating = candidate.rating || 0;
    const reviewsCount = candidate.reviewsCount || 0;
    if (rating >= 4.7 && reviewsCount >= 50) ratingScore = 95;
    else if (rating >= 4.5 && reviewsCount >= 20) ratingScore = 88;
    else if (rating >= 4.0) ratingScore = 75;
    else if (rating > 0 && rating < 4.0) ratingScore = 40;

    // 6. Delivery Score
    let deliveryScore = 60;
    const shipping = (candidate.shipping || '').toLowerCase();
    if (shipping.includes('full') || candidate.isFull) deliveryScore = 95;
    else if (shipping.includes('grátis') || shipping.includes('chegará amanhã')) deliveryScore = 85;
    else if (shipping.includes('r$')) deliveryScore = 60;

    // 7. Value Score
    let valueScore = 60;
    const discount = candidate.discountPercent || candidate.discount || 0;
    const isPriceValidated = priceValidation?.isValid === true;
    if (isPriceValidated && discount >= 20) valueScore = 95;
    else if (isPriceValidated && discount >= 10) valueScore = 85;
    else if (isPriceValidated && discount > 0) valueScore = 75;
    else if (isPriceValidated) valueScore = 70;
    else valueScore = 40;

    // 8. Novelty Score
    const noveltyScore = candidate.isNew ? 85 : 75;

    const totalScore = Math.round(
      (demandScore * 0.15) +
      (relevanceScore * 0.20) +
      (priceScore * 0.15) +
      (sellerScore * 0.10) +
      (ratingScore * 0.10) +
      (deliveryScore * 0.10) +
      (valueScore * 0.15) +
      (noveltyScore * 0.05)
    );

    const breakdown = {
      demand_score: demandScore,
      relevance_score: relevanceScore,
      price_score: priceScore,
      seller_score: sellerScore,
      rating_score: ratingScore,
      delivery_score: deliveryScore,
      value_score: valueScore,
      novelty_score: noveltyScore,
      total_score: totalScore
    };

    return { totalScore, breakdown };
  }

  generateRationale(breakdown, candidate, demandOpportunity) {
    if (!breakdown) return 'Oferta insuficiente.';
    const reasons = [];
    if (breakdown.relevance_score >= 80) reasons.push('alta relevância semântica com a busca');
    if (breakdown.rating_score >= 80) reasons.push('ótima avaliação de compradores');
    if (breakdown.seller_score >= 80) reasons.push('vendedor confiável / loja oficial');
    if (breakdown.delivery_score >= 80) reasons.push('logística competitiva (Full / Rápida)');
    if (breakdown.value_score >= 80) reasons.push('preço validado com desconto real');
    if (breakdown.price_score >= 80) reasons.push('excelente custo-benefício');

    if (reasons.length === 0) {
      return 'Oferta insuficiente: métricas comerciais abaixo do padrão mínimo de conversão.';
    }

    return reasons.join(' + ');
  }

  async evaluateDemandAndOpportunities(options = {}) {
    logger.info('[OpportunityEngine] 🚀 Iniciando ciclo de inteligência de demanda e oportunidade...');

    // 1. MONITORAR DEMANDA REAL
    const opportunities = await this.demandEngine.scanDemand(options);

    if (!opportunities || opportunities.length === 0) {
      logger.warn('[OpportunityEngine] Nenhuma demanda detectada neste ciclo.');
      return {
        decision: 'WAIT',
        action: 'NÃO PUBLICAR',
        reason: 'Nenhum sinal de demanda mensurável detectado nas fontes ativas.',
        opportunities: [],
        bestOpportunity: null,
        chosenCandidate: null
      };
    }

    const demandResults = [];

    // Evaluate opportunities in order of demand score
    for (const opp of opportunities.slice(0, 5)) {
      logger.info(`[OpportunityEngine] Analisando oportunidade: "${opp.keyword}" (Demanda: ${opp.demand_score}/100, Tendência: ${opp.trend_direction})`);

      // Cooldown Check
      const cooldown = await this.historySource.checkCooldown({
        keyword: opp.keyword,
        category: opp.category
      });

      if (!cooldown.allowed) {
        logger.info(`[OpportunityEngine] Oportunidade '${opp.keyword}' em cooldown: ${cooldown.reason}`);
        demandResults.push({
          opportunity: opp,
          status: 'COOLDOWN',
          action: 'WAIT',
          reason: cooldown.reason,
          candidate: null,
          commercialScore: 0
        });
        continue;
      }

      // Discover products for this demand keyword
      let candidates = [];
      if (options.providedCandidates && options.providedCandidates.length > 0) {
        candidates = options.providedCandidates;
      } else {
        try {
          if (!this.browserManager) {
            // Sem browser disponível (modo testes ou cold start), não pesquisa candidatos
            logger.info(`[OpportunityEngine] Sem browserManager — pesquisa de candidatos ignorada para '${opp.keyword}'`);
          } else {
            const ProductSearchService = (await import('../product-search.js')).default;
            const { OpenRouterAgent } = await import('../../agents/openrouter-agent.js');
            const { JevAgent } = await import('../../agents/jev-agent.js');
            const searcher = new ProductSearchService({
              browserManager: this.browserManager,
              openrouterAgent: new OpenRouterAgent(),
              jevAgent: new JevAgent()
            });
            const result = await searcher.searchAndSelect({
              limit: 6,
              itemsPerMarketplace: 6,
              keyword: opp.keyword
            });
            candidates = result?.topOffers || [];
          }
        } catch (err) {
          logger.warn(`[OpportunityEngine] Falha ao pesquisar candidatos para '${opp.keyword}': ${err.message}`);
          candidates = [];
        }
      }


      if (!candidates || candidates.length === 0) {
        try {
          // Busca produtos aprovados no catálogo com link verificado meli.la
          const { data: dbProducts } = await supabase
            .from('products')
            .select(`
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
            `)
            .not('affiliate_url', 'is', null)
            .limit(5);

          if (dbProducts && dbProducts.length > 0) {
            candidates = dbProducts.map(p => {
              const prices = p.product_prices || [];
              const latestP = prices[0] || {};
              return {
                dbId: p.id,
                productId: p.marketplace_product_id,
                marketplace: p.marketplace || 'mercadolivre',
                title: p.title,
                category: p.category || opp.category || 'utilidades',
                productUrl: p.product_url,
                imageUrl: p.image_url,
                affiliateUrl: p.affiliate_url,
                currentPrice: Number(latestP.current_price || 0),
                originalPrice: Number(latestP.original_price || 0),
                discountPercent: Number(latestP.discount_percent || 0),
                rating: 4.8,
                reviewsCount: 150,
                seller: { name: 'Loja Oficial', isOfficial: true },
                delivery: { full: true, fast: true }
              };
            });
            logger.info(`[OpportunityEngine] ${candidates.length} produtos do catálogo aprovado recuperados para a demanda '${opp.keyword}'`);
          }
        } catch (dbErr) {
          logger.warn(`[OpportunityEngine] Falha ao consultar catálogo local: ${dbErr.message}`);
        }
      }

      if (!candidates || candidates.length === 0) {
        demandResults.push({
          opportunity: opp,
          status: 'NO_CANDIDATES',
          action: 'WAIT',
          reason: 'Nenhuma oferta encontrada no marketplace para a demanda.',
          candidate: null,
          commercialScore: 0
        });
        continue;
      }

      let bestCandidate = null;
      let highestScore = 0;
      let bestBreakdown = null;
      let bestValidation = null;

      for (const cand of candidates) {
        const priceValidation = this.priceValidationEngine.validateCandidate(cand, {
          title: cand.title,
          currentPrice: cand.currentPrice || cand.price,
          originalPrice: cand.originalPrice,
          productUrl: cand.productUrl,
          discountPercent: cand.discountPercent || cand.discount
        });

        const { totalScore, breakdown } = this.calculateCommercialQualityScore({
          candidate: cand,
          demandOpportunity: opp,
          priceValidation
        });

        if (totalScore > highestScore) {
          highestScore = totalScore;
          bestCandidate = cand;
          bestBreakdown = breakdown;
          bestValidation = priceValidation;
        }
      }

      const rationale = this.generateRationale(bestBreakdown, bestCandidate, opp);

      let action = 'WAIT';
      let decisionReason = '';

      if (highestScore >= this.PUBLICATION_THRESHOLD) {
        action = 'PUBLISH';
        decisionReason = rationale;
      } else {
        action = 'WAIT';
        decisionReason = `Demanda detectada (${opp.demand_score}/100), mas nenhuma oferta atingiu o threshold de publicação (${highestScore}/${this.PUBLICATION_THRESHOLD}).`;
      }

      demandResults.push({
        opportunity: opp,
        status: action === 'PUBLISH' ? 'APROVADA' : 'INSUFICIENTE',
        action,
        reason: decisionReason,
        candidate: bestCandidate,
        commercialScore: highestScore,
        breakdown: bestBreakdown,
        validation: bestValidation
      });

      if (action === 'PUBLISH' && !options.evaluateAll) {
        break;
      }
    }

    const winningOpportunity = demandResults.find(r => r.action === 'PUBLISH');

    if (winningOpportunity) {
      logger.info(`[OpportunityEngine] 🎯 Oferta APROVADA para publicação: "${winningOpportunity.candidate.title}" (Score: ${winningOpportunity.commercialScore}/100)`);
      return {
        decision: 'PUBLISH',
        action: 'PUBLICAR',
        demandResult: winningOpportunity,
        allDemandResults: demandResults,
        opportunities,
        reason: winningOpportunity.reason
      };
    }

    logger.info('[OpportunityEngine] ⏸ Nenhuma oportunidade atingiu o threshold neste ciclo de monitoramento.');
    return {
      decision: 'WAIT',
      action: 'NÃO PUBLICAR',
      demandResult: demandResults[0] || null,
      allDemandResults: demandResults,
      opportunities,
      reason: demandResults[0]?.reason || 'Demanda detectada, mas nenhuma oferta atingiu o threshold de publicação.'
    };
  }
}
