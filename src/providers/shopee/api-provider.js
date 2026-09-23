/**
 * ACHAki Autopilot — ShopeeApiProvider (Fase 4.1)
 *
 * Provedor para a API oficial da Shopee (Open Platform / Affiliate API).
 * Opera em NOT_CONFIGURED até que credenciais oficiais sejam configuradas.
 */

import BaseProvider from '../base-provider.js';
import logger from '../../utils/logger.js';

export class ShopeeApiProvider extends BaseProvider {
  constructor() {
    super({
      marketplace: 'shopee',
      source: 'official_api',
      status: 'NOT_CONFIGURED',
    });

    this.partnerId = process.env.SHOPEE_PARTNER_ID || '';
    this.partnerKey = process.env.SHOPEE_PARTNER_KEY || '';
    this.accessToken = process.env.SHOPEE_ACCESS_TOKEN || '';

    if (this.partnerId && this.partnerKey) {
      this.status = 'AVAILABLE';
      logger.info('[ShopeeApiProvider] Credenciais de API detectadas. Status: AVAILABLE');
    } else {
      this.status = 'NOT_CONFIGURED';
    }
  }

  /**
   * Executa busca na API oficial da Shopee.
   *
   * @param {object} options
   * @param {string} options.category
   * @param {string} options.query
   * @param {number} [options.limit=15]
   * @returns {Promise<Array<object>>}
   */
  async search({ category, query, limit = 15 }) {
    if (this.status === 'NOT_CONFIGURED') {
      logger.debug('[ShopeeApiProvider] Ignorando busca: provider NOT_CONFIGURED.');
      return [];
    }

    // Estrutura preparada para integração futura com a API oficial da Shopee
    logger.info(`[ShopeeApiProvider] Buscando na API oficial da Shopee: "${query}"...`);
    return [];
  }
}

export default ShopeeApiProvider;
