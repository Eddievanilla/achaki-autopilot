/**
 * ACHAki Autopilot — AffiliateLinkService
 *
 * Gerenciador de links de afiliados desacoplado por marketplace.
 *
 * REGRAS CRÍTICAS:
 *  - Diferencia estritamente:
 *      1. product_url   : link original da oferta no marketplace
 *      2. affiliate_url : link de afiliado oficial que gera comissão
 *      3. tracking_url  : link próprio do ACHAki (achaki-autopilot.vercel.app/go/{id})
 *  - NUNCA trata URL comum do produto como link de afiliado se ela não for.
 *  - Se ainda não existir automação/credencial oficial para gerar o link comissionado:
 *    Retorna status: "AUTOMAÇÃO DO LINK DE AFILIADO AINDA NÃO CONFIGURADA".
 *  - Não publica fingindo que existe comissão.
 */

import logger from '../utils/logger.js';

export class AffiliateLinkService {
  constructor() {
    this.mlAffiliateTag = process.env.MERCADOLIVRE_AFFILIATE_TAG || process.env.ML_AFFILIATE_TAG || '';
    this.shopeePartnerId = process.env.SHOPEE_PARTNER_ID || '';
    this.amazonTag = process.env.AMAZON_ASSOCIATE_TAG || '';
    this.aliexpressTrackingId = process.env.ALIEXPRESS_TRACKING_ID || '';
  }

  /**
   * Avalia e gera o link de afiliado oficial para um produto.
   *
   * @param {object} params
   * @param {string} params.marketplace - 'mercadolivre' | 'shopee' | 'amazon' | 'aliexpress'
   * @param {string} params.productUrl - URL original do produto
   * @param {string} [params.productId] - ID do produto no marketplace
   * @returns {{
   *   configured: boolean,
   *   marketplace: string,
   *   productUrl: string,
   *   affiliateUrl: string | null,
   *   status: string,
   *   reason?: string
   * }}
   */
  resolveAffiliateLink({ marketplace, productUrl, productId }) {
    if (!productUrl) {
      return {
        configured: false,
        marketplace,
        productUrl: '',
        affiliateUrl: null,
        status: 'URL_INVALIDA',
        reason: 'URL do produto ausente',
      };
    }

    const normMarketplace = (marketplace || '').toLowerCase();

    // 1. Mercado Livre
    if (normMarketplace === 'mercadolivre') {
      if (!this.mlAffiliateTag) {
        logger.warn('[AffiliateLinkService] Mercado Livre: AUTOMAÇÃO DO LINK DE AFILIADO AINDA NÃO CONFIGURADA');
        return {
          configured: false,
          marketplace: 'mercadolivre',
          productUrl,
          affiliateUrl: null,
          status: 'AUTOMAÇÃO DO LINK DE AFILIADO AINDA NÃO CONFIGURADA',
          reason: 'MERCADOLIVRE_AFFILIATE_TAG não encontrada nas variáveis de ambiente. Para comissionamento real, cadastre a tag ou API no painel de afiliados.',
        };
      }

      // Se a tag estiver presente, aplica formato oficial de deeplink comissionado
      const affiliateUrl = productUrl.includes('?')
        ? `${productUrl}&matt_tool=${this.mlAffiliateTag}`
        : `${productUrl}?matt_tool=${this.mlAffiliateTag}`;

      return {
        configured: true,
        marketplace: 'mercadolivre',
        productUrl,
        affiliateUrl,
        status: 'CONFIGURADO',
      };
    }

    // 2. Shopee
    if (normMarketplace === 'shopee') {
      if (!this.shopeePartnerId) {
        return {
          configured: false,
          marketplace: 'shopee',
          productUrl,
          affiliateUrl: null,
          status: 'AUTOMAÇÃO DO LINK DE AFILIADO AINDA NÃO CONFIGURADA',
          reason: 'Credenciais de afiliado Shopee ausentes.',
        };
      }
    }

    // 3. Demais marketplaces
    return {
      configured: false,
      marketplace: normMarketplace,
      productUrl,
      affiliateUrl: null,
      status: 'AUTOMAÇÃO DO LINK DE AFILIADO AINDA NÃO CONFIGURADA',
      reason: `Automação para ${marketplace} ainda não configurada.`,
    };
  }
}

export default AffiliateLinkService;
