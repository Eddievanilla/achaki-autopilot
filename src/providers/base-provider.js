/**
 * ACHAki Autopilot — BaseProvider (Fase 4.1)
 *
 * Classe base abstrata para todos os provedores de dados de produtos
 * (APIs oficiais e automações via navegador).
 *
 * Garante contrato unificado e normalização de saída:
 *  - marketplace: 'mercadolivre' | 'shopee' | 'amazon' | 'aliexpress'
 *  - source: 'official_api' | 'browser'
 *  - status: 'AVAILABLE' | 'NOT_CONFIGURED' | 'TEMPORARILY_BLOCKED' | 'ERROR'
 */

export class BaseProvider {
  /**
   * @param {object} params
   * @param {string} params.marketplace - Identificador do marketplace
   * @param {'official_api'|'browser'} params.source - Tipo de fonte de dados
   * @param {string} [params.status='NOT_CONFIGURED'] - Estado inicial
   */
  constructor({ marketplace, source, status = 'NOT_CONFIGURED' }) {
    if (!marketplace || !source) {
      throw new Error('[BaseProvider] "marketplace" e "source" são obrigatórios.');
    }
    this.marketplace = marketplace;
    this.source = source;
    this.status = status;
  }

  /**
   * Retorna o status atual do provider.
   * @returns {'AVAILABLE'|'NOT_CONFIGURED'|'TEMPORARILY_BLOCKED'|'ERROR'}
   */
  getStatus() {
    return this.status;
  }

  /**
   * Verifica se o provedor está apto a coletar ofertas.
   * @returns {boolean}
   */
  isAvailable() {
    return this.status === 'AVAILABLE';
  }

  /**
   * Método abstrato de busca. Deve ser implementado pelas subclasses.
   *
   * @param {object} options
   * @param {string} options.category - Nome da categoria
   * @param {string} options.query - Termo de busca
   * @param {number} [options.limit=15] - Limite de itens
   * @returns {Promise<Array<object>>}
   */
  async search({ category, query, limit = 15 }) {
    throw new Error(`[${this.constructor.name}] search() deve ser implementado pela subclasse.`);
  }

  /**
   * Garante a normalização final de um produto conforme o schema ACHAki.
   * Dados inexistentes devem ser null (nunca inventados).
   *
   * @param {object} p
   * @returns {object}
   */
  normalizeProduct(p) {
    return {
      marketplace: this.marketplace,
      productId: p.productId || null,
      title: p.title || null,
      currentPrice: typeof p.currentPrice === 'number' ? p.currentPrice : null,
      originalPrice: typeof p.originalPrice === 'number' ? p.originalPrice : null,
      discountPercent: typeof p.discountPercent === 'number' ? p.discountPercent : null,
      rating: typeof p.rating === 'number' ? p.rating : null,
      reviewCount: typeof p.reviewCount === 'number' ? p.reviewCount : null,
      soldCount: typeof p.soldCount === 'number' ? p.soldCount : null,
      sellerName: p.sellerName || null,
      sellerReputation: p.sellerReputation || null,
      shipping: p.shipping || null,
      imageUrl: p.imageUrl || null,
      productUrl: p.productUrl || null,
      category: p.category || null,
      collectedAt: p.collectedAt || new Date().toISOString(),
      source: this.source,
    };
  }
}

export default BaseProvider;
