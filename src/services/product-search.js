/**
 * ACHAki Autopilot — ProductSearchService (Fase 4.1 API-First)
 *
 * Consome a camada ProviderManager para coletar ofertas de múltiplos marketplaces.
 * Executa normalização unificada, filtro determinístico estrito, deduplicação
 * e scoring/seleção das 5 melhores ofertas através do OpenRouterAgent.
 *
 * Validações registradas:
 *  - INVALID_PRODUCT_URL
 *  - INVALID_PRICE
 *  - INVALID_TITLE
 *  - DUPLICATE
 */

import ProviderManager from './provider-manager.js';
import ProductRepository from '../database/product-repository.js';
import OfferIntelligenceService from './offer-intelligence.js';
import OrganicStrategyEngine from './organic-strategy.js';
import GoalOptimizer from '../agents/goal-optimizer.js';
import JevAgent from '../agents/jev-agent.js';
import { ML_CATEGORIES } from '../marketplaces/mercadolivre.js';
import { SHOPEE_CATEGORIES } from '../marketplaces/shopee.js';
import logger from '../utils/logger.js';

export class ProductSearchService {
  /**
   * @param {object} params
   * @param {import('../browser/browser.js').default} params.browserManager
   * @param {import('../agents/openrouter-agent.js').default} params.openrouterAgent
   * @param {import('../agents/jev-agent.js').default} [params.jevAgent]
   */
  constructor({ browserManager, openrouterAgent, jevAgent }) {
    this.browserManager = browserManager;
    this.openrouterAgent = openrouterAgent;
    this.jevAgent = jevAgent || new JevAgent();
    this.providerManager = new ProviderManager({ browserManager });
    this.productRepository = new ProductRepository();
    this.intelligenceService = new OfferIntelligenceService();
    this.organicStrategyEngine = new OrganicStrategyEngine();
    this.goalOptimizer = new GoalOptimizer();
  }

  /**
   * Remove acentos e caracteres especiais para comparação de strings.
   * @param {string} text
   * @returns {string}
   */
  _normalizeText(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Valida se a URL é específica e real de um produto.
   * Rejeita homepage, buscas, categorias e links genéricos.
   *
   * @param {string} url
   * @param {string} marketplace
   * @returns {boolean}
   */
  _isValidSpecificProductUrl(url, marketplace) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return false;
    try {
      const u = new URL(url);
      const path = u.pathname.trim();

      // Rejeita homepage pura
      if (!path || path === '/' || path === '') return false;

      // Rejeita páginas de busca ou listagem
      if (
        path.includes('/search') ||
        path.includes('/busca') ||
        path.includes('/lista') ||
        u.hostname.includes('lista.mercadolivre')
      ) {
        return false;
      }

      // Validação por marketplace
      if (marketplace === 'mercadolivre') {
        const hasMLPattern =
          /\/p\/MLB/i.test(path) ||
          /\/up\/MLB/i.test(path) ||
          /MLB-?\d+/i.test(url) ||
          u.hostname.includes('produto.mercadolivre.com.br');
        return hasMLPattern;
      }

      if (marketplace === 'shopee') {
        return /-i\.\d+\.\d+/.test(path) || (path.split('/').length >= 2 && path.length > 15);
      }

      if (marketplace === 'amazon') {
        return /\/dp\/[A-Z0-9]{10}/i.test(path) || /\/gp\/product\/[A-Z0-9]{10}/i.test(path);
      }

      if (marketplace === 'aliexpress') {
        return /\/item\/\d+\.html/i.test(path);
      }

      return path.length > 5;
    } catch {
      return false;
    }
  }

