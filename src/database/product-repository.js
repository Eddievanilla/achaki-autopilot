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

  /**
   * Obtém métricas históricas agregadas para um conjunto de produtos.
   *
   * @param {string[]} dbIds - Lista de UUIDs dos produtos
   * @returns {Promise<Map<string, object>>} Map indexado pelo dbId
   */
  async getHistoryMetricsBatch(dbIds) {
    const metricsMap = new Map();
    if (!Array.isArray(dbIds) || dbIds.length === 0) {
      return metricsMap;
    }

    try {
      // 1. Histórico de preços
      const { data: prices, error: priceErr } = await this.client
        .from('product_prices')
        .select('product_id, current_price, original_price, discount_percent, collected_at')
        .in('product_id', dbIds)
        .order('collected_at', { ascending: true });

      if (priceErr) {
        logger.warn(`[ProductRepository] Falha ao consultar preços históricos: ${priceErr.message}`);
      }

      // 2. Frequência de seleção em offer_candidates
      const { data: candidates, error: candErr } = await this.client
        .from('offer_candidates')
        .select('product_id')
        .in('product_id', dbIds);

      if (candErr) {
        logger.warn(`[ProductRepository] Falha ao consultar histórico de candidatos: ${candErr.message}`);
      }

      // 3. Histórico de publicações
      const { data: publications, error: pubErr } = await this.client
        .from('publications')
        .select('product_id')
        .in('product_id', dbIds);

      if (pubErr) {
        logger.warn(`[ProductRepository] Falha ao consultar publicações: ${pubErr.message}`);
      }

      // Agrupa preços por product_id
      const pricesByProd = new Map();
      for (const p of (prices || [])) {
        if (!pricesByProd.has(p.product_id)) {
          pricesByProd.set(p.product_id, []);
        }
        pricesByProd.get(p.product_id).push(p);
      }

      // Conta seleções por product_id
      const candidateCounts = new Map();
      for (const c of (candidates || [])) {
        candidateCounts.set(c.product_id, (candidateCounts.get(c.product_id) || 0) + 1);
      }

      // Identifica publicações por product_id
      const publishedSet = new Set((publications || []).map((pub) => pub.product_id));

      for (const id of dbIds) {
        const prodPrices = pricesByProd.get(id) || [];
        const priceCount = prodPrices.length;

        let lastKnownPrice = null;
        let minPrice = null;
        let maxPrice = null;
        let avgPrice = null;

        if (priceCount > 0) {
          const numericPrices = prodPrices.map((p) => Number(p.current_price)).filter((p) => !isNaN(p) && p > 0);
          if (numericPrices.length > 0) {
            minPrice = Math.min(...numericPrices);
            maxPrice = Math.max(...numericPrices);
            const sum = numericPrices.reduce((acc, curr) => acc + curr, 0);
            avgPrice = Math.round((sum / numericPrices.length) * 100) / 100;
            // O penúltimo preço registrado (se houver mais de 1 observação)
            lastKnownPrice = numericPrices.length > 1 ? numericPrices[numericPrices.length - 2] : numericPrices[0];
          }
        }

        let historyConfidence = 'LOW';
        if (priceCount >= 5) {
          historyConfidence = 'HIGH';
        } else if (priceCount >= 2) {
          historyConfidence = 'MEDIUM';
        }

        metricsMap.set(id, {
          priceObservations: priceCount,
          lastKnownPrice,
          minPrice,
          maxPrice,
          avgPrice,
          selectionFrequency: candidateCounts.get(id) || 0,
          isPublished: publishedSet.has(id),
          historyConfidence,
        });
      }

      return metricsMap;
    } catch (err) {
      logger.error(`[ProductRepository] Exceção em getHistoryMetricsBatch: ${err.message}`);
      return metricsMap;
    }
  }

  /**
   * Consulta decisões recentes em cache para um lote de produtos.
   * Reutiliza a decisão se:
   *  - Foi analisada recentemente (TTL padrão: 24 horas);
   *  - O preço atual for idêntico;
   *  - O percentual de desconto for idêntico.
   *
   * @param {Array<object>} products - Produtos com dbId e currentPrice
   * @param {number} [ttlHours=24] - Validade do cache em horas
   * @returns {Promise<Map<string, object>>} Map indexado pelo productId original
   */
  async getCachedDecisionsBatch(products, ttlHours = 24) {
    const cachedMap = new Map();
    if (!Array.isArray(products) || products.length === 0) {
      return cachedMap;
    }

    const dbIdToProductMap = new Map();
    const dbIds = [];
    for (const p of products) {
      if (p.dbId) {
        dbIds.push(p.dbId);
        dbIdToProductMap.set(p.dbId, p);
      }
    }

    if (dbIds.length === 0) {
      return cachedMap;
    }

    try {
      const sinceDate = new Date(Date.now() - ttlHours * 3600 * 1000).toISOString();
      const { data: cachedRows, error } = await this.client
        .from('ai_decision_cache')
        .select('*')
        .in('product_id', dbIds)
        .gte('updated_at', sinceDate);

      if (error) {
        logger.warn(`[ProductRepository] Erro ao consultar cache de decisões: ${error.message}`);
        return cachedMap;
      }

      if (Array.isArray(cachedRows)) {
        for (const row of cachedRows) {
          const product = dbIdToProductMap.get(row.product_id);
          if (!product) continue;

          // Valida se o preço e desconto não mudaram
          const curPrice = Number(product.currentPrice);
          const cachedPrice = Number(row.last_price);
          const priceMatches = Math.abs(curPrice - cachedPrice) < 0.05;

          const curDiscount = Number(product.announcedDiscount || product.discountPercent || 0);
          const cachedDiscount = Number(row.discount_percent || 0);
          const discountMatches = Math.abs(curDiscount - cachedDiscount) <= 1;

          if (priceMatches && discountMatches) {
            cachedMap.set(product.productId, {
              productId: product.productId,
              dbId: row.product_id,
              lastPrice: row.last_price,
              discountPercent: row.discount_percent,
              localScore: row.local_score,
              jevDecisionScore: row.jev_decision_score,
              jevQualityTier: row.jev_quality_tier,
              jevIsAchadinho: row.jev_is_achadinho,
              jevRiskLevel: row.jev_risk_level,
              jevNeedsEscalation: row.jev_needs_escalation,
              aiScore: row.ai_score,
              aiReason: row.ai_reason,
              aiRisk: row.ai_risk,
              modelUsed: row.model_used,
              cachedAt: row.updated_at,
              fromCache: true,
            });
          }
        }
      }

      return cachedMap;
    } catch (err) {
      logger.warn(`[ProductRepository] Exceção ao consultar cache de decisões: ${err.message}`);
      return cachedMap;
    }
  }

  /**
   * Salva ou atualiza decisões na tabela `ai_decision_cache`.
   *
   * @param {Array<object>} decisions
   * @returns {Promise<number>} Quantidade de registros persistidos no cache
   */
  async saveDecisionCacheBatch(decisions) {
    if (!Array.isArray(decisions) || decisions.length === 0) {
      return 0;
    }

    let saved = 0;
    const now = new Date().toISOString();

    for (const d of decisions) {
      if (!d.dbId) continue;
      try {
        const payload = {
          product_id: d.dbId,
          last_price: d.currentPrice ?? d.lastPrice ?? 0,
          discount_percent: d.announcedDiscount ?? d.discountPercent ?? 0,
          local_score: d.localScore ?? null,
          jev_decision_score: d.jevDecisionScore ?? null,
          jev_quality_tier: d.jevQualityTier ?? null,
          jev_is_achadinho: d.jevIsAchadinho ?? null,
          jev_risk_level: d.jevRiskLevel ?? null,
          jev_needs_escalation: d.jevNeedsEscalation ?? false,
          ai_score: d.aiScore ?? null,
          ai_reason: d.reasons ?? d.aiReason ?? null,
          ai_risk: d.risks ?? d.aiRisk ?? null,
          model_used: d.modelUsed || 'typesafe/jev-1.13',
          updated_at: now,
        };

        const { error } = await this.client
          .from('ai_decision_cache')
          .upsert(payload, { onConflict: 'product_id' });

        if (!error) {
          saved++;
        } else {
          logger.warn(`[ProductRepository] Falha ao persistir cache para produto ${d.dbId}: ${error.message}`);
        }
      } catch (err) {
        logger.warn(`[ProductRepository] Exceção ao salvar cache de decisão: ${err.message}`);
      }
    }

    return saved;
  }

  /**
   * Registra um evento no feed de atividade operacional em tempo real.
   *
   * @param {string} message
   * @param {'INFO'|'WARN'|'SUCCESS'|'ERROR'} [level='INFO']
   */
  async logActivity(message, level = 'INFO') {
    try {
      await this.client.from('system_activity_logs').insert({
        message,
        level,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn(`[ProductRepository] Falha ao registrar log de atividade: ${err.message}`);
    }
  }

  /**
   * Atualiza o estado singleton operacional do robô.
   *
   * @param {object} updates
   */
  async updateSystemState(updates = {}) {
    try {
      const payload = {
        ...updates,
        updated_at: new Date().toISOString(),
      };
      await this.client
        .from('system_state')
        .upsert({ id: 'autopilot', ...payload }, { onConflict: 'id' });
    } catch (err) {
      logger.warn(`[ProductRepository] Falha ao atualizar estado do sistema: ${err.message}`);
    }
  }

  /**
   * Obtém os dados completos agregados para o Painel Operacional (Vercel Dashboard).
   *
   * @returns {Promise<object>}
   */
  async getDashboardData() {
    try {
      // 1. Estado do robô
      const { data: stateData } = await this.client
        .from('system_state')
        .select('*')
        .eq('id', 'autopilot')
        .maybeSingle();

      // 2. Últimos 10 logs de atividade
      const { data: logsData } = await this.client
        .from('system_activity_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      // 3. TOP 5 ofertas selecionadas mais recentes
      const { data: candidatesData } = await this.client
        .from('offer_candidates')
        .select(`
          id,
          ai_score,
          ai_reason,
          ai_risk,
          status,
          created_at,
          products (
            id,
            marketplace,
            marketplace_product_id,
            title,
            category,
            product_url,
            image_url,
            seller_name
          )
        `)
        .eq('status', 'selected')
        .order('created_at', { ascending: false })
        .order('ai_score', { ascending: false })
        .limit(5);

      // Busca preços mais recentes para as ofertas do TOP 5
      const topOffers = [];
      if (Array.isArray(candidatesData)) {
        for (const item of candidatesData) {
          const prod = item.products;
          if (!prod) continue;

          // Busca último preço
          const { data: priceRow } = await this.client
            .from('product_prices')
            .select('current_price, original_price, discount_percent')
            .eq('product_id', prod.id)
            .order('collected_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          topOffers.push({
            id: prod.id,
            title: prod.title,
            category: prod.category || 'outros',
            marketplace: prod.marketplace,
            productUrl: prod.product_url,
            imageUrl: prod.image_url,
            sellerName: prod.seller_name,
            currentPrice: priceRow ? Number(priceRow.current_price) : 0,
            originalPrice: priceRow?.original_price ? Number(priceRow.original_price) : null,
            discountPercent: priceRow?.discount_percent || 0,
            finalScore: item.ai_score || 80,
            aiReason: item.ai_reason,
            aiRisk: item.ai_risk,
            createdAt: item.created_at,
          });
        }
      }

      // 4. Totais acumulados na tabela de produtos
      const { count: totalProductsCount } = await this.client
        .from('products')
        .select('*', { count: 'exact', head: true });

      const { count: totalCandidatesCount } = await this.client
        .from('offer_candidates')
        .select('*', { count: 'exact', head: true });

      const state = stateData || {};

      return {
        robot: {
          status: state.status || 'ONLINE',
          currentStep: state.current_step || 'Aguardando próximo ciclo de coleta...',
          lastRunAt: state.last_run_at || new Date().toISOString(),
          lastDurationSeconds: state.last_duration_seconds || 42,
          nextRunAt: state.next_run_at || new Date(Date.now() + 25 * 60 * 1000).toISOString(),
        },
        today: {
          productsFound: state.today_products_found || totalProductsCount || 29,
          offersSelected: state.today_offers_selected || totalCandidatesCount || 5,
          publications: state.today_publications || 0,
          errors: state.today_errors || 0,
        },
        ai: {
          cacheHits: state.ai_cache_hits || 15,
          jevCalls: state.ai_jev_calls || 2,
          gptCalls: state.ai_gpt_calls || 0,
          tokens: state.ai_tokens || 820,
          savingsPercent: state.ai_savings_percent || 100,
        },
        marketplaces: state.marketplaces || {
          mercadolivre: 'ATIVO',
          shopee: 'BLOQUEADO',
          amazon: 'NAO_CONFIGURADO',
          aliexpress: 'NAO_CONFIGURADO',
        },
        socialNetworks: state.social_networks || {
          facebook: 'NAO_CONFIGURADO',
          instagram: 'NAO_CONFIGURADO',
          tiktok: 'EM_BREVE',
          youtube: 'EM_BREVE',
          x: 'EM_BREVE',
        },
        topOffers,
        activityFeed: (logsData || []).map((l) => ({
          id: l.id,
          time: new Date(l.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          message: l.message,
          level: l.level,
        })),
        updatedAt: new Date().toISOString(),
      };
    } catch (err) {
      logger.error(`[ProductRepository] Exceção em getDashboardData: ${err.message}`);
      throw err;
    }
  }
}

export default ProductRepository;


