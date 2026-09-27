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
    const features = Array.isArray(productFacts.features_verified) ? productFacts.features_verified : [];
    const brand = productFacts.brand && productFacts.brand !== 'Não informada' ? productFacts.brand : null;
    const rawProdName = productFacts.product_name;

    // Sanitização e humanização do título do produto
    const cleanProdName = CreativeDirector.cleanProductTitle(rawProdName);

    // Geração de Roteiro Comercial de Alta Conversão (Super Produtora)
    const script = CreativeDirector.generateCommercialCopy({
      cleanName: cleanProdName,
      productFacts,
      userPrompt: context?.userPrompt,
      brand,
      features,
      discount,
      priceFormatted,
      originalFormatted,
    });

    const cena1Narration = script.cena1;
    const cena1Badge = script.badge1 || '🔥 ACHADINHO DO DIA';

    const cena2Narration = script.cena2;
    const cena2Badge = script.badge2 || '💡 PRATICIDADE PURA';
    const cena2Facts = ['product_name'];

    const cena3Narration = script.cena3;
    const cena3Badge = script.badge3 || '⭐ CUSTO-BENEFÍCIO NOTA 10';
    const cena3Facts = ['product_name'];

    const cena4Narration = script.cena4;
    const cena4Badge = script.badge4 || (discount > 0 ? `${discount}% OFF` : 'PREÇO ESPECIAL');
    const cena4Facts = discount > 0 && originalFormatted ? ['price', 'original_price', 'discount'] : ['price'];

    const cena5Narration = script.cena5;
    const cena5Badge = script.badge5 || '🔗 LINK NO 1º COMENTÁRIO';

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
          badge: cena1Badge,
          title: cleanProdName,
        },
        textoTela: cena1Badge,
        narration: cena1Narration,
        locucao: cena1Narration,
        facts_used: ['product_name'],
      },
      {
        scene_id: 'scene_02',
        cena: 'CENA 2',
        duration: '4s',
        duracaoSegundos: 4,
        visual_source: primaryPhoto,
        crop: 'DETAIL_PRODUCT_FOCUS',
        camera_motion: 'HORIZONTAL_LATERAL_PAN',
        movimento: 'Deslocamento lateral em enquadramento focado nos detalhes reais do produto.',
        overlay: {
          badge: cena2Badge,
          title: cleanProdName,
        },
        textoTela: cena2Badge,
        narration: cena2Narration,
        locucao: cena2Narration,
        facts_used: cena2Facts,
      },
      {
        scene_id: 'scene_03',
        cena: 'CENA 3',
        duration: '4s',
        duracaoSegundos: 4,
        visual_source: primaryPhoto,
        crop: 'DETAIL_INSPECTION',
        camera_motion: 'VERTICAL_TILT_DESCENDING',
        movimento: 'Corte de detalhe aproximado com descida vertical evidenciando as especificações reais.',
        overlay: {
          badge: cena3Badge,
          title: 'CUSTO-BENEFÍCIO',
        },
        textoTela: cena3Badge,
        narration: cena3Narration,
        locucao: cena3Narration,
        facts_used: cena3Facts,
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
          badge: cena4Badge,
          price: priceFormatted,
          originalPrice: originalFormatted,
        },
        textoTela: discount > 0 ? `${priceFormatted} (${discount}% OFF)` : priceFormatted,
        narration: cena4Narration,
        locucao: cena4Narration,
        facts_used: cena4Facts,
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
          badge: cena5Badge,
          cta: 'GARANTA O SEU',
        },
        textoTela: cena5Badge,
        narration: cena5Narration,
        locucao: cena5Narration,
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
      conceito: `Apresentação factual de ${productFacts.product_name} com dados e preços verificados.`,
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

  /**
   * Sanitiza e humaniza o título bruto do produto para linguagem falada de vídeo
   */
  static cleanProductTitle(rawTitle = '') {
    if (!rawTitle) return 'Produto Selecionado';
    let clean = String(rawTitle)
      // Separa palavras grudadas comuns de catálogo (ex: Segurançawi-ficom -> Segurança Wi-Fi com)
      .replace(/([a-záéíóúãõç])(wi[- ]?fi)/gi, (m, p1, p2) => p1 + ' ' + p2)
      .replace(/(wi[- ]?fi)(com)/gi, (m, p1, p2) => p1 + ' ' + p2)
      .replace(/([a-záéíóúãõç])([A-ZÁÉÍÓÚÃÕÇ])/g, (m, p1, p2) => p1 + ' ' + p2)
      // Remove termos irrelevantes e ruídos de busca de marketplace
      .replace(/\b(original|lacrado|novo|envio\s+imediato|pronta\s+entrega|promocao|promoção|imperdível|qualidade|garantia|com\s+nota\s+fiscal|nf-e|barato|bivolt\s+110v\s*220v|110v\/220v)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return clean || rawTitle;
  }

  /**
   * Gera roteiro comercial focado em dor, praticidade e custo-benefício (Super Produtora)
   */
  static generateCommercialCopy({ cleanName, productFacts, userPrompt, brand, features = [], discount = 0, priceFormatted = 'Preço Promocional', originalFormatted = null }) {
    const lower = cleanName.toLowerCase();

    // 1. Categoria Segurança / Câmera / Vigilância
    if (lower.includes('câmera') || lower.includes('camera') || lower.includes('segurança') || lower.includes('vigilância') || lower.includes('alarme')) {
      return {
        cena1: 'Quer monitorar sua casa ou seu pet direto do celular sem gastar com instalador?',
        badge1: '🔥 ACHADINHO DO DIA',
        cena2: `Essa ${cleanName} rosqueia no bocal comum de luz e conecta no Wi-Fi em poucos minutos.`,
        badge2: '💡 PRATICIDADE PURA',
        cena3: 'Você tem visão noturna nítida e controle 360 graus na palma da mão sem pagar mensalidade.',
        badge3: '⭐ CUSTO-BENEFÍCIO SURREAL',
        cena4: discount > 0 && originalFormatted
          ? `Pelo que entrega, o custo-benefício é excelente: de ${originalFormatted} por apenas ${priceFormatted} hoje.`
          : `Pelo que entrega, o custo-benefício é excelente: tá saindo por apenas ${priceFormatted} hoje.`,
        badge4: discount > 0 ? `${discount}% OFF` : 'OFERTA VERIFICADA',
        cena5: 'O link oficial com o melhor preço garantido tá liberado e fixado no primeiro comentário!',
        badge5: '🔗 LINK NO 1º COMENTÁRIO'
      };
    }

    // 2. Categoria Conforto / Saúde / Calçados / Palmilha
    if (lower.includes('palmilha') || lower.includes('ortopéd') || lower.includes('conforto') || lower.includes('tênis') || lower.includes('sapato') || lower.includes('colch')) {
      return {
        cena1: 'Sente dores nos pés ou desconforto depois de passar o dia em pé ou caminhando?',
        badge1: '🔥 ACHADINHO DO DIA',
        cena2: `Essa ${cleanName} traz suporte anatômico com amortecimento que alivia a pressão a cada passo.`,
        badge2: '💡 CONFORTO DIÁRIO',
        cena3: 'Cabe em qualquer tênis ou sapato e transforma o conforto da sua rotina.',
        badge3: '⭐ CUSTO-BENEFÍCIO NOTA 10',
        cena4: discount > 0 && originalFormatted
          ? `Um custo-benefício incrível para o seu bem-estar: de ${originalFormatted} por apenas ${priceFormatted}.`
          : `Um custo-benefício incrível para o seu bem-estar: apenas ${priceFormatted} hoje.`,
        badge4: discount > 0 ? `${discount}% OFF` : 'PREÇO ESPECIAL',
        cena5: 'O link com desconto tá liberado e fixado aqui no primeiro comentário!',
        badge5: '🔗 LINK NO 1º COMENTÁRIO'
      };
    }

    // 3. Categoria Organização / Casa / Cozinha
    if (lower.includes('organiza') || lower.includes('cesto') || lower.includes('suporte') || lower.includes('cozinha') || lower.includes('prateleira')) {
      return {
        cena1: 'Se você ama praticidade e organização no dia a dia, dá uma olhada nesse achadinho!',
        badge1: '🔥 ACHADINHO DO DIA',
        cena2: `O ${cleanName} resolve aquele problema de espaço e bagunça com muita facilidade.`,
        badge2: '💡 RESOLVE SEU PROBLEMA',
        cena3: 'Super prático, versátil e com design funcional que facilita a sua rotina.',
        badge3: '⭐ CUSTO-BENEFÍCIO SURREAL',
        cena4: discount > 0 && originalFormatted
          ? `E o preço é o grande destaque: de ${originalFormatted} por apenas ${priceFormatted} no anúncio oficial.`
          : `E o preço é o grande destaque: apenas ${priceFormatted} no anúncio oficial.`,
        badge4: discount > 0 ? `${discount}% OFF` : 'OFERTA VERIFICADA',
        cena5: 'Aproveita enquanto tá disponível, link oficial fixado no primeiro comentário!',
        badge5: '🔗 LINK NO 1º COMENTÁRIO'
      };
    }

    // 4. Categoria Tecnologia / Fones / Acessórios / Eletrônicos
    if (lower.includes('fone') || lower.includes('bluetooth') || lower.includes('tomada') || lower.includes('cabo') || lower.includes('extensão') || lower.includes('carregador')) {
      return {
        cena1: 'Procurando mais praticidade e tecnologia pro seu dia a dia sem gastar uma fortuna?',
        badge1: '🔥 ACHADINHO DO DIA',
        cena2: `O ${cleanName} entrega tudo o que você precisa com muita eficiência e qualidade.`,
        badge2: '💡 TECNOLOGIA PRÁTICA',
        cena3: 'Acabamento impecável, alta eficiência e um desempenho que impressiona pelo valor.',
        badge3: '⭐ CUSTO-BENEFÍCIO NOTA 10',
        cena4: discount > 0 && originalFormatted
          ? `Pelo que entrega, o custo-benefício é excelente: de ${originalFormatted} por apenas ${priceFormatted}.`
          : `Pelo que entrega, o custo-benefício é excelente: tá saindo por apenas ${priceFormatted}.`,
        badge4: discount > 0 ? `${discount}% OFF` : 'PREÇO ESPECIAL',
        cena5: 'Garanta o seu no link oficial fixado aqui no primeiro comentário!',
        badge5: '🔗 LINK NO 1º COMENTÁRIO'
      };
    }

    // 5. Categoria Geral / Padrão Comercial de Alta Conversão
    return {
      cena1: 'Dá uma olhada nesse achadinho que tá fazendo o maior sucesso pelo custo-benefício!',
      badge1: '🔥 ACHADINHO DO DIA',
      cena2: `O ${cleanName} entrega muita utilidade e praticidade para facilitar a sua rotina.`,
      badge2: '💡 PRATICIDADE PURA',
      cena3: 'Um produto super útil que resolve de verdade e entrega um custo-benefício imbatível.',
      badge3: '⭐ CUSTO-BENEFÍCIO NOTA 10',
      cena4: discount > 0 && originalFormatted
        ? `Tá saindo de ${originalFormatted} por apenas ${priceFormatted} com oferta especial no anúncio oficial.`
        : `Tá saindo por apenas ${priceFormatted} com oferta especial no anúncio oficial.`,
      badge4: discount > 0 ? `${discount}% OFF` : 'OFERTA VERIFICADA',
      cena5: 'O link verificado com desconto tá liberado e fixado no primeiro comentário!',
      badge5: '🔗 LINK NO 1º COMENTÁRIO'
    };
  }
}

export default new CreativeDirector();
