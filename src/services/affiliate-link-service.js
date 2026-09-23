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
 *  - Executa a resolução AUTOMÁTICA via mecanismo oficial da conta autenticada (MercadoLivreAffiliateProvider).
 *  - affiliateVerified = true apenas quando obtido pelo mecanismo oficial comissionado.
 */

import MercadoLivreAffiliateProvider from '../providers/mercadolivre/affiliate-provider.js';
import { supabase } from '../database/supabase.js';
import logger from '../utils/logger.js';

export class AffiliateLinkService {
  constructor({ browserManager } = {}) {
    this.browserManager = browserManager || null;
    this.mlProvider = new MercadoLivreAffiliateProvider({ browserManager: this.browserManager });
    this.shopeePartnerId = process.env.SHOPEE_PARTNER_ID || '';
    this.amazonTag = process.env.AMAZON_ASSOCIATE_TAG || '';
    this.aliexpressTrackingId = process.env.ALIEXPRESS_TRACKING_ID || '';
  }

  /**
   * Avalia e gera o link de afiliado oficial para um produto de forma 100% automatizada.
   *
   * @param {object} params
   * @param {string} params.marketplace - 'mercadolivre' | 'shopee' | 'amazon' | 'aliexpress'
   * @param {string} params.productUrl - URL original do produto
   * @param {string} [params.productId] - ID do produto no marketplace (ex: MLB4817578135)
   * @param {string} [params.dbProductId] - UUID do produto na tabela products do Supabase
   * @returns {Promise<{
   *   configured: boolean,
   *   marketplace: string,
   *   productUrl: string,
   *   affiliateUrl: string | null,
   *   shortUrl?: string,
   *   longUrl?: string,
   *   tag?: string,
   *   affiliateVerified: boolean,
   *   status: string,
   *   reason?: string,
   *   generatedAt: string
   * }>}
   */
  async resolveAffiliateLink({ marketplace, productUrl, productId, dbProductId }) {
    if (!productUrl) {
      return {
        configured: false,
        marketplace: marketplace || 'desconhecido',
        productUrl: '',
        affiliateUrl: null,
        affiliateVerified: false,
        status: 'URL_INVALIDA',
        reason: 'URL do produto ausente.',
        generatedAt: new Date().toISOString(),
      };
    }

    const normMarketplace = (marketplace || '').toLowerCase();

    // 1. Mercado Livre
    if (normMarketplace === 'mercadolivre') {
      try {
        // A) Verifica se já existe affiliate_url salvo no Supabase para este produto
        if (dbProductId || productId) {
          let query = supabase.from('products').select('id, affiliate_url');
          if (dbProductId) query = query.eq('id', dbProductId);
          else query = query.eq('marketplace_product_id', productId);

          const { data: existingProd } = await query.maybeSingle();
          if (existingProd && existingProd.affiliate_url) {
            logger.info(`[AffiliateLinkService] Link de afiliado recuperado do Supabase para ${productId || dbProductId}: ${existingProd.affiliate_url}`);
            return {
              configured: true,
              marketplace: 'mercadolivre',
              productUrl,
              affiliateUrl: existingProd.affiliate_url,
              affiliateVerified: true,
              status: 'CONFIGURADO',
              generatedAt: new Date().toISOString(),
            };
          }
        }

        // B) Gera via mecanismo oficial no Mercado Livre autenticado
        logger.info(`[AffiliateLinkService] Gerando link de afiliado oficial para ${productId || productUrl}...`);
        const result = await this.mlProvider.generateAffiliateLink({ productUrl, productId });

        if (result.affiliateVerified && result.affiliateUrl) {
          // C) Salva o link de afiliado gerado no Supabase para persistência
          try {
            if (dbProductId) {
              await supabase
                .from('products')
                .update({ affiliate_url: result.affiliateUrl, updated_at: new Date().toISOString() })
                .eq('id', dbProductId);
            } else if (productId) {
              await supabase
                .from('products')
                .update({ affiliate_url: result.affiliateUrl, updated_at: new Date().toISOString() })
                .eq('marketplace_product_id', productId);
            }
          } catch (dbErr) {
            logger.warn(`[AffiliateLinkService] Falha não-impeditiva ao persistir affiliate_url no Supabase: ${dbErr.message}`);
          }

          return {
            configured: true,
            marketplace: 'mercadolivre',
            productUrl,
            affiliateUrl: result.affiliateUrl,
            shortUrl: result.shortUrl,
            longUrl: result.longUrl,
            tag: result.tag,
            affiliateVerified: true,
            status: 'CONFIGURADO',
            generatedAt: result.generatedAt,
          };
        }

        return {
          configured: false,
          marketplace: 'mercadolivre',
          productUrl,
          affiliateUrl: null,
          affiliateVerified: false,
          status: 'AUTOMAÇÃO DO LINK DE AFILIADO AINDA NÃO CONFIGURADA',
          reason: result.error || 'Mecanismo oficial do Mercado Livre não retornou URL comissionada.',
          generatedAt: new Date().toISOString(),
        };

      } catch (err) {
        logger.error(`[AffiliateLinkService] Erro na geração automática ML: ${err.message}`);
        return {
          configured: false,
          marketplace: 'mercadolivre',
          productUrl,
          affiliateUrl: null,
          affiliateVerified: false,
          status: 'ERRO_GERACAO',
          reason: err.message,
          generatedAt: new Date().toISOString(),
        };
      }
    }

    // 2. Shopee
    if (normMarketplace === 'shopee') {
      return {
        configured: false,
        marketplace: 'shopee',
        productUrl,
        affiliateUrl: null,
        affiliateVerified: false,
        status: 'AUTOMAÇÃO DO LINK DE AFILIADO AINDA NÃO CONFIGURADA',
        reason: 'Automação Shopee em desenvolvimento.',
        generatedAt: new Date().toISOString(),
      };
    }

    // 3. Outros marketplaces
    return {
      configured: false,
      marketplace: normMarketplace,
      productUrl,
      affiliateUrl: null,
      affiliateVerified: false,
      status: 'AUTOMAÇÃO DO LINK DE AFILIADO AINDA NÃO CONFIGURADA',
      reason: `Automação para ${marketplace} ainda não configurada.`,
      generatedAt: new Date().toISOString(),
    };
  }
}

export default AffiliateLinkService;
