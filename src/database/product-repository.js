/**
 * ACHAki Autopilot — ProductRepository (Fase 4.4)
 *
 * Camada de persistência e memória operacional no Supabase:
 *  - Upsert de produtos em `products` (chave composta: marketplace + marketplace_product_id)
 *  - Histórico de preços em `product_prices` (ignora duplicatas recentes se preço e desconto forem idênticos)
 *  - Registro de candidatos selecionados pela IA em `offer_candidates`
 *
 * SEGURANÇA & RESILIÊNCIA:
 *  - Falhas no banco são capturadas e logadas sem interromper o fluxo da aplicação.
 *  - Nenhuma credencial ou token é impresso ou exposto.
 */

import { supabase } from './supabase.js';
import logger from '../utils/logger.js';

export class ProductRepository {
  constructor() {
    this.client = supabase;
  }

  /**
   * Salva ou atualiza um produto na tabela `products`.
   * Garante ausência de duplicidade para (marketplace, marketplace_product_id).
   *
   * @param {object} item
   * @returns {Promise<{ product: object|null, isNew: boolean, error?: string }>}
   */
  async saveOrUpdateProduct(item) {
    if (!item?.marketplace || !item?.productId) {
      return { product: null, isNew: false, error: 'Dados mínimos de produto ausentes' };
    }

    try {
      // 1. Verifica se o produto já existe
      const { data: existing, error: queryError } = await this.client
        .from('products')
        .select('*')
        .eq('marketplace', item.marketplace)
        .eq('marketplace_product_id', item.productId)
        .maybeSingle();

      if (queryError) {
        logger.warn(`[ProductRepository] Erro ao consultar produto: ${queryError.message}`);
        return { product: null, isNew: false, error: queryError.message };
      }

      const now = new Date().toISOString();

      if (existing) {
        // 2. Atualiza dados atuais do produto existente
        const { data: updated, error: updateError } = await this.client
          .from('products')
          .update({
            title: item.title,
            category: item.category || existing.category,
            product_url: item.productUrl || existing.product_url,
            image_url: item.imageUrl || existing.image_url,
            seller_name: item.sellerName || existing.seller_name,
            updated_at: now,
          })
          .eq('id', existing.id)
          .select()
          .single();

        if (updateError) {
          logger.warn(`[ProductRepository] Erro ao atualizar produto ${item.productId}: ${updateError.message}`);
          return { product: existing, isNew: false, error: updateError.message };
        }

        return { product: updated, isNew: false };
      }

      // 3. Insere novo produto
      const { data: inserted, error: insertError } = await this.client
        .from('products')
        .insert({
          marketplace: item.marketplace,
          marketplace_product_id: item.productId,
          title: item.title,
          category: item.category || null,
          product_url: item.productUrl,
          image_url: item.imageUrl || null,
          seller_name: item.sellerName || null,
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();

      if (insertError) {
        logger.warn(`[ProductRepository] Erro ao inserir produto ${item.productId}: ${insertError.message}`);
        return { product: null, isNew: false, error: insertError.message };
      }

      return { product: inserted, isNew: true };
    } catch (err) {
      logger.error(`[ProductRepository] Exceção em saveOrUpdateProduct: ${err.message}`);
      return { product: null, isNew: false, error: err.message };
    }
  }

  /**
   * Registra uma observação de preço em `product_prices`.
   * Não duplica se o preço atual, original e desconto forem iguais à última observação.
   *
   * @param {string} productId - UUID da tabela products
   * @param {object} priceData
   * @returns {Promise<{ recorded: boolean, skipped: boolean, error?: string }>}
   */
  async recordPriceObservation(productId, priceData) {
    if (!productId || priceData.currentPrice === undefined || priceData.currentPrice === null) {
      return { recorded: false, skipped: false, error: 'Parâmetros de preço inválidos' };
    }

    try {
      // 1. Busca a última observação de preço para este produto
      const { data: lastPrice, error: lastError } = await this.client
        .from('product_prices')
        .select('current_price, original_price, discount_percent')
        .eq('product_id', productId)
        .order('collected_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastError) {
        logger.warn(`[ProductRepository] Erro ao buscar último preço: ${lastError.message}`);
      }

      // 2. Compara com os valores recebidos
      if (lastPrice) {
        const curCurrent = Number(priceData.currentPrice);
        const lastCurrent = Number(lastPrice.current_price);
        const curOriginal = priceData.originalPrice ? Number(priceData.originalPrice) : null;
        const lastOriginal = lastPrice.original_price ? Number(lastPrice.original_price) : null;
        const curDiscount = priceData.discountPercent ? Number(priceData.discountPercent) : null;
        const lastDiscount = lastPrice.discount_percent ? Number(lastPrice.discount_percent) : null;

        const isSameCurrent = curCurrent === lastCurrent;
        const isSameOriginal = curOriginal === lastOriginal;
        const isSameDiscount = curDiscount === lastDiscount;

        if (isSameCurrent && isSameOriginal && isSameDiscount) {
          // Preço idêntico ao anterior: ignora para não poluir histórico
          return { recorded: false, skipped: true };
        }
      }

      // 3. Registra nova observação
      const { error: insertError } = await this.client
        .from('product_prices')
        .insert({
          product_id: productId,
          current_price: priceData.currentPrice,
          original_price: priceData.originalPrice || null,
          discount_percent: priceData.discountPercent || null,
          collected_at: priceData.collectedAt || new Date().toISOString(),
        });

      if (insertError) {
        logger.warn(`[ProductRepository] Erro ao registrar preço: ${insertError.message}`);
        return { recorded: false, skipped: false, error: insertError.message };
      }

      return { recorded: true, skipped: false };
    } catch (err) {
      logger.error(`[ProductRepository] Exceção em recordPriceObservation: ${err.message}`);
      return { recorded: false, skipped: false, error: err.message };
    }
  }

  /**
   * Registra um candidato a oferta selecionado pela IA em `offer_candidates`.
   *
   * @param {object} candidate
   * @returns {Promise<{ ok: boolean, data?: object, error?: string }>}
   */
  async recordOfferCandidate({ productId, aiScore, aiReason, aiRisk, status = 'selected' }) {
    if (!productId) {
      return { ok: false, error: 'productId ausente para offer_candidate' };
    }

    try {
      const { data, error } = await this.client
        .from('offer_candidates')
        .insert({
          product_id: productId,
          ai_score: aiScore ?? 85,
          ai_reason: aiReason || null,
          ai_risk: aiRisk || null,
          status,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        logger.warn(`[ProductRepository] Erro ao salvar offer_candidate: ${error.message}`);
        return { ok: false, error: error.message };
      }

      return { ok: true, data };
    } catch (err) {
      logger.error(`[ProductRepository] Exceção em recordOfferCandidate: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Salva um lote de produtos filtrados e seus preços no Supabase.
   *
   * @param {Array<object>} products - Lista de produtos validados
   * @returns {Promise<{
   *   savedTotal: number,
   *   newCount: number,
   *   updatedCount: number,
   *   pricesRecorded: number,
   *   pricesSkipped: number,
   *   dbIdMap: Map<string, string>
   * }>}
   */
  async syncProductsBatch(products) {
    const stats = {
      savedTotal: 0,
      newCount: 0,
      updatedCount: 0,
      pricesRecorded: 0,
      pricesSkipped: 0,
    };
    const dbIdMap = new Map(); // productId (string) -> Supabase UUID

    if (!Array.isArray(products) || products.length === 0) {
      return { ...stats, dbIdMap };
    }

    for (const item of products) {
      try {
        const { product, isNew } = await this.saveOrUpdateProduct(item);
        if (product?.id) {
          stats.savedTotal++;
          if (isNew) {
            stats.newCount++;
          } else {
            stats.updatedCount++;
          }
          dbIdMap.set(item.productId, product.id);
          item.dbId = product.id; // Vincula ao objeto em memória

          // Registra preço
          const priceRes = await this.recordPriceObservation(product.id, {
            currentPrice: item.currentPrice,
            originalPrice: item.originalPrice,
            discountPercent: item.discountPercent,
            collectedAt: item.collectedAt,
          });

          if (priceRes.recorded) {
            stats.pricesRecorded++;
          } else if (priceRes.skipped) {
            stats.pricesSkipped++;
          }
        }
      } catch (err) {
        logger.warn(`[ProductRepository] Falha ao sincronizar item ${item.productId}: ${err.message}`);
      }
    }

    return { ...stats, dbIdMap };
  }

  /**
   * Salva as ofertas selecionadas pela IA em `offer_candidates`.
   *
   * @param {Array<object>} topOffers - Ofertas selecionadas pelo OpenRouter
   * @returns {Promise<number>} Quantidade de candidatos salvos com sucesso
   */
  async saveSelectedCandidates(topOffers) {
    let saved = 0;
    if (!Array.isArray(topOffers) || topOffers.length === 0) {
      return 0;
    }

    for (const offer of topOffers) {
      if (!offer.dbId) continue;
      try {
        const res = await this.recordOfferCandidate({
          productId: offer.dbId,
          aiScore: offer.score,
          aiReason: offer.reasons,
          aiRisk: offer.risks,
          status: 'selected',
        });
        if (res.ok) {
          saved++;
        }
      } catch (err) {
        logger.warn(`[ProductRepository] Falha ao salvar candidato selecionado: ${err.message}`);
      }
    }

    return saved;
  }
}

export default ProductRepository;
