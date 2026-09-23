/**
 * ACHAki Autopilot — AmazonApiProvider (Fase 4.1)
 *
 * Provedor para a API oficial da Amazon (Product Advertising API / Creators API).
 * Opera em NOT_CONFIGURED até que credenciais oficiais sejam configuradas.
 *
 * Conforme regras do projeto:
 *  - NÃO realiza scraping da Amazon.
 *  - NÃO bloqueia a execução quando ausente.
 */

import BaseProvider from '../base-provider.js';
import logger from '../../utils/logger.js';

export class AmazonApiProvider extends BaseProvider {
  constructor() {
    super({
      marketplace: 'amazon',
      source: 'official_api',
      status: 'NOT_CONFIGURED',
    });

    this.accessKey = process.env.AMAZON_PAAPI_KEY || '';
    this.secretKey = process.env.AMAZON_PAAPI_SECRET || '';
    this.associateTag = process.env.AMAZON_ASSOCIATE_TAG || '';

    if (this.accessKey && this.secretKey && this.associateTag) {
      this.status = 'AVAILABLE';
      logger.info('[AmazonApiProvider] Credenciais de API detectadas. Status: AVAILABLE');
    } else {
      this.status = 'NOT_CONFIGURED';
    }
  }

  /**
   * Executa busca na API oficial da Amazon.
   *
   * @param {object} options
   * @param {string} options.category
   * @param {string} options.query
   * @param {number} [options.limit=15]
   * @returns {Promise<Array<object>>}
   */
  async search({ category, query, limit = 15 }) {
    if (this.status === 'NOT_CONFIGURED') {
      logger.debug('[AmazonApiProvider] Ignorando busca: provider NOT_CONFIGURED.');
      return [];
    }

    logger.info(`[AmazonApiProvider] Buscando na API oficial da Amazon: "${query}"...`);
    return [];
  }
}

export default AmazonApiProvider;
