/**
 * ACHAki Autopilot — ProviderManager (Fase 4.1)
 *
 * Gerencia a decisão de fontes de dados no modelo API-First:
 *  1. Tenta API oficial se disponível (AVAILABLE)
 *  2. Fallback para Browser Provider quando permitido (Mercado Livre e Shopee)
 *  3. Pula marketplaces com API não configurada sem scraping invasivo (Amazon e AliExpress)
 *  4. Falha ou bloqueio de um marketplace NÃO interrompe os demais.
 */

import MercadoLivreApiProvider from '../providers/mercadolivre/api-provider.js';
import MercadoLivreBrowserProvider from '../providers/mercadolivre/browser-provider.js';
import ShopeeApiProvider from '../providers/shopee/api-provider.js';
import ShopeeBrowserProvider from '../providers/shopee/browser-provider.js';
import AmazonApiProvider from '../providers/amazon/api-provider.js';
import AliExpressApiProvider from '../providers/aliexpress/api-provider.js';
import logger from '../utils/logger.js';

export class ProviderManager {
  /**
   * @param {object} params
   * @param {import('../browser/browser.js').default} params.browserManager
   */
  constructor({ browserManager }) {
    this.browserManager = browserManager;

    // Instanciação de todos os provedores
    this.providers = {
      mercadolivre: {
        api: new MercadoLivreApiProvider(),
        browser: new MercadoLivreBrowserProvider({ browserManager }),
      },
      shopee: {
        api: new ShopeeApiProvider(),
        browser: new ShopeeBrowserProvider({ browserManager }),
      },
      amazon: {
        api: new AmazonApiProvider(),
      },
      aliexpress: {
        api: new AliExpressApiProvider(),
      },
    };
  }

  /**
   * Retorna um mapa consolidado com os status de todos os provedores.
   *
   * @returns {Record<string, 'AVAILABLE'|'NOT_CONFIGURED'|'TEMPORARILY_BLOCKED'|'ERROR'>}
   */
  getStatuses() {
    return {
      'Mercado Livre API': this.providers.mercadolivre.api.getStatus(),
      'Mercado Livre Browser': this.providers.mercadolivre.browser.getStatus(),
      'Shopee API': this.providers.shopee.api.getStatus(),
      'Shopee Browser': this.providers.shopee.browser.getStatus(),
      'Amazon API': this.providers.amazon.api.getStatus(),
      'AliExpress API': this.providers.aliexpress.api.getStatus(),
    };
  }

  /**
   * Seleciona o provedor ativo para um marketplace seguindo a regra API-First.
   *
   * @param {'mercadolivre'|'shopee'|'amazon'|'aliexpress'} marketplace
   * @returns {import('../providers/base-provider.js').default|null}
   */
  selectActiveProvider(marketplace) {
    const entry = this.providers[marketplace];
    if (!entry) return null;

    // 1. Prioridade: Official API
    if (entry.api && entry.api.isAvailable()) {
      return entry.api;
    }

    // 2. Fallback: Browser Provider (onde permitido)
    if (entry.browser) {
      const bStatus = entry.browser.getStatus();
      if (bStatus === 'AVAILABLE') {
        return entry.browser;
      }
      if (bStatus === 'TEMPORARILY_BLOCKED') {
        logger.info(`[ProviderManager] ${marketplace} Browser está TEMPORARILY_BLOCKED. Ignorando.`);
        return null;
      }
    }

    // 3. Sem provedor disponível
    return null;
  }

  /**
   * Retorna a lista de provedores ativos selecionados para todos os marketplaces.
   *
   * @returns {Array<{ marketplace: string, provider: import('../providers/base-provider.js').default }>}
   */
  getActiveProviders() {
    const active = [];
    const marketplaces = ['mercadolivre', 'shopee', 'amazon', 'aliexpress'];

    for (const m of marketplaces) {
      const provider = this.selectActiveProvider(m);
      if (provider) {
        active.push({ marketplace: m, provider });
      }
    }

    return active;
  }

  /**
   * Executa busca utilizando o provedor selecionado para o marketplace.
   * Em caso de erro, não propaga exceção para proteger os outros marketplaces.
   *
   * @param {string} marketplace
   * @param {object} searchOptions
   * @returns {Promise<Array<object>>}
   */
  async searchMarketplace(marketplace, searchOptions) {
    const provider = this.selectActiveProvider(marketplace);
    if (!provider) {
      return [];
    }

    const entry = this.providers[marketplace];

    try {
      logger.info(
        `[ProviderManager] Buscando ${marketplace} via ${provider.source} (status: ${provider.getStatus()})...`
      );
      const items = await provider.search(searchOptions);
      if (items.length > 0) {
        return items;
      }

      // Se a API oficial falhou ou retornou vazia e existe browser disponível, faz fallback imediato
      if (provider.source === 'official_api' && entry.browser && entry.browser.getStatus() === 'AVAILABLE') {
        logger.info(
          `[ProviderManager] Official API retornou 0 itens em ${marketplace}. Acionando fallback browser imediatamente...`
        );
        return await entry.browser.search(searchOptions);
      }

      return [];
    } catch (err) {
      logger.error(`[ProviderManager] Erro ao buscar em ${marketplace} (${provider.source}): ${err.message}`);
      provider.status = 'ERROR';

      // Fallback para browser se a API lançar erro
      if (provider.source === 'official_api' && entry.browser && entry.browser.getStatus() === 'AVAILABLE') {
        try {
          logger.info(`[ProviderManager] Acionando fallback browser após exceção da API...`);
          return await entry.browser.search(searchOptions);
        } catch {
          return [];
        }
      }

      return [];
    }
  }
}

export default ProviderManager;
