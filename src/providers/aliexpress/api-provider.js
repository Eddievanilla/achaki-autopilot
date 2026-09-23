/**
 * ACHAki Autopilot — AliExpressApiProvider (Fase 4.1)
 *
 * Provedor para a API oficial do AliExpress (Affiliate Open Platform).
 * Opera em NOT_CONFIGURED até que credenciais oficiais sejam configuradas.
 *
 * Conforme regras do projeto:
 *  - NÃO realiza scraping do AliExpress.
 *  - NÃO bloqueia a execução quando ausente.
 */

import BaseProvider from '../base-provider.js';
import logger from '../../utils/logger.js';

export class AliExpressApiProvider extends BaseProvider {
  constructor() {
    super({
      marketplace: 'aliexpress',
      source: 'official_api',
      status: 'NOT_CONFIGURED',
    });

    this.appKey = process.env.ALIEXPRESS_APP_KEY || '';
    this.appSecret = process.env.ALIEXPRESS_APP_SECRET || '';
    this.trackingId = process.env.ALIEXPRESS_TRACKING_ID || '';

    if (this.appKey && this.appSecret) {
      this.status = 'AVAILABLE';
      logger.info('[AliExpressApiProvider] Credenciais de API detectadas. Status: AVAILABLE');
    } else {
      this.status = 'NOT_CONFIGURED';
    }
  }

  /**
   * Executa busca na API oficial do AliExpress.
   *
   * @param {object} options
   * @param {string} options.category
   * @param {string} options.query
   * @param {number} [options.limit=15]
   * @returns {Promise<Array<object>>}
   */
  async search({ category, query, limit = 15 }) {
    if (this.status === 'NOT_CONFIGURED') {
      logger.debug('[AliExpressApiProvider] Ignorando busca: provider NOT_CONFIGURED.');
      return [];
    }

    logger.info(`[AliExpressApiProvider] Buscando na API oficial do AliExpress: "${query}"...`);
    return [];
  }
}

export default AliExpressApiProvider;
