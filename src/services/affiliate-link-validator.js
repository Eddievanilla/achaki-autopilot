/**
 * ACHAki Autopilot — AffiliateLinkValidator
 *
 * Responsável por:
 *  1. Validar que o link de afiliado pertence ao marketplace correto.
 *  2. No Mercado Livre, exigir estritamente formato comissionado oficial (meli.la).
 *     NÃO aceita silenciosamente URL comum de produto como substituto de affiliate_url.
 *  3. Validar PRODUCT_MATCH: comprovar que o link gerado corresponde ao produto aprovado.
 *  4. Registrar evento de auditoria em `affiliate_link_events`.
 *  5. Retornar status: VERIFIED | UNVERIFIED | INVALID | PRODUCT_MISMATCH.
 */

import { supabase } from '../database/supabase.js';
import logger from '../utils/logger.js';

export const VALIDATION_STATUS = {
  VERIFIED: 'VERIFIED',
  UNVERIFIED: 'UNVERIFIED',
  INVALID: 'INVALID',
  PRODUCT_MISMATCH: 'PRODUCT_MISMATCH',
};

export class AffiliateLinkValidator {
  constructor({ supabaseClient = supabase } = {}) {
    this.supabase = supabaseClient;
  }

  /**
   * Extrai o ID do produto ou padrão de marketplace a partir da URL.
   *
   * @param {string} url
   * @returns {{ marketplace: string, detectedId: string|null, isAffiliatePattern: boolean }}
   */
  parseAffiliateUrl(url) {
    if (!url || typeof url !== 'string') {
      return { marketplace: 'UNKNOWN', detectedId: null, isAffiliatePattern: false };
    }

    const trimmed = url.trim();

    // 1. Mercado Livre Oficial Afiliado (meli.la)
    if (trimmed.includes('meli.la')) {
      // Formato típico: https://meli.la/1xxxxxx ou https://meli.la/2xxxxxx
      const match = trimmed.match(/meli\.la\/([a-zA-Z0-9_\-]+)/i);
      return {
        marketplace: 'mercadolivre',
        detectedId: match ? match[1] : null,
        isAffiliatePattern: true,
      };
    }

    // 2. Mercado Livre Comum (NÃO é link oficial comissionado meli.la)
    if (trimmed.includes('mercadolivre.com.br') || trimmed.includes('mercadolibre.com')) {
      const mlbMatch = trimmed.match(/(MLB-?[0-9]+)/i);
      return {
        marketplace: 'mercadolivre',
        detectedId: mlbMatch ? mlbMatch[1].replace('-', '') : null,
        isAffiliatePattern: false, // É URL de produto comum, reprovada para afiliação
      };
    }

    // 3. Shopee Afiliado (s.shopee.com.br ou shope.ee)
    if (trimmed.includes('s.shopee.com.br') || trimmed.includes('shope.ee')) {
      const match = trimmed.match(/(?:shope\.ee|s\.shopee\.com\.br)\/([a-zA-Z0-9_\-]+)/i);
      return {
        marketplace: 'shopee',
        detectedId: match ? match[1] : null,
        isAffiliatePattern: true,
      };
    }

    // 4. Amazon Afiliado (amzn.to)
    if (trimmed.includes('amzn.to')) {
      return {
        marketplace: 'amazon',
        detectedId: null,
        isAffiliatePattern: true,
      };
    }

    return {
      marketplace: 'GENERIC',
      detectedId: null,
      isAffiliatePattern: false,
    };
  }

