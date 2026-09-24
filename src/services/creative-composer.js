/**
 * ACHAki Autopilot — CreativeComposer
 *
 * Analisa os assets de mídia oficiais disponíveis para um produto e determina
 * o melhor formato e composição para as campanhas orgânicas.
 *
 * FORMATOS SUPORTADOS:
 *  - SINGLE_IMAGE: Imagem única com foco comercial específico
 *  - MULTI_IMAGE: Conjunto de imagens oficiais do anúncio
 *  - CAROUSEL: Carrossel de ângulos do produto
 *  - VIDEO: Vídeo oficial do produto (somente quando legítimo e disponível)
 *
 * ÂNGULOS COMERCIAIS:
 *  - DEMANDA: Foco no alto volume de busca e interesse imediato
 *  - PROBLEMA_SOLUCAO: Foco na utilidade prática e resolução de dor
 *  - IMPULSO: Foco em preço baixo e facilidade de compra
 *  - CUSTO_BENEFICIO: Foco em durabilidade e entrega de valor
 *  - DESCONTO: Foco em economia percentual real comprovada
 *  - PROVA_SOCIAL: Foco em avaliações positivas e confiabilidade
 */

import { supabase } from '../database/supabase.js';
import logger from '../utils/logger.js';

export class CreativeComposer {
  /**
   * @param {object} [options]
   * @param {import('@supabase/supabase-js').SupabaseClient} [options.supabaseClient]
   */
  constructor({ supabaseClient = supabase } = {}) {
    this.supabase = supabaseClient;
  }

  /**
   * Determina o ângulo comercial com base nas características reais do produto.
   *
   * @param {object} product
   * @param {object} [context]
   * @returns {string}
   */
  determineCommercialAngle(product, context = {}) {
    const currentPrice = Number(product.current_price || product.price || 0);
    const discount = Number(product.discount_percent || product.discount || 0);
    const category = (product.category || '').toLowerCase();
    const strategy = context.strategy?.code || context.strategy || '';

    if (strategy === 'DEMANDA' || context.demandKeyword) {
      return 'DEMANDA';
    }
    if (discount >= 30 || strategy === 'DESCONTO') {
      return 'DESCONTO';
    }
    if (currentPrice > 0 && currentPrice <= 45) {
      return 'IMPULSO';
    }
    if (category.includes('cozinha') || category.includes('organização') || category.includes('casa') || category.includes('ferramentas')) {
      return 'PROBLEMA_SOLUCAO';
    }
    if (product.rating && product.rating >= 4.6) {
      return 'PROVA_SOCIAL';
    }
    return 'CUSTO_BENEFICIO';
  }

