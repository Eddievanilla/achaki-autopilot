/**
 * ACHAki Autopilot — OfferIntelligenceService (Fase 5)
 *
 * Motor Inteligente de Ofertas para avaliação quantitativa e histórica de produtos:
 *  - Cálculo de métricas históricas reais (média, menor/maior preço, desconto real vs anunciado)
 *  - Classificação de confiança de histórico: LOW / MEDIUM / HIGH
 *  - Cálculo determinístico de LOCAL_SCORE (0 a 100) com bônus e penalidades
 *  - Filtragem de descontos suspeitos e produtos repetidos
 *  - Pré-seleção balanceada de até 15 candidatos para economia de tokens
 *  - Garantia de diversidade no TOP 5 (máximo 2 por categoria quando disponível)
 *  - Composição do FINAL_SCORE (40% Local + 60% IA)
 */

import logger from '../utils/logger.js';

export class OfferIntelligenceService {
  /**
   * Enriquece os produtos em memória com as métricas históricas vindas do Supabase.
   *
   * @param {Array<object>} products
   * @param {Map<string, object>} historyMap - Mapa indexado pelo dbId
   * @returns {Array<object>} Produtos enriquecidos
   */
  enrichProductsWithHistory(products, historyMap) {
    return products.map((item) => {
      const hist = item.dbId && historyMap.has(item.dbId)
        ? historyMap.get(item.dbId)
        : null;

      const currentPrice = Number(item.currentPrice);
      const originalPrice = item.originalPrice ? Number(item.originalPrice) : null;
      const announcedDiscount = item.discountPercent || 0;

      const priceObservations = hist?.priceObservations || 1;
      const avgPrice = hist?.avgPrice ?? currentPrice;
      const minPrice = hist?.minPrice ?? currentPrice;
      const maxPrice = hist?.maxPrice ?? currentPrice;
      const lastKnownPrice = hist?.lastKnownPrice ?? currentPrice;
      const selectionFrequency = hist?.selectionFrequency || 0;
      const isPublished = hist?.isPublished || false;
      const historyConfidence = hist?.historyConfidence || 'LOW';

      // Desconto real comparado à média histórica registrada
      let realDiscountVsAvg = 0;
      if (avgPrice > 0 && currentPrice < avgPrice) {
        realDiscountVsAvg = Math.round(((avgPrice - currentPrice) / avgPrice) * 100);
      }

      return {
        ...item,
        currentPrice,
        originalPrice,
        announcedDiscount,
        priceObservations,
        avgPrice,
        minPrice,
        maxPrice,
        lastKnownPrice,
        realDiscountVsAvg,
        selectionFrequency,
        isPublished,
        historyConfidence,
      };
    });
  }

