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
import { affiliatePattern, productIdentity, normalizeMarketplace, officialHost, generatorUrl } from './affiliate-marketplaces.js';

export const VALIDATION_STATUS = {
  VERIFIED: 'VERIFIED',
  UNVERIFIED: 'UNVERIFIED',
  INVALID: 'INVALID',
  PRODUCT_MISMATCH: 'PRODUCT_MISMATCH',
};

export class AffiliateLinkValidator {
  constructor({ supabaseClient = supabase, fetchImpl = globalThis.fetch } = {}) {
    this.supabase = supabaseClient;
    this.fetch = fetchImpl;
  }

  /**
   * Extrai o ID do produto ou padrão de marketplace a partir da URL.
   *
   * @param {string} url
   * @returns {{ marketplace: string, detectedId: string|null, isAffiliatePattern: boolean }}
   */
  parseAffiliateUrl(raw) {
    for (const marketplace of ['mercadolivre', 'shopee', 'amazon']) {
      if (affiliatePattern(raw, marketplace)) return { marketplace, detectedId: productIdentity(raw, marketplace), isAffiliatePattern: true };
    }
    return { marketplace: 'UNKNOWN', detectedId: null, isAffiliatePattern: false };
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
  async validateLink({ rawLink, expectedProduct, approvalId = null, captureEvidence = null }) {
    const marketplace = normalizeMarketplace(expectedProduct?.marketplace);
    const trimmed = typeof rawLink === 'string' ? rawLink.trim() : '';
    let result = { valid: false, status: VALIDATION_STATUS.UNVERIFIED,
      reason: 'Não foi possível confirmar o link comissionado e o produto de destino.', validatedUrl: null };
    if (!affiliatePattern(trimmed, marketplace) || trimmed === expectedProduct.product_url) {
      result.status = VALIDATION_STATUS.INVALID;
      result.reason = 'URL comum, inválida ou de outro marketplace. Gere um link oficial de afiliado.';
    } else {
      // Evidence comes only from the local session observer, never from an API request.
      const officialCapture = captureEvidence?.sourceProductUrl === expectedProduct.product_url &&
        captureEvidence?.affiliateUrl === trimmed &&
        captureEvidence?.generatorUrl === generatorUrl(expectedProduct);
      let matches = officialCapture;
      if (!matches) {
        try {
          const destination = await this.resolveDestination(trimmed, marketplace);
          const expected = productIdentity(expectedProduct.product_url, marketplace);
          const actual = productIdentity(destination, marketplace);
          matches = !!expected && expected === actual;
          if (expected && actual && expected !== actual) result.status = VALIDATION_STATUS.PRODUCT_MISMATCH;
        } catch { /* Redirects/login/challenges that cannot establish identity remain unverified. */ }
      }
      if (matches) result = { valid: true, status: VALIDATION_STATUS.VERIFIED,
        reason: 'Link oficial e produto confirmados.', validatedUrl: trimmed };
    }
    await this.recordEvent({ approvalId, expectedProduct, rawLink: trimmed, result });
    return result;
  }

  async resolveDestination(raw, marketplace) {
    let url = new URL(raw);
    for (let hop = 0; hop < 8; hop++) {
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !officialHost(url.hostname, marketplace)) throw new Error('Destino não autorizado.');
      const response = await this.fetch(url.href, {
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        }
      });
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (response.status >= 300 && response.status < 400 && location) {
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) throw new Error('Destino não confirmado.');
      return url.href;
    }
    throw new Error('Redirecionamentos não confirmados.');
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
