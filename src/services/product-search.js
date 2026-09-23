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
import { ML_CATEGORIES } from '../marketplaces/mercadolivre.js';
import { SHOPEE_CATEGORIES } from '../marketplaces/shopee.js';
import logger from '../utils/logger.js';

export class ProductSearchService {
  /**
   * @param {object} params
   * @param {import('../browser/browser.js').default} params.browserManager
   * @param {import('../agents/openrouter-agent.js').default} params.openrouterAgent
   */
  constructor({ browserManager, openrouterAgent }) {
    this.browserManager = browserManager;
    this.openrouterAgent = openrouterAgent;
    this.providerManager = new ProviderManager({ browserManager });
    this.productRepository = new ProductRepository();
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

    // 6. Ordena preliminarmente para priorizar os candidatos mais atrativos (desconto/avaliação)
    const sortedForLLM = [...filtered].sort((a, b) => {
      const discountA = a.discountPercent || 0;
      const discountB = b.discountPercent || 0;
      return discountB - discountA;
    });

    const llmCandidates = sortedForLLM.slice(0, 20);
    const compactPayload = this._prepareForLLM(llmCandidates);

    logger.info(`[ProductSearch] Enviando ${compactPayload.length} candidatos ao OpenRouter...`);

    // 7. Curadoria inteligente via OpenRouterAgent
    const llmResponse = await this.openrouterAgent.selectBestOffers(compactPayload, limit);

    const selectedIds = Array.isArray(llmResponse.selected) ? llmResponse.selected : [];
    const reasoning = llmResponse.reasoning || {};
    const scores = llmResponse.scores || {};
    const risks = llmResponse.risks || {};

    logger.info(`[ProductSearch] OpenRouter selecionou ${selectedIds.length} produtos.`);

    // 8. Monta os Top selecionados com dados completos
    const productMap = new Map(filtered.map((p) => [p.productId, p]));
    const topOffers = [];

    for (const id of selectedIds) {
      const prod = productMap.get(id);
      if (prod && topOffers.length < limit) {
        topOffers.push({
          ...prod,
          score: scores[id] ?? 85,
          reasons: reasoning[id] ?? 'Produto selecionado pelo apelo de achadinho e preço acessível.',
          risks: risks[id] ?? 'Nenhum risco crítico identificado.',
        });
      }
    }

    // Complementa caso a LLM tenha retornado menos que o limite
    if (topOffers.length < limit) {
      for (const prod of filtered) {
        if (topOffers.length >= limit) break;
        if (!topOffers.some((t) => t.productId === prod.productId)) {
          topOffers.push({
            ...prod,
            score: 80,
            reasons: 'Complementado deterministicamente por excelente relação preço/desconto.',
            risks: 'Sem histórico longo avaliado.',
          });
        }
      }
    }

    // 9. Salvar candidatos selecionados em offer_candidates
    try {
      logger.info(`[ProductSearch] Registrando ${topOffers.length} ofertas selecionadas em offer_candidates...`);
      memoryStats.candidatesSaved = await this.productRepository.saveSelectedCandidates(topOffers);
      logger.info(`[ProductSearch] Candidatos registrados no Supabase: ${memoryStats.candidatesSaved}`);
    } catch (candErr) {
      logger.warn(`[ProductSearch] Falha não impeditiva ao registrar offer_candidates: ${candErr.message}`);
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
        sentToAI: compactPayload.length,
        selectedCount: topOffers.length,
        memory: memoryStats,
      },
    };
  }
}

export default ProductSearchService;