  /**
   * Calcula o LOCAL_SCORE determinístico de 0 a 100 com justificativas.
   *
   * @param {object} item
   * @returns {{
   *   score: number,
   *   penalties: string[],
   *   bonuses: string[],
   *   isSuspiciousDiscount: boolean,
   *   isRepeatedPenalty: boolean
   * }}
   */
  calculateLocalScore(item) {
    let score = 50;
    const bonuses = [];
    const penalties = [];
    let isSuspiciousDiscount = false;
    let isRepeatedPenalty = false;

    // 1. Vantagem de Preço
    if (item.historyConfidence !== 'LOW' && item.realDiscountVsAvg > 5) {
      const pts = Math.min(15, Math.round(item.realDiscountVsAvg * 0.5));
      score += pts;
      bonuses.push(`Desconto real de ${item.realDiscountVsAvg}% sobre média histórica (+${pts})`);
    } else if (item.announcedDiscount > 0) {
      const pts = Math.min(10, Math.round(item.announcedDiscount * 0.25));
      score += pts;
      bonuses.push(`Desconto anunciado de ${item.announcedDiscount}% (+${pts})`);
    }

    // 2. Potencial de Compra por Impulso (Preço acessível)
    if (item.currentPrice <= 50) {
      score += 7;
      bonuses.push('Preço abaixo de R$ 50 — forte apelo de impulso (+7)');
    } else if (item.currentPrice <= 100) {
      score += 4;
      bonuses.push('Preço abaixo de R$ 100 — boa acessibilidade (+4)');
    } else if (item.currentPrice > 400) {
      score -= 4;
      penalties.push('Preço alto (> R$ 400) — menor compra por impulso (-4)');
    }

    // 3. Avaliações e Popularidade
    if (item.rating && item.rating >= 4.5) {
      score += 8;
      bonuses.push(`Excelente avaliação: ${item.rating} estrelas (+8)`);
    } else if (item.rating && item.rating >= 4.0) {
      score += 5;
      bonuses.push(`Boa avaliação: ${item.rating} estrelas (+5)`);
    } else if (item.rating && item.rating < 3.8) {
      score -= 10;
      penalties.push(`Avaliação baixa: ${item.rating} estrelas (-10)`);
    }

    if (item.soldCount && item.soldCount > 200) {
      score += 8;
      bonuses.push(`Alta contagem de vendas: ${item.soldCount}+ (+8)`);
    } else if (item.soldCount && item.soldCount > 30) {
      score += 4;
      bonuses.push(`Vendas confirmadas: ${item.soldCount}+ (+4)`);
    }

    // 4. Completude dos Dados & Frete
    if (item.shipping && item.shipping.toLowerCase().includes('grátis')) {
      score += 5;
      bonuses.push('Frete Grátis (+5)');
    }
    if (item.sellerName) {
      score += 3;
      bonuses.push('Vendedor identificado (+3)');
    }

    // 5. Novidade para a ACHAki
    if (item.selectionFrequency === 0) {
      score += 5;
      bonuses.push('Produto inédito no banco de candidatos (+5)');
    }
    if (!item.isPublished) {
      score += 3;
      bonuses.push('Nunca publicado anteriormente (+3)');
    }

    // ─── PENALIDADES ──────────────────────────────────────────────────────────

    // A. Desconto aparentemente inflado / suspeito
    // Se o desconto anunciado é >= 60% e o preço original parece inflado (mais que o dobro da média ou sem histórico que suporte)
    if (item.announcedDiscount >= 60) {
      const isInflated = item.originalPrice && item.originalPrice > item.currentPrice * 2.5;
      if (isInflated || (item.historyConfidence !== 'LOW' && item.realDiscountVsAvg <= 5)) {
        score -= 15;
        isSuspiciousDiscount = true;
        penalties.push(`Desconto suspeito/inflado: anunciado ${item.announcedDiscount}% com preço original fora do padrão (-15)`);
      }
    }

    // B. Produto repetido frequentemente
    if (item.selectionFrequency >= 3) {
      score -= 15;
      isRepeatedPenalty = true;
      penalties.push(`Produto já selecionado ${item.selectionFrequency} vezes anteriormente (-15)`);
    } else if (item.selectionFrequency >= 1) {
      score -= 5;
      isRepeatedPenalty = true;
      penalties.push(`Produto já selecionado recentemente (${item.selectionFrequency}x) (-5)`);
    }

    // C. Produto já publicado
    if (item.isPublished) {
      score -= 20;
      isRepeatedPenalty = true;
      penalties.push('Produto já publicado anteriormente nas redes sociais (-20)');
    }

    // D. Poucos sinais de validação social
    if (!item.rating && !item.soldCount) {
      score -= 5;
      penalties.push('Poucos dados de reputação (sem rating ou contagem de vendas) (-5)');
    }

    // Clamping para [0, 100]
    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      score,
      bonuses,
      penalties,
      isSuspiciousDiscount,
      isRepeatedPenalty,
    };
  }

  /**
   * Avalia todos os produtos e anexa LOCAL_SCORE e sinais de risco.
   *
   * @param {Array<object>} products - Produtos já enriquecidos com histórico
   * @returns {Array<object>} Produtos com localScore
   */
  evaluateProducts(products) {
    return products.map((item) => {
      const evaluation = this.calculateLocalScore(item);
      return {
        ...item,
        localScore: evaluation.score,
        localBonuses: evaluation.bonuses,
        localPenalties: evaluation.penalties,
        isSuspiciousDiscount: evaluation.isSuspiciousDiscount,
        isRepeatedPenalty: evaluation.isRepeatedPenalty,
      };
    });
  }

  /**
   * Pré-seleciona localmente no máximo `maxCandidates` (padrão 15) para envio à LLM,
   * balanceando por score e evitando monopólio de uma única categoria.
   *
   * @param {Array<object>} evaluatedProducts
   * @param {number} [maxCandidates=15]
   * @returns {Array<object>} Candidatos selecionados para a IA
   */
  preSelectForAI(evaluatedProducts, maxCandidates = 15) {
    if (evaluatedProducts.length <= maxCandidates) {
      return [...evaluatedProducts].sort((a, b) => b.localScore - a.localScore);
    }

    // Agrupa por categoria
    const byCategory = new Map();
    for (const item of evaluatedProducts) {
      const cat = item.category || 'outros';
      if (!byCategory.has(cat)) {
        byCategory.set(cat, []);
      }
      byCategory.get(cat).push(item);
    }

    // Ordena itens dentro de cada categoria por localScore decrescente
    for (const [, list] of byCategory.entries()) {
      list.sort((a, b) => b.localScore - a.localScore);
    }

    const selected = [];
    const maxPerCatInitial = Math.ceil(maxCandidates / Math.max(1, byCategory.size));

    // Round-robin por categoria para garantir pluralidade de ofertas
    for (let i = 0; i < maxPerCatInitial; i++) {
      for (const [, list] of byCategory.entries()) {
        if (selected.length >= maxCandidates) break;
        if (list[i]) {
          selected.push(list[i]);
        }
      }
      if (selected.length >= maxCandidates) break;
    }

    // Se ainda sobrar vagas, preenche com os maiores scores restantes
    if (selected.length < maxCandidates) {
      const remaining = evaluatedProducts
        .filter((p) => !selected.some((s) => s.productId === p.productId))
        .sort((a, b) => b.localScore - a.localScore);

      for (const rem of remaining) {
        if (selected.length >= maxCandidates) break;
        selected.push(rem);
      }
    }

    return selected.sort((a, b) => b.localScore - a.localScore);
  }

  /**
   * Aplica regras de diversidade estrita para a composição do TOP N final:
   *  - Máximo 2 produtos da mesma categoria no TOP 5 (quando houver categorias suficientes).
   *  - Evita itens duplicados ou com nomes quase idênticos.
   *
   * @param {Array<object>} selectedOffers - Ofertas escolhidas pela IA
   * @param {Array<object>} allCandidates - Universo pré-selecionado para fallback
   * @param {number} [limit=5]
   * @param {number} [maxPerCategory=2]
   * @returns {Array<object>} Ofertas finais com diversidade garantida
   */
  enforceDiversity(selectedOffers, allCandidates, limit = 5, maxPerCategory = 2) {
    const finalSelection = [];
    const categoryCount = new Map();

    const canAdd = (item) => {
      const cat = item.category || 'outros';
      const current = categoryCount.get(cat) || 0;
      return current < maxPerCategory;
    };

    const add = (item) => {
      finalSelection.push(item);
      const cat = item.category || 'outros';
      categoryCount.set(cat, (categoryCount.get(cat) || 0) + 1);
    };

    // 1. Passa pelas escolhas da IA respeitando a cota por categoria
    for (const item of selectedOffers) {
      if (finalSelection.length >= limit) break;
      if (canAdd(item)) {
        add(item);
      }
    }

    // 2. Se não atingiu o limite, busca outros candidatos com categorias vagas
    if (finalSelection.length < limit) {
      for (const cand of allCandidates) {
        if (finalSelection.length >= limit) break;
        if (!finalSelection.some((f) => f.productId === cand.productId) && canAdd(cand)) {
          add(cand);
        }
      }
    }

    // 3. Fallback final: se ainda faltar vagas por escassez de categorias, aceita da mesma categoria
    if (finalSelection.length < limit) {
      for (const cand of selectedOffers.concat(allCandidates)) {
        if (finalSelection.length >= limit) break;
        if (!finalSelection.some((f) => f.productId === cand.productId)) {
          add(cand);
        }
      }
    }

    return finalSelection.slice(0, limit);
  }

  /**
   * Formata payload inteligente e enxuto para a IA (OpenRouter),
   * contendo métricas históricas, localScore, confiança e riscos observados.
   *
   * @param {Array<object>} candidates
   * @returns {Array<object>}
   */
  prepareAIPayload(candidates) {
    return candidates.map((c) => ({
      id: c.productId,
      title: c.title,
      marketplace: c.marketplace,
      category: c.category,
      currentPrice: c.currentPrice,
      announcedDiscount: c.announcedDiscount > 0 ? `${c.announcedDiscount}%` : undefined,
      historyConfidence: c.historyConfidence,
      historicalAvgPrice: c.priceObservations > 1 ? c.avgPrice : undefined,
      historicalMinPrice: c.priceObservations > 1 ? c.minPrice : undefined,
      realDiscountVsAvg: c.realDiscountVsAvg > 0 ? `${c.realDiscountVsAvg}%` : undefined,
      rating: c.rating || undefined,
      sales: c.soldCount || undefined,
      shipping: c.shipping || undefined,
      localScore: c.localScore,
      riskSignals: c.localPenalties.length > 0 ? c.localPenalties : undefined,
    }));
  }

  /**
   * Combina LOCAL_SCORE (40%) + AI_SCORE (60%) em um FINAL_SCORE balanceado.
   *
   * @param {object} item
   * @param {number} [aiScore=85]
   * @returns {number} Final score (0 a 100)
   */
  calculateFinalScore(localScore, aiScore) {
    const lScore = Number(localScore) || 50;
    const aScore = Number(aiScore) || 80;
    return Math.round(lScore * 0.4 + aScore * 0.6);
  }
}

export default OfferIntelligenceService;
