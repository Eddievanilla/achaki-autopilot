/**
 * ACHAki Autopilot — ShopeeBrowserProvider (Fase 4.1)
 *
 * Provedor de fallback via automação de navegador (Playwright).
 * Reutiliza o coletor ShopeeScraper.
 * Se detectar desafio anti-bot, encerra imediatamente e marca status como TEMPORARILY_BLOCKED.
 */

import BaseProvider from '../base-provider.js';
import ShopeeScraper from '../../marketplaces/shopee.js';
import logger from '../../utils/logger.js';

export class ShopeeBrowserProvider extends BaseProvider {
  /**
   * @param {object} params
   * @param {import('../../browser/browser.js').default} params.browserManager
   */
  constructor({ browserManager }) {
    super({
      marketplace: 'shopee',
      source: 'browser',
      status: 'AVAILABLE',
    });

    this.browserManager = browserManager;
    this.scraper = new ShopeeScraper(browserManager);
  }

  /**
   * Sincroniza o status com o estado atual do scraper.
   * @returns {'AVAILABLE'|'TEMPORARILY_BLOCKED'|'ERROR'}
   */
  getStatus() {
    if (this.scraper.status === 'TEMPORARILY_BLOCKED') {
      this.status = 'TEMPORARILY_BLOCKED';
    }
    return this.status;
  }

  /**
   * Executa busca na Shopee via browser automation.
   *
   * @param {object} options
   * @param {string} options.category
   * @param {string} options.query
   * @param {number} [options.limit=15]
   * @returns {Promise<Array<object>>}
   */
  async search({ category, query, limit = 15 }) {
    if (this.getStatus() === 'TEMPORARILY_BLOCKED') {
      logger.info(`[ShopeeBrowserProvider] Ignorando busca: provider TEMPORARILY_BLOCKED.`);
      return [];
    }

    try {
      const items = await this.scraper.search({ category, query, limit });
      this.getStatus(); // atualiza status após execução
      return items.map((p) => this.normalizeProduct(p));
    } catch (err) {
      logger.error(`[ShopeeBrowserProvider] Erro na busca: ${err.message}`);
      return [];
    }
  }
}

export default ShopeeBrowserProvider;