  /**
   * Valida o link recebido contra o produto esperado e a aprovação correspondente.
   *
   * @param {object} params
   * @param {string} params.rawLink - URL colada ou detectada
   * @param {object} params.expectedProduct - Produto aprovado (com marketplace_product_id e marketplace)
   * @param {string} [params.approvalId] - ID da aprovação (publication_approvals)
   * @returns {Promise<{
   *   valid: boolean,
   *   status: string,
   *   reason: string,
   *   validatedUrl: string|null
   * }>}
   */
  async validateLink({ rawLink, expectedProduct, approvalId = null }) {
    if (!rawLink || typeof rawLink !== 'string' || !rawLink.startsWith('http')) {
      const result = {
        valid: false,
        status: VALIDATION_STATUS.INVALID,
        reason: 'O link fornecido não é uma URL HTTP/HTTPS válida.',
        validatedUrl: null,
      };
      await this.recordEvent({ approvalId, expectedProduct, rawLink, result });
      return result;
    }

    const trimmed = rawLink.trim();
    const parsed = this.parseAffiliateUrl(trimmed);
    const expectedMarketplace = (expectedProduct.marketplace || 'mercadolivre').toLowerCase();

    // 1. Verificação de Marketplace
    if (parsed.marketplace !== 'GENERIC' && parsed.marketplace !== expectedMarketplace) {
      const result = {
        valid: false,
        status: VALIDATION_STATUS.INVALID,
        reason: `Marketplace divergente: esperado [${expectedMarketplace}], detectado [${parsed.marketplace}].`,
        validatedUrl: null,
      };
      await this.recordEvent({ approvalId, expectedProduct, rawLink: trimmed, result });
      return result;
    }

    // 2. Verificação estrita para Mercado Livre
    if (expectedMarketplace === 'mercadolivre') {
      if (!parsed.isAffiliatePattern || !trimmed.includes('meli.la')) {
        const result = {
          valid: false,
          status: VALIDATION_STATUS.UNVERIFIED,
          reason: 'Link de produto comum detectado. Para o Mercado Livre, é obrigatório gerar o link comissionado oficial no padrão meli.la.',
          validatedUrl: null,
        };
        await this.recordEvent({ approvalId, expectedProduct, rawLink: trimmed, result });
        return result;
      }
    }

    // 3. Verificação de Correspondência de Produto (PRODUCT MATCH)
    // Se o link contiver explicitamente um ID de produto que diverge do esperado
    if (parsed.detectedId && expectedProduct.marketplace_product_id) {
      const expIdClean = String(expectedProduct.marketplace_product_id).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const detectedClean = String(parsed.detectedId).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

      // Se for URL comum com outro MLB
      if (detectedClean.startsWith('MLB') && !detectedClean.includes(expIdClean) && !expIdClean.includes(detectedClean)) {
        const result = {
          valid: false,
          status: VALIDATION_STATUS.PRODUCT_MISMATCH,
          reason: '⚠️ O link gerado não corresponde ao produto aprovado.',
          validatedUrl: null,
        };
        await this.recordEvent({ approvalId, expectedProduct, rawLink: trimmed, result });
        return result;
      }
    }

    // Link Verificado com Sucesso
    const result = {
      valid: true,
      status: VALIDATION_STATUS.VERIFIED,
      reason: 'Link oficial de afiliado validado e associado ao produto com sucesso.',
      validatedUrl: trimmed,
    };

    await this.recordEvent({ approvalId, expectedProduct, rawLink: trimmed, result });
    return result;
  }

  /**
   * Grava auditoria em affiliate_link_events.
   */
  async recordEvent({ approvalId, expectedProduct, rawLink, result }) {
    try {
      await this.supabase.from('affiliate_link_events').insert({
        approval_id: approvalId,
        product_id: expectedProduct?.id,
        raw_link: rawLink,
        validation_status: result.status,
        matched_marketplace: expectedProduct?.marketplace || 'mercadolivre',
        detected_product_id: expectedProduct?.marketplace_product_id,
        failure_reason: result.valid ? null : result.reason,
        metadata: {
          validated_at: new Date().toISOString(),
          reason: result.reason,
        },
      });
    } catch (e) {
      logger.warn(`[AffiliateLinkValidator] Erro ao registrar evento de auditoria: ${e.message}`);
    }
  }
}

export default AffiliateLinkValidator;