  /**
   * Filtro determinístico local estrito.
   * Registra com precisão as categorias de rejeição:
   *  - INVALID_TITLE
   *  - INVALID_PRICE
   *  - INVALID_PRODUCT_URL
   *  - DUPLICATE
   *
   * @param {Array<object>} rawProducts
   * @returns {{ filtered: Array<object>, stats: object }}
   */
  filterAndDeduplicate(rawProducts) {
    const seenIds = new Set();
    const seenTitles = new Set();
    const validCandidates = [];

    const stats = {
      totalRaw: rawProducts.length,
      invalidTitle: 0,
      invalidPrice: 0,
      invalidProductUrl: 0,
      duplicate: 0,
      totalRemoved: 0,
      afterFilter: 0,
    };

    for (const item of rawProducts) {
      if (!item || typeof item !== 'object') {
        stats.invalidTitle++;
        continue;
      }

      // 1. Validação de Título
      if (!item.title || item.title.trim().length < 5) {
        logger.warn(`[Filter] Rejeitado [INVALID_TITLE]: "${item.title || ''}"`);
        stats.invalidTitle++;
        continue;
      }

      // 2. Validação de Preço
      if (!item.currentPrice || typeof item.currentPrice !== 'number' || item.currentPrice <= 0) {
        logger.warn(`[Filter] Rejeitado [INVALID_PRICE]: "${item.title.slice(0, 30)}" (${item.currentPrice})`);
        stats.invalidPrice++;
        continue;
      }

      // 3. Validação de URL específica do produto
      if (!this._isValidSpecificProductUrl(item.productUrl, item.marketplace)) {
        logger.warn(
          `[Filter] Rejeitado [INVALID_PRODUCT_URL]: "${item.title.slice(0, 30)}" -> ${item.productUrl}`
        );
        stats.invalidProductUrl++;
        continue;
      }

      // 4. Deduplicação por ProductId
      if (item.productId) {
        if (seenIds.has(item.productId)) {
          logger.debug(`[Filter] Rejeitado [DUPLICATE] por ID: ${item.productId}`);
          stats.duplicate++;
          continue;
        }
        seenIds.add(item.productId);
      }

      // 5. Deduplicação por similaridade de título (primeiras 5 palavras normalizadas)
      const normTitle = this._normalizeText(item.title);
      const titleKey = normTitle.split(' ').slice(0, 5).join(' ');
      if (titleKey.length > 8 && seenTitles.has(titleKey)) {
        logger.debug(`[Filter] Rejeitado [DUPLICATE] por título: "${titleKey}"`);
        stats.duplicate++;
        continue;
      }
      seenTitles.add(titleKey);

      // 6. Cálculo determinístico de desconto
      if (!item.discountPercent && item.originalPrice && item.originalPrice > item.currentPrice) {
        item.discountPercent = Math.round(
          ((item.originalPrice - item.currentPrice) / item.originalPrice) * 100
        );
      }

      validCandidates.push(item);
    }

    stats.totalRemoved =
      stats.invalidTitle + stats.invalidPrice + stats.invalidProductUrl + stats.duplicate;
    stats.afterFilter = validCandidates.length;

    return { filtered: validCandidates, stats };
  }

  /**
   * Prepara o payload enxuto e seguro para envio ao OpenRouter.
   * NUNCA envia dados sensíveis (cookies, tokens, headers).
   *
   * @param {Array<object>} products
   * @returns {Array<object>}
   */
  _prepareForLLM(products) {
    return products.map((p) => ({
      id: p.productId,
      name: p.title,
      marketplace: p.marketplace,
      category: p.category,
      price: p.currentPrice,
      originalPrice: p.originalPrice || undefined,
      discountPercent: p.discountPercent || undefined,
      rating: p.rating || undefined,
      reviewCount: p.reviewCount || undefined,
      sales: p.soldCount || undefined,
      shipping: p.shipping || undefined,
      source: p.source || undefined,
    }));
  }

