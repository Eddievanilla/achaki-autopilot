/**
 * ACHAki Autopilot — MercadoLivreBrowserProvider (Fase 4.1)
 *
 * Provedor de fallback via automação de navegador (Playwright).
 * Reutiliza o coletor testado e funcional de Mercado Livre.
 */

import BaseProvider from '../base-provider.js';
import MercadoLivreScraper from '../../marketplaces/mercadolivre.js';
import logger from '../../utils/logger.js';

export class MercadoLivreBrowserProvider extends BaseProvider {
  /**
   * @param {object} params
   * @param {import('../../browser/browser.js').default} params.browserManager
   */
  constructor({ browserManager }) {
    super({
      marketplace: 'mercadolivre',
      source: 'browser',
      status: 'AVAILABLE',
    });

    this.browserManager = browserManager;
    this.scraper = new MercadoLivreScraper(browserManager);
  }

  /**
   * Executa busca utilizando o coletor browser existente.
   *
   * @param {object} options
   * @param {string} options.category
   * @param {string} options.query
   * @param {number} [options.limit=15]
   * @returns {Promise<Array<object>>}
   */
  async search({ category, query, limit = 15 }) {
    try {
      const items = await this.scraper.search({ category, query, limit });
      return items.map((p) => this.normalizeProduct(p));
    } catch (err) {
      logger.error(`[MercadoLivreBrowserProvider] Erro na busca: ${err.message}`);
      return [];
    }
  }
}

export default MercadoLivreBrowserProvider;
