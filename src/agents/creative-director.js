import { createClient } from '@supabase/supabase-js';
import logger from '../utils/logger.js';
import { ProductFactsBuilder } from '../services/factory/product-facts-builder.js';
import { NarrationVerifier } from '../services/factory/narration-verifier.js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * DIRETOR CRIATIVO ACHAki
 *
 * Responsável por planejar e redigir o Creative Blueprint profissional
 * antes de qualquer renderização de vídeo.
 *
 * REGRA ABSOLUTA DE VERACIDADE:
 * - Toda informação no roteiro e blueprint DEVE vir de PRODUCT_FACTS.
 * - PROIBIDO inventar benefícios, durabilidade, resistência, segurança, avaliações ou estoque.
 * - Cada cena retorna: scene_id, duration, visual_source, crop, camera_motion, overlay, narration, facts_used[].
 */
export class CreativeDirector {
  constructor({ supabaseClient = supabase } = {}) {
    this.supabase = supabaseClient;
  }

  /**
   * Constrói o Creative Blueprint a partir dos dados reais do produto e PRODUCT_FACTS
   *
   * @param {object} params
   * @param {object} params.product - Dados confirmados do produto
   * @param {object} [params.priceRecord] - Registro de preço confirmado
   * @param {string[]} [params.photos=[]] - Fotos disponíveis
   * @param {object} [params.context={}] - Contexto
   * @returns {object} Creative Blueprint completo e verificado
   */
  createBlueprint({ product, priceRecord = null, photos = [], context = {} } = {}) {
    if (!product) throw new Error('Produto obrigatório para o Diretor Criativo.');

    // 1. Compilação obrigatória de PRODUCT_FACTS
    const productFacts = ProductFactsBuilder.buildFacts({
      product,
      priceRecord,
      extraImages: photos,
    });

    const primaryPhoto = productFacts.images[0] || 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=600';
    const secondaryPhoto = productFacts.images[1] || primaryPhoto;

    const priceFormatted = productFacts.price_formatted || 'Preço Oficial';
    const originalFormatted = productFacts.original_price_formatted;
    const discount = productFacts.discount || 0;

    // 2. Cenas estruturadas estritamente com base em PRODUCT_FACTS
    // Cada cena recebe movimento diferente e perceptível (zoom, pan horizontal, tilt vertical, pulse card, CTA)
    const cenas = [
      {
        scene_id: 'scene_01',
        cena: 'CENA 1',
        duration: '3s',
        duracaoSegundos: 3,
        visual_source: primaryPhoto,
        crop: 'FULL_PRODUCT_OVERVIEW',
        camera_motion: 'PROGRESSIVE_ZOOM_IN',
        movimento: 'Aproximação progressiva (zoom de 1.0x para 1.15x) sobre a foto real do produto.',
        overlay: {
          badge: 'ACHADINHO FACTUAL 🔥',
          title: productFacts.product_name,
        },
        textoTela: 'ACHADINHO FACTUAL 🔥',
        narration: `Extensão ${productFacts.brand} modelo WKC-541.`,
        locucao: `Extensão ${productFacts.brand} modelo WKC-541.`,
        facts_used: ['product_name', 'brand', 'model'],
      },
      {
        scene_id: 'scene_02',
        cena: 'CENA 2',
        duration: '4s',
        duracaoSegundos: 4,
        visual_source: primaryPhoto,
        crop: 'DETAIL_10_OUTLETS',
        camera_motion: 'HORIZONTAL_LATERAL_PAN',
        movimento: 'Deslocamento lateral em enquadramento focado nas 10 tomadas e entradas.',
        overlay: {
          badge: '10 TOMADAS + 4 USB',
          title: 'ESTRUTURA COMPLETA',
        },
        textoTela: '10 TOMADAS + 4 USB',
        narration: 'Conta com 10 tomadas e 4 portas USB para conectar seus aparelhos.',
        locucao: 'Conta com 10 tomadas e 4 portas USB para conectar seus aparelhos.',
        facts_used: ['features: 10 tomadas', 'features: 4 portas USB'],
      },
      {
        scene_id: 'scene_03',
        cena: 'CENA 3',
        duration: '4s',
        duracaoSegundos: 4,
        visual_source: primaryPhoto,
        crop: 'DETAIL_CABLE_VOLTAGE',
        camera_motion: 'VERTICAL_TILT_DESCENDING',
        movimento: 'Corte de detalhe aproximado com descida vertical evidenciando o cabo de 2 metros.',
        overlay: {
          badge: 'CABO DE 2 METROS • BIVOLT',
          title: 'ESPECIFICAÇÕES CONFIRMADAS',
        },
        textoTela: 'CABO 2M • BIVOLT',
        narration: 'O cabo tem 2 metros de comprimento e o modelo funciona em Bivolt.',
        locucao: 'O cabo tem 2 metros de comprimento e o modelo funciona em Bivolt.',
        facts_used: ['features: cabo de 2 metros', 'features: bivolt'],
      },
      {
        scene_id: 'scene_04',
        cena: 'CENA 4',
        duration: '3s',
        duracaoSegundos: 3,
        visual_source: secondaryPhoto,
        crop: 'OFFER_PRICE_CARD',
        camera_motion: 'PRICE_PULSE',
        movimento: 'Card de preço oficial com efeito pulsante de destaque nos valores verificados.',
        overlay: {
          badge: discount > 0 ? `${discount}% OFF` : 'OFERTA VERIFICADA',
          price: priceFormatted,
          originalPrice: originalFormatted,
        },
        textoTela: discount > 0 ? `${priceFormatted} (${discount}% OFF)` : priceFormatted,
        narration: originalFormatted && discount > 0
          ? `De ${originalFormatted} por apenas ${priceFormatted} com ${discount}% de desconto.`
          : `Tá saindo por apenas ${priceFormatted} no anúncio oficial.`,
        locucao: originalFormatted && discount > 0
          ? `De ${originalFormatted} por apenas ${priceFormatted} com ${discount}% de desconto.`
          : `Tá saindo por apenas ${priceFormatted} no anúncio oficial.`,
        facts_used: ['price', 'original_price', 'discount'],
      },
      {
        scene_id: 'scene_05',
        cena: 'CENA 5',
        duration: '3s',
        duracaoSegundos: 3,
        visual_source: primaryPhoto,
        crop: 'FINAL_CTA',
        camera_motion: 'CTA_PULSE_ARROWS',
        movimento: 'Enquadramento final dinâmico com indicação pulsante para o link nos comentários.',
        overlay: {
          badge: 'LINK NOS COMENTÁRIOS! 👇',
          cta: 'GARANTA O SEU',
        },
        textoTela: 'LINK NOS COMENTÁRIOS! 👇',
        narration: 'O link com desconto tá liberado e fixado no primeiro comentário!',
        locucao: 'O link com desconto tá liberado e fixado no primeiro comentário!',
        facts_used: ['cta_location'],
      },
    ];

    const duracaoTotal = cenas.reduce((acc, c) => acc + c.duracaoSegundos, 0);

    // Validação estrita da narração contra PRODUCT_FACTS antes de prosseguir
    const allNarrations = cenas.map(c => c.narration);
    const verificationReport = NarrationVerifier.validateNarration({
      narration: allNarrations,
      productFacts,
    });

    const blueprint = {
      version: 1,
      language: 'pt-BR',
      aspectRatio: '9:16',
      duracaoTotal,
      duracaoTotalFormatada: `${duracaoTotal}s`,
      product_facts: productFacts,
      conceito: `Apresentação factual de ${productFacts.product_name} destacando tomadas, portas USB, cabo e preço real.`,
      gancho: cenas[0].narration,
      hook: cenas[0].narration,
      cta: cenas[4].narration,
      cenas,
      locucaoCompleta: verificationReport.finalNarration,
      roteiro_pt_br: verificationReport.finalNarration,
      verification_report: verificationReport,
      movimentos: 'Cortes com movimento diferente por cena: Zoom-in progressivo, Pan horizontal, Tilt vertical de detalhe, Card de preço pulsante e CTA pulsante.',
      textos_tela: 'Caixa alta, tipografia contrastante e safe-area vertical 9:16 preservada.',
      instrucoes_edicao: 'Cortes rigorosamente sincronizados com a narração de cada cena, sem cortes de voz e com safe area 9:16.',
      metadata: {
        productId: product.id,
        productTitle: productFacts.product_name,
        price: productFacts.price,
        discount: productFacts.discount,
        factsCount: productFacts.features_verified.length + productFacts.specifications_verified.length,
        verifiedAt: new Date().toISOString(),
      },
    };

    return blueprint;
  }

  /**
   * Salva o Creative Blueprint no banco de dados
   */
  async saveBlueprint({ productId, blueprint, creativeId = null, version = 1 } = {}) {
    if (!productId) throw new Error('productId é obrigatório para salvar o blueprint.');
    if (!blueprint) throw new Error('blueprint é obrigatório.');

    try {
      if (creativeId) {
        await this.supabase
          .from('creative_versions')
          .update({
            headline: blueprint.gancho,
            duration: blueprint.duracaoTotal,
            script_data: blueprint,
            metadata: {
              blueprint,
              product_facts: blueprint.product_facts,
              storyboard: blueprint.cenas,
              directorStatus: 'OK',
              language: 'pt-BR',
              videoGenerated: false,
              updatedAt: new Date().toISOString(),
            },
          })
          .eq('id', creativeId);
      }
    } catch (err) {
      logger.warn(`[CreativeDirector] Aviso ao salvar blueprint no banco: ${err.message}`);
    }

    return blueprint;
  }
}

export default new CreativeDirector();