  /**
   * Executa a pesquisa multicanal através do ProviderManager,
   * normaliza, filtra e seleciona as melhores ofertas com o OpenRouterAgent.
   *
   * @param {object} options
   * @param {number} [options.limit=5]
   * @param {number} [options.itemsPerMarketplace=10]
   * @returns {Promise<{
   *   topOffers: Array<object>,
   *   stats: object,
   *   providerStatuses: object
   * }>}
   */
  async searchAndSelect({ limit = 5, itemsPerMarketplace = 10 } = {}) {
    logger.info('[ProductSearch] Iniciando ciclo de pesquisa via ProviderManager (API-First)...');
    const cycleStartTime = Date.now();
    let runId = null;

    try {
      runId = await this.productRepository.recordAutomationRunStart('Pesquisando ofertas nos marketplaces...');
      await this.productRepository.recordAutomationEvent({
        runId,
        eventType: 'CYCLE_START',
        message: 'Ciclo de pesquisa iniciado nos marketplaces.',
        details: { itemsPerMarketplace, limit },
      });
      await this.productRepository.updateSystemState({
        status: 'TRABALHANDO',
        current_step: 'Pesquisando ofertas nos marketplaces...',
        started_at: new Date().toISOString(),
      });
      await this.productRepository.logActivity('Pesquisa iniciada');
    } catch {
      // Ignora falha não impeditiva
    }

    const providerStatuses = this.providerManager.getStatuses();
    const rawML = [];
    const rawShopee = [];

    // 1. Coleta Mercado Livre (via provider selecionado por ProviderManager)
    const mlCategoriesToSearch = [...ML_CATEGORIES.slice(0, 2)];
    for (const cat of mlCategoriesToSearch) {
      try {
        const items = await this.providerManager.searchMarketplace('mercadolivre', {
          category: cat.name,
          query: cat.query,
          searchQuery: cat.searchQuery,
          limit: itemsPerMarketplace,
        });
        rawML.push(...items);
      } catch (err) {
        logger.warn(`[ProductSearch] Falha ML (${cat.name}): ${err.message}`);
      }
    }

    // 2. Coleta Shopee (se provedor estiver ativo e não bloqueado)
    const shopeeCategoriesToSearch = [...SHOPEE_CATEGORIES.slice(0, 2)];
    for (const cat of shopeeCategoriesToSearch) {
      // Se provider foi marcado como TEMPORARILY_BLOCKED, não insiste
      const shopeeStatus = this.providerManager.providers.shopee.browser.getStatus();
      if (shopeeStatus === 'TEMPORARILY_BLOCKED') {
        break;
      }

      try {
        const items = await this.providerManager.searchMarketplace('shopee', {
          category: cat.name,
          query: cat.query,
          limit: itemsPerMarketplace,
        });
        rawShopee.push(...items);
      } catch (err) {
        logger.warn(`[ProductSearch] Falha Shopee (${cat.name}): ${err.message}`);
      }
    }

    // Atualiza status dos provedores após coleta
    const updatedStatuses = this.providerManager.getStatuses();

    // 3. Se a Shopee estiver temporariamente bloqueada ou sem API,
    // busca categoria adicional no Mercado Livre para garantir ampla base de candidatos
    if (updatedStatuses['Shopee Browser'] === 'TEMPORARILY_BLOCKED' && rawML.length < 25) {
      const extraCat = ML_CATEGORIES[2]; // ex: tecnologia / ferramentas
      if (extraCat) {
        try {
          logger.info(`[ProductSearch] Shopee bloqueada: coletando categoria extra no ML ("${extraCat.name}")...`);
          const extraItems = await this.providerManager.searchMarketplace('mercadolivre', {
            category: extraCat.name,
            query: extraCat.query,
            searchQuery: extraCat.searchQuery,
            limit: itemsPerMarketplace,
          });
          rawML.push(...extraItems);
        } catch (err) {
          logger.warn(`[ProductSearch] Falha ML categoria extra: ${err.message}`);
        }
      }
    }

    const allRaw = [...rawML, ...rawShopee];

    logger.info(
      `[ProductSearch] Coleta bruta: ML=${rawML.length}, Shopee=${rawShopee.length}, Total=${allRaw.length}`
    );

    // 4. Filtro determinístico & deduplicação local
    const { filtered, stats } = this.filterAndDeduplicate(allRaw);

    logger.info(
      `[ProductSearch] Após filtros locais: ${filtered.length} produtos válidos ` +
      `(rejeitados: total=${stats.totalRemoved}, url=${stats.invalidProductUrl}, preco=${stats.invalidPrice}, duplicados=${stats.duplicate})`
    );

    if (filtered.length === 0) {
      throw new Error('[ProductSearch] Nenhum produto válido disponível após filtros.');
    }

    // 5. Salvar/Atualizar produtos e registrar histórico de preços no Supabase (Memória Operacional)
    let memoryStats = {
      savedTotal: 0,
      newCount: 0,
      updatedCount: 0,
      pricesRecorded: 0,
      pricesSkipped: 0,
      candidatesSaved: 0,
    };

    try {
      logger.info(`[ProductSearch] Sincronizando ${filtered.length} produtos válidos com Supabase...`);
      const syncResult = await this.productRepository.syncProductsBatch(filtered);
      memoryStats = { ...memoryStats, ...syncResult };
      logger.info(
        `[ProductSearch] Memória Supabase: Novos=${syncResult.newCount}, Atualizados=${syncResult.updatedCount}, ` +
        `Preços=${syncResult.pricesRecorded}, Preços repetidos ignorados=${syncResult.pricesSkipped}`
      );
    } catch (dbErr) {
      logger.warn(`[ProductSearch] Falha não impeditiva no Supabase ao sincronizar produtos: ${dbErr.message}`);
    }

    // 6. Consultar métricas históricas no Supabase e enriquecer produtos
    const dbIds = filtered.map((p) => p.dbId).filter(Boolean);
    let historyMap = new Map();
    try {
      historyMap = await this.productRepository.getHistoryMetricsBatch(dbIds);
    } catch (histErr) {
      logger.warn(`[ProductSearch] Falha não impeditiva ao consultar métricas históricas: ${histErr.message}`);
    }

    // 7. Enriquecimento e cálculo de LOCAL_SCORE determinístico
    const enriched = this.intelligenceService.enrichProductsWithHistory(filtered, historyMap);
    const evaluated = this.intelligenceService.evaluateProducts(enriched);

    // Contadores para auditoria
    const repeatedPenalties = evaluated.filter((p) => p.isRepeatedPenalty).length;
    const suspiciousDiscounts = evaluated.filter((p) => p.isSuspiciousDiscount).length;
    const confidenceCounts = {
      LOW: evaluated.filter((p) => p.historyConfidence === 'LOW').length,
      MEDIUM: evaluated.filter((p) => p.historyConfidence === 'MEDIUM').length,
      HIGH: evaluated.filter((p) => p.historyConfidence === 'HIGH').length,
    };

    // 8. Pré-seleção balanceada de até 15 candidatos para economia de tokens
    const preSelected = this.intelligenceService.preSelectForAI(evaluated, 15);
    const compactPayload = this.intelligenceService.prepareAIPayload(preSelected);

    logger.info(
      `[ProductSearch] Motor Inteligente: ${evaluated.length} avaliados, ` +
      `${preSelected.length} pré-selecionados para o pipeline de IA. ` +
      `(Penalizados: repetidos=${repeatedPenalties}, descontos_suspeitos=${suspiciousDiscounts})`
    );

    // 9. Camada de Cache no Supabase: verificar decisões recentes para os 15 candidatos
    let cachedMap = new Map();
    try {
      cachedMap = await this.productRepository.getCachedDecisionsBatch(preSelected, 24);
      if (cachedMap.size > 0) {
        logger.info(`[ProductSearch] Cache Supabase: ${cachedMap.size} decisões recentes reutilizadas.`);
      }
    } catch (cacheErr) {
      logger.warn(`[ProductSearch] Falha não impeditiva ao consultar cache Supabase: ${cacheErr.message}`);
    }

    const itemsForJev = preSelected.filter((p) => !cachedMap.has(p.productId));
    const itemsFromCache = preSelected.filter((p) => cachedMap.has(p.productId));

    // 10. Filtro Local Mais Forte: apenas candidatos verdadeiramente competitivos vão ao JEV
    // Itens com score fraco/penalizados não gastam tokens desnecessariamente
    const competitiveItemsForJev = itemsForJev.filter((p) => (p.localScore || 0) >= 65);
    const itemsToEvaluate = competitiveItemsForJev.length > 0
      ? competitiveItemsForJev.slice(0, 10)
      : itemsForJev.slice(0, 5);
    const nonCompetitiveItems = itemsForJev.filter((p) => !itemsToEvaluate.some((e) => e.productId === p.productId));

    let jevEvaluated = [];
    let jevTokens = { inputTokens: 0, outputTokens: 0, totalCalls: 0 };
    let jevStatus = 'OK';
    let jevFallbackTriggered = false;

    if (itemsToEvaluate.length > 0) {
      try {
        const jevResult = await this.jevAgent.evaluateCandidatesBatch(itemsToEvaluate);
        jevEvaluated = jevResult.evaluated;
        jevTokens = jevResult.tokensUsed;
        if (jevResult.failures === itemsToEvaluate.length && itemsToEvaluate.length > 0) {
          jevStatus = 'ERRO';
          jevFallbackTriggered = true;
          logger.warn('[ProductSearch] JEV indisponível para todos os itens. Acionando fallback regras locais.');
        }
      } catch (jevErr) {
        jevStatus = 'ERRO';
        jevFallbackTriggered = true;
        logger.warn(`[ProductSearch] Falha no JevAgent: ${jevErr.message}. Acionando fallback.`);
      }
    }

    // 11. Montagem do conjunto unificado pré-escalonamento
    const unifiedCandidates = [];

    // Adiciona itens vindos do cache (0 tokens!)
    for (const item of itemsFromCache) {
      const cached = cachedMap.get(item.productId);
      unifiedCandidates.push({
        ...item,
        jevDecisionScore: cached.jevDecisionScore,
        jevQualityTier: cached.jevQualityTier,
        jevIsAchadinho: cached.jevIsAchadinho,
        jevRiskLevel: cached.jevRiskLevel,
        jevNeedsEscalation: cached.jevNeedsEscalation ?? false,
        aiScore: cached.aiScore ?? item.localScore,
        reasons: cached.aiReason ?? 'Decisão estruturada reutilizada do cache operacional.',
        risks: cached.aiRisk ?? 'Nenhum risco relevante identificado.',
        modelUsed: cached.modelUsed || 'cached',
        fromCache: true,
      });
    }

    // Adiciona itens avaliados pelo JEV
    for (const item of jevEvaluated) {
      unifiedCandidates.push(item);
    }

    // Adiciona itens que não precisaram de avaliação do JEV por score local
    for (const item of nonCompetitiveItems) {
      unifiedCandidates.push({
        ...item,
        jevDecisionScore: item.localScore,
        jevQualityTier: 'solid',
        jevIsAchadinho: 0.6,
        jevRiskLevel: 'low',
        jevNeedsEscalation: false,
        aiScore: item.localScore,
        reasons: 'Classificado localmente com base em histórico e preço determinístico.',
        risks: 'Nenhum risco crítico.',
        modelUsed: 'local_filter',
        fromCache: false,
      });
    }

    // 12. Camada de Escalonamento GPT-4o-mini (estritamente por exceção)
    let gptItems = [];
    let gptTokens = 0;
    let gptCalls = 0;
    let gptFallbackTriggered = false;

    if (jevFallbackTriggered) {
      // Fallback: se JEV estiver completamente indisponível, seleciona os top 5 para GPT
      gptItems = preSelected.slice(0, 5);
      logger.info(`[ProductSearch] [FALLBACK] JEV indisponível: enviando ${gptItems.length} candidatos ao GPT-4o-mini.`);
    } else {
      // Escalonamento estrito: somente itens com ambiguidade real, máximo de 3 itens
      const needingEscalation = unifiedCandidates.filter((c) => c.jevNeedsEscalation && !c.fromCache);
      gptItems = needingEscalation.slice(0, 3);
      if (gptItems.length > 0) {
        logger.info(`[ProductSearch] [ESCALATION] ${gptItems.length} candidatos com ambiguidade encaminhados ao GPT-4o-mini.`);
      } else {
        logger.info('[ProductSearch] [FAST-PATH] Decisão JEV e regras determinísticas claras: zero chamadas GPT.');
      }
    }

    const gptUpdates = new Map();
    if (gptItems.length > 0) {
      try {
        const escalationPayload = this.intelligenceService.prepareAIPayload(gptItems);
        const gptRes = await this.openrouterAgent.selectBestOffers(escalationPayload, limit);
        gptCalls++;
        gptTokens = gptRes.usage?.total_tokens || 0;

        const scores = gptRes.scores || {};
        const reasoning = gptRes.reasoning || {};
        const risks = gptRes.risks || {};

        for (const item of gptItems) {
          gptUpdates.set(item.productId, {
            aiScore: scores[item.productId] ?? item.aiScore ?? 85,
            reasons: reasoning[item.productId] ?? item.reasons,
            risks: risks[item.productId] ?? item.risks,
            modelUsed: 'openai/gpt-4o-mini',
          });
        }
      } catch (gptErr) {
        gptFallbackTriggered = true;
        logger.warn(`[ProductSearch] Falha no GPT-4o-mini: ${gptErr.message}. Mantendo decisões do JEV + regras locais.`);
      }
    }

    // 13. Combinação final de scores e persistência de cache
    const finalEvaluatedList = [];
    const candidatesToCache = [];

    for (const item of unifiedCandidates) {
      let aiScore = item.aiScore;
      let reasons = item.reasons;
      let risks = item.risks;
      let modelUsed = item.modelUsed;

      if (gptUpdates.has(item.productId)) {
        const update = gptUpdates.get(item.productId);
        aiScore = update.aiScore;
        reasons = update.reasons;
        risks = update.risks;
        modelUsed = update.modelUsed;
      }

      const localScore = item.localScore ?? 50;
      const finalScore = this.intelligenceService.calculateFinalScore(localScore, aiScore);

      const candidateObject = {
        ...item,
        score: finalScore,
        localScore,
        aiScore,
        finalScore,
        reasons,
        risks,
        modelUsed,
      };

      finalEvaluatedList.push(candidateObject);

      // Apenas produtos que não vieram do cache precisam ser gravados no Supabase
      if (!item.fromCache && item.dbId) {
        candidatesToCache.push(candidateObject);
      }
    }

    // Grava novas decisões na tabela ai_decision_cache do Supabase
    if (candidatesToCache.length > 0) {
      try {
        await this.productRepository.saveDecisionCacheBatch(candidatesToCache);
      } catch (saveErr) {
        logger.warn(`[ProductSearch] Falha não impeditiva ao atualizar cache no Supabase: ${saveErr.message}`);
      }
    }

    // 14. Aplicação de regra de DIVERSIDADE no TOP 5 (máximo 2 por categoria)
    // Ordena pelo maior finalScore
    const rankedCandidates = [...finalEvaluatedList].sort((a, b) => b.finalScore - a.finalScore);
    const topOffersRaw = this.intelligenceService.enforceDiversity(rankedCandidates, preSelected, limit, 2);

    // 15. Atribuir Estratégia Orgânica para cada oferta selecionada
    const topOffers = topOffersRaw.map((item) => {
      const strategy = this.organicStrategyEngine.selectStrategyForProduct(item);
      return {
        ...item,
        strategy,
        recommendedStrategy: strategy.code,
      };
    });

    // 16. Salvar ofertas selecionadas em offer_candidates
    try {
      logger.info(`[ProductSearch] Registrando ${topOffers.length} ofertas selecionadas em offer_candidates...`);
      memoryStats.candidatesSaved = await this.productRepository.saveSelectedCandidates(topOffers);
      logger.info(`[ProductSearch] Candidatos registrados no Supabase: ${memoryStats.candidatesSaved}`);
    } catch (candErr) {
      logger.warn(`[ProductSearch] Falha não impeditiva ao registrar offer_candidates: ${candErr.message}`);
    }

    const topCategories = Array.from(new Set(topOffers.map((t) => t.category || 'outros')));
    const currentTokens = jevTokens.inputTokens + gptTokens;

    // 17. GoalOptimizer: Avaliar meta de cliques/dia, projeção e recomendação de rotação
    let optimizerPlan = null;
    try {
      optimizerPlan = await this.goalOptimizer.evaluateAndOptimize({
        topOffers,
        runStats: {
          found: filtered.length,
          selected: topOffers.length,
          tokens: currentTokens,
        },
      });

      if (optimizerPlan && runId) {
        await this.productRepository.recordOptimizerDecision({
          runId,
          productId: topOffers[0]?.dbId || null,
          decisionType: 'GOAL_STRATEGY_ROTATION',
          reason: optimizerPlan.reason,
          actionTaken: optimizerPlan.action,
          metricsContext: optimizerPlan.metrics,
        });

        await this.productRepository.recordAutomationEvent({
          runId,
          eventType: 'OPTIMIZER_DECISION',
          message: `GoalOptimizer: Projeção de ${optimizerPlan.metrics?.projectedTodayClicks ?? 0} cliques hoje. Decisão: ${optimizerPlan.action}`,
          details: optimizerPlan,
        });
      }
    } catch (optErr) {
      logger.warn(`[ProductSearch] Falha não impeditiva no GoalOptimizer: ${optErr.message}`);
    }

    // Cálculo de economia financeira estimada vs Fase 5 (baseline de 2.500 tokens GPT-4o-mini a $0.15/1M)
    const baselineGptCost = 2500 * (0.15 / 1000000);
    const currentJevCost = jevTokens.inputTokens * (0.042 / 1000000);
    const currentGptCost = gptTokens * (0.15 / 1000000);
    const currentTotalCost = currentJevCost + currentGptCost;

    let savingsPercent = 0;
    if (baselineGptCost > currentTotalCost) {
      savingsPercent = Math.round(((baselineGptCost - currentTotalCost) / baselineGptCost) * 100);
    }
    // Atualiza estado final do robô e registra conclusão no feed
    const durationSeconds = Math.max(1, Math.round((Date.now() - cycleStartTime) / 1000));
    const primaryStrategy = topOffers[0]?.strategy?.code || 'ACHADINHO';

    try {
      if (runId) {
        await this.productRepository.recordAutomationRunEnd(runId, {
          durationSeconds,
          itemsFound: filtered.length,
          itemsSelected: topOffers.length,
          strategyUsed: primaryStrategy,
        });

        await this.productRepository.recordAutomationEvent({
          runId,
          eventType: 'CYCLE_COMPLETED',
          message: `Ciclo concluído: ${topOffers.length} ofertas com estratégias orgânicas prontas para publicação.`,
          details: {
            topCategories,
            strategies: topOffers.map((o) => ({ title: o.title.slice(0, 35), strategy: o.strategy?.name })),
          },
        });
      }

      await this.productRepository.logActivity(`${filtered.length} produtos encontrados`);
      if (itemsFromCache.length > 0) {
        await this.productRepository.logActivity(`${itemsFromCache.length} decisões recuperadas do cache`);
      }
      await this.productRepository.logActivity(`${topOffers.length} ofertas selecionadas (${primaryStrategy})`);
      await this.productRepository.logActivity('Ciclo concluído');

      const mlStatus = updatedStatuses['Mercado Livre Browser'] || updatedStatuses['Mercado Livre API'] || 'ATIVO';
      const shopeeStatus = updatedStatuses['Shopee Browser'] === 'TEMPORARILY_BLOCKED' ? 'BLOQUEADO' : 'NÃO CONFIGURADO';

      await this.productRepository.updateSystemState({
        status: 'ONLINE',
        current_step: 'Aguardando próximo ciclo de coleta...',
        started_at: null,
        last_run_at: new Date().toISOString(),
        last_duration_seconds: durationSeconds,
        next_run_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        today_products_found: filtered.length,
        today_offers_selected: topOffers.length,
        today_publications: 0,
        today_errors: 0,
        ai_cache_hits: itemsFromCache.length,
        ai_jev_calls: jevTokens.totalCalls,
        ai_gpt_calls: gptCalls,
        ai_tokens: currentTokens,
        ai_savings_percent: savingsPercent,
        autopilot_mode: 'ASSISTIDO',
        current_strategy: primaryStrategy,
        marketplaces: {
          mercadolivre: mlStatus,
          shopee: shopeeStatus,
          amazon: 'NÃO CONFIGURADO',
          aliexpress: 'NÃO CONFIGURADO',
        },
        social_networks: {
          facebook: 'NÃO CONFIGURADO',
          instagram: 'NÃO CONFIGURADO',
          tiktok: 'EM BREVE',
          youtube: 'EM BREVE',
          x: 'EM BREVE',
        },
      });
    } catch {
      // Ignora falha de auditoria
    }

    return {
      topOffers,
      providerStatuses: updatedStatuses,
      stats: {
        mlCollected: rawML.length,
        shopeeCollected: rawShopee.length,
        totalRaw: allRaw.length,
        invalidUrlsRemoved: stats.invalidProductUrl,
        invalidPricesRemoved: stats.invalidPrice,
        invalidTitlesRemoved: stats.invalidTitle,
        duplicatesRemoved: stats.duplicate,
        totalRemoved: stats.totalRemoved,
        afterFilter: filtered.length,
        memory: memoryStats,
        intelligence: {
          analyzed: evaluated.length,
          preSelected: preSelected.length,
          sentToAI: preSelected.length,
          selected: topOffers.length,
          topCategories,
          confidenceCounts,
          repeatedPenalties,
          suspiciousDiscounts,
          tokensUsed: currentTokens,
        },
        jev: {
          status: jevStatus,
          model: this.jevAgent.model,
          sentToJev: itemsToEvaluate.length,
          calls: jevTokens.totalCalls,
          tokens: jevTokens.inputTokens,
          cacheHits: itemsFromCache.length,
        },
        gpt: {
          sentToGpt: gptItems.length,
          calls: gptCalls,
          tokens: gptTokens,
          fallbackTriggered: jevFallbackTriggered || gptFallbackTriggered,
        },
        estimatedSavings: savingsPercent,
        optimizerPlan,
      },
    };
  }
}

export default ProductSearchService;