  /**
   * Compõe a estratégia de criativo para uma publicação.
   *
   * @param {object} params
   * @param {object} params.product - Produto validado
   * @param {string} [params.channel='Facebook'] - Canal de publicação
   * @param {object} [params.context] - Contexto de estratégia e meta
   * @returns {Promise<{
   *   format: 'SINGLE_IMAGE' | 'MULTI_IMAGE' | 'CAROUSEL' | 'VIDEO',
   *   selectedAssets: Array<object>,
   *   primaryAsset: object,
   *   commercialAngle: string,
   *   decisionRationale: string,
   *   assetsSummary: { images: number, videos: number, videoAvailable: boolean }
   * }>}
   */
  async composeCreative({ product, channel = 'Facebook', context = {} }) {
    if (!product || !product.id) {
      throw new Error('Produto inválido para CreativeComposer');
    }

    // 1. Busca todos os assets oficiais disponíveis do produto
    const { data: rawAssets } = await this.supabase
      .from('creative_assets')
      .select('*')
      .eq('product_id', product.id)
      .eq('usage_status', 'AVAILABLE')
      .order('created_at', { ascending: false });

    const assets = rawAssets || [];
    const imageAssets = assets.filter(a => a.type === 'IMAGE');
    const videoAssets = assets.filter(a => a.type === 'VIDEO');

    // 2. Busca histórico de uso recente desses assets para evitar repetições
    const assetIds = assets.map(a => a.id);
    let usageMap = new Map();
    if (assetIds.length > 0) {
      const { data: usages } = await this.supabase
        .from('creative_usage')
        .select('asset_id, used_at')
        .in('asset_id', assetIds)
        .order('used_at', { ascending: false });

      for (const u of (usages || [])) {
        const count = (usageMap.get(u.asset_id) || 0) + 1;
        usageMap.set(u.asset_id, count);
      }
    }

    const angle = this.determineCommercialAngle(product, context);

    let format = 'SINGLE_IMAGE';
    let selectedAssets = [];
    let decisionRationale = '';

    // Regra A: Se houver vídeo oficial legítimo e o canal suportar
    if (videoAssets.length > 0 && channel === 'Facebook') {
      const bestVideo = videoAssets[0];
      const videoUses = usageMap.get(bestVideo.id) || 0;
      if (videoUses < 3) {
        format = 'VIDEO';
        selectedAssets = [bestVideo];
        decisionRationale = 'Vídeo oficial legítimo do produto selecionado para maximizar retenção orgânica.';
      }
    }

    // Regra B: Se o formato não for vídeo, avaliar multi-imagem ou imagem única
    if (format !== 'VIDEO') {
      if (imageAssets.length >= 3 && (angle === 'PROBLEMA_SOLUCAO' || angle === 'DEMANDA')) {
        // Seleciona conjunto de imagens distintas (carrossel / multi-imagem)
        format = 'CAROUSEL';
        selectedAssets = imageAssets.slice(0, 4);
        decisionRationale = `Composição em carrossel com ${selectedAssets.length} imagens oficiais cobrindo diferentes ângulos do produto.`;
      } else if (imageAssets.length > 0) {
        // Ordena por menor número de utilizações para garantir rotação contínua
        const sortedImages = [...imageAssets].sort((a, b) => {
          const usesA = usageMap.get(a.id) || 0;
          const usesB = usageMap.get(b.id) || 0;
          return usesA - usesB;
        });

        format = 'SINGLE_IMAGE';
        selectedAssets = [sortedImages[0]];
        const uses = usageMap.get(sortedImages[0].id) || 0;
        decisionRationale = `Imagem oficial rotacionada (utilizada ${uses} vez(es) anteriormente) focada no ângulo ${angle}.`;
      } else {
        // Fallback: se ainda não houver assets persistidos no bucket, usa a image_url do produto
        format = 'SINGLE_IMAGE';
        selectedAssets = [{
          id: null,
          product_id: product.id,
          type: 'IMAGE',
          storage_url: product.image_url,
          source_url: product.image_url,
          source: 'MARKETPLACE_FALLBACK',
        }];
        decisionRationale = 'Imagem primária do catálogo selecionada como fallback direto.';
      }
    }

    const primaryAsset = selectedAssets[0];

    logger.info(`[CreativeComposer] Composição decidida para "${product.title}": ${format} (${selectedAssets.length} assets) • Ângulo: ${angle}`);

    return {
      format,
      selectedAssets,
      primaryAsset,
      commercialAngle: angle,
      decisionRationale,
      assetsSummary: {
        images: imageAssets.length,
        videos: videoAssets.length,
        videoAvailable: videoAssets.length > 0,
      },
    };
  }

  /**
   * Registra a utilização dos assets e emite evento para o Diário de Decisões.
   *
   * @param {object} params
   * @param {object} params.composition - Resultado de composeCreative
   * @param {string} params.productId
   * @param {string} [params.publicationId]
   * @param {string} [params.channel='Facebook']
   * @returns {Promise<void>}
   */
  async recordCreativeUsage({ composition, productId, publicationId = null, channel = 'Facebook' }) {
    if (!composition || !productId) return;

    try {
      for (const asset of composition.selectedAssets) {
        if (asset.id) {
          await this.supabase.from('creative_usage').insert({
            asset_id: asset.id,
            product_id: productId,
            publication_id: publicationId,
            format: composition.format,
            channel,
            commercial_angle: composition.commercialAngle,
            used_at: new Date().toISOString(),
            metadata: {
              rationale: composition.decisionRationale,
            },
          });
        }
      }

      // Registra no Diário de Decisões (automation_events)
      await this.supabase.from('automation_events').insert({
        product_id: productId,
        event_type: 'CREATIVE_DECISION',
        message: `Composição de criativo: ${composition.format} (${composition.selectedAssets.length} asset(s)). ${composition.decisionRationale}`,
        strategy_id: composition.commercialAngle,
        details: {
          tag: 'CRIATIVO',
          format: composition.format,
          commercialAngle: composition.commercialAngle,
          rationale: composition.decisionRationale,
          assetsCount: composition.assetsSummary,
          primaryAssetUrl: composition.primaryAsset?.storage_url || composition.primaryAsset?.source_url,
        },
        created_at: new Date().toISOString(),
      });

      logger.info(`[CreativeComposer] ✔ Decisão de criativo registrada no Diário e no histórico de uso.`);
    } catch (err) {
      logger.warn(`[CreativeComposer] Exceção não impeditiva ao registrar uso de criativo: ${err.message}`);
    }
  }
}

export default CreativeComposer;
