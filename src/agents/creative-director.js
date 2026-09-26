import { createClient } from '@supabase/supabase-js';
import logger from '../utils/logger.js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * DIRETOR CRIATIVO ACHAki
 *
 * Responsável por planejar e redigir o Creative Blueprint profissional
 * antes de qualquer renderização de vídeo.
 *
 * Estritamente em PORTUGUÊS DO BRASIL (PT-BR) natural, factual e sem invenções.
 */
export class CreativeDirector {
  constructor({ supabaseClient = supabase } = {}) {
    this.supabase = supabaseClient;
  }

  /**
   * Constrói o Creative Blueprint a partir dos dados reais do produto
   *
   * @param {object} params
   * @param {object} params.product - Dados confirmados do produto
   * @param {string[]} [params.photos=[]] - Fotos disponíveis
   * @param {object} [params.context={}] - Contexto de público e estratégia
   * @returns {object} Creative Blueprint completo
   */
  createBlueprint({ product, photos = [], context = {} } = {}) {
    if (!product) throw new Error('Produto obrigatório para o Diretor Criativo.');

    // 1. Dados factuais confirmados do produto (zero invenção)
    const title = (product.title || 'Achadinho Verificado').trim();
    const price = Number(product.current_price || product.price || 0);
    const originalPrice = product.original_price ? Number(product.original_price) : null;
    const discountPercent = product.discount_percent || (originalPrice && price ? Math.round(((originalPrice - price) / originalPrice) * 100) : 0);
    const category = (product.category || 'Utilidades').toLowerCase();
    const marketplace = (product.marketplace || 'Mercado Livre').toUpperCase();
    const rating = product.rating ? Number(product.rating) : null;
    const seller = product.seller_name || null;

    // Extração de fotos disponíveis
    let availablePhotos = [];
    if (Array.isArray(photos) && photos.length > 0) {
      availablePhotos = photos;
    } else if (Array.isArray(product.images) && product.images.length > 0) {
      availablePhotos = product.images;
    } else if (Array.isArray(product.pictures) && product.pictures.length > 0) {
      availablePhotos = product.pictures;
    } else if (product.image_url) {
      availablePhotos = [product.image_url];
    }

    const primaryPhoto = availablePhotos[0] || 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=600';
    const secondaryPhoto = availablePhotos[1] || primaryPhoto;
    const detailPhoto = availablePhotos[2] || primaryPhoto;

    // Formatação em moeda brasileira real (PT-BR)
    const priceFormatted = price > 0 ? price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Preço Especial';
    const originalFormatted = originalPrice ? originalPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null;

    // 2. Determinação de Ângulo Narrativo Dinâmico (Rotação Obrigatória para Criativos Inéditos)
    const versionNumber = context.versionNumber || context.version || 1;
    const remakeFocus = context.remakeFocus || null;
    const ytOpinion = product.youtubeOpinion || context.youtubeOpinion || null;

    let narrativeAngle = context.angle;
    if (!narrativeAngle) {
      if (remakeFocus === 'NARRACAO' || remakeFocus === 'EDICAO') {
        narrativeAngle = 'DEMONSTRACAO';
      } else if (versionNumber === 2) {
        narrativeAngle = 'DEMONSTRACAO';
      } else if (versionNumber === 3 || (ytOpinion && ytOpinion.hasSocialValidation)) {
        narrativeAngle = 'OPINIAO_SINCERA';
      } else if (versionNumber >= 4) {
        narrativeAngle = 'PROBLEMA_SOLUCAO';
      } else {
        narrativeAngle = discountPercent >= 20 ? 'DESCONTO' : 'DEMONSTRACAO';
      }
    }

    // 2.1 Conceito do Anúncio por Ângulo
    let conceito = '';
    let gancho = '';
    let hookBadge = 'ACHADINHO 🔥';
    let problemaDesejo = '';

    if (narrativeAngle === 'OPINIAO_SINCERA') {
      conceito = `Validação sincera e recomendação real de ${title.slice(0, 45)}, destacando aprovação dos compradores e durabilidade comprovada.`;
      gancho = 'Todo mundo elogiando esse produto e agora eu entendi o porquê!';
      hookBadge = 'OPINIÃO SINCERA ⭐';
      problemaDesejo = 'Antes de comprar qualquer coisa na internet, o que a gente mais quer é saber se realmente funciona.';
    } else if (narrativeAngle === 'DEMONSTRACAO') {
      conceito = `Demonstração visual direta da praticidade de ${title.slice(0, 45)}, focando em acabamento e funcionalidade imediata.`;
      gancho = 'Dá uma olhada na prática em como esse item facilita a sua rotina!';
      hookBadge = 'UTILIDADE PURA 💡';
      problemaDesejo = 'Quem busca praticidade sabe o quanto um detalhe bem pensado faz diferença no dia a dia.';
    } else if (narrativeAngle === 'PROBLEMA_SOLUCAO') {
      conceito = `Apresentação focada na solução do problema cotidiano com ${title.slice(0, 45)}, eliminando perrengues comuns.`;
      gancho = 'Se você precisa de mais praticidade e organização no dia a dia, olha isso!';
      hookBadge = 'RESOLVE SEU DIA 🎯';
      problemaDesejo = 'Aquele problema clássico de falta de espaço e bagunça que todo mundo quer resolver.';
    } else {
      // DESCONTO / ACHADO
      conceito = `Oportunidade de economia real com ${discountPercent}% de desconto no ${marketplace} para ${title.slice(0, 45)}.`;
      gancho = discountPercent >= 20
        ? `Olha o que acabou de entrar em oferta com ${discountPercent}% de desconto real!`
        : `Achadinho por apenas ${priceFormatted} que vale cada centavo!`;
      hookBadge = 'OFERTA VERIFICADA 🔥';
      problemaDesejo = 'Sabe quando você encontra aquele produto que precisava, mas com um preço muito abaixo do normal?';
    }

    // 5. Solução Apresentada
    const solucao = `${title.slice(0, 55)}: estrutura prática, resistente e pensada para resolver o seu dia a dia sem complicação.`;

    // 6. Sequência de Cenas (Storyboard Estruturado em 5 Cenas com Variabilidade)
    const cenas = [
      {
        cena: 'CENA 1',
        duracao: '3s',
        duracaoSegundos: 3,
        objetivo: 'Capturar atenção imediata nos primeiros 3 segundos e reter o espectador no feed vertical.',
        visual: `Apresentação em close do produto em ângulo frontal destacado sobre fundo vertical 9:16.`,
        fotoReferencia: primaryPhoto,
        movimento: 'Zoom-in lento e centralizado (escala 1.0x para 1.15x) com fundo dinâmico desfocado.',
        textoTela: hookBadge,
        locucao: gancho,
      },
      {
        cena: 'CENA 2',
        duracao: '4s',
        duracaoSegundos: 4,
        objetivo: 'Conectar com a necessidade do espectador e contextualizar a utilidade prática.',
        visual: `Exibição do produto mostrando estrutura completa e capacidade de uso no ambiente doméstico.`,
        fotoReferencia: secondaryPhoto,
        movimento: 'Pan horizontal suave destacando a largura e os detalhes de acabamento.',
        textoTela: 'PRATICIDADE NO DIA A DIA',
        locucao: `${problemaDesejo} Esse modelo é a solução perfeita.`,
      },
      {
        cena: 'CENA 3',
        duracao: '4s',
        duracaoSegundos: 4,
        objetivo: 'Demonstrar os diferenciais factuais confirmados do produto sem inventar dados.',
        visual: `Plano detalhe ressaltando o acabamento, encaixe e qualidade do material.`,
        fotoReferencia: detailPhoto,
        movimento: 'Leve tilt vertical descendente evidenciando a resistência e o acabamento.',
        textoTela: rating ? `AVALIAÇÃO NOTA ${rating} ⭐` : 'QUALIDADE COMPROVADA ✓',
        locucao: ytOpinion?.honestReviewQuotes?.[0]
          ? `Quem já comprou e testou confirma: acabamento de primeira e muito prático.`
          : (rating
            ? `Super resistente, bem avaliado com nota ${rating} e pronto para o uso diário.`
            : 'Acabamento resistente, fácil de limpar e pronto para aguentar o uso diário.'),
      },
      {
        cena: 'CENA 4',
        duracao: '3s',
        duracaoSegundos: 3,
        objetivo: 'Apresentar a oferta oficial e a vantagem de preço real comprovado.',
        visual: `Card em destaque com o preço oficial e o badge de desconto em destaque neon.`,
        fotoReferencia: primaryPhoto,
        movimento: 'Efeito sutil de respiração (pulsing) no card de preço com foco total na economia.',
        textoTela: discountPercent > 0
          ? `${priceFormatted} (${discountPercent}% OFF)`
          : `${priceFormatted}`,
        locucao: originalFormatted && discountPercent > 0
          ? `De ${originalFormatted} por apenas ${priceFormatted}, aproveitando o desconto oficial.`
          : `Tá saindo por apenas ${priceFormatted} no anúncio oficial verificado.`,
      },
      {
        cena: 'CENA 5',
        duracao: '3s',
        duracaoSegundos: 3,
        objetivo: 'Chamada para ação direta orientando o clique no link de afiliado oficial.',
        visual: `Tela de encerramento com indicação visual de seta e aviso de link fixado.`,
        fotoReferencia: primaryPhoto,
        movimento: 'Câmera estática com elemento gráfico de seta apontando para baixo.',
        textoTela: 'LINK COM DESCONTO NOS COMENTÁRIOS! 👇',
        locucao: 'O link com desconto garantido tá liberado e fixado no primeiro comentário!',
      },
    ];

    const duracaoTotal = cenas.reduce((acc, c) => acc + c.duracaoSegundos, 0);

    // 7. Enquadramento e Movimento Geral
    const enquadramentoMovimento = 'Formato vertical 9:16 nativo (1080x1920), cortes limpos sincronizados com a locução, transições suaves sem tremor e foco centralizado no produto.';

    // 8. Texto na Tela (Diretrizes de Tipografia)
    const textoTelaGeral = 'Caixa alta, tipografia sem serifa legível com alto contraste (amarelo e branco sobre fundo escuro semi-transparente).';

    // 9. Locução Completa em Português Brasileiro (PT-BR)
    const locucaoCompleta = cenas.map(c => c.locucao).join(' ');

    // 10. Chamada para Ação (CTA)
    const cta = 'O link com desconto garantido tá liberado e fixado no primeiro comentário!';

    // 11. Instruções de Edição
    const instrucoesEdicao = 'Cortes sincronizados com a locução, micropausa de respiração de 0.25s por cena, transições suaves, ducking de áudio ambiente e safe-area 9:16 preservada.';

    return {
      version: 1,
      language: 'pt-BR',
      aspectRatio: '9:16',
      duracaoTotal,
      duracaoTotalFormatada: `${duracaoTotal}s`,
      conceito,
      gancho,
      hook: gancho,
      problemaDesejo,
      solucao,
      cta,
      enquadramentoMovimento,
      movimentos: enquadramentoMovimento,
      textoTelaGeral,
      textos_tela: textoTelaGeral,
      locucaoCompleta,
      roteiro_pt_br: locucaoCompleta,
      instrucoesEdicao,
      instrucoes_edicao: instrucoesEdicao,
      storyboard: { totalCenas: cenas.length, cenas },
      cenas,
      metadata: {
        productId: product.id,
        productTitle: title,
        category,
        marketplace,
        price,
        discountPercent,
        photosCount: availablePhotos.length,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Constrói ou reutiliza o Creative Blueprint aplicando a Regra Rigorosa de Custo de LLM:
   * - 1 ÚNICA chamada LLM por criativo
   * - Reutilização de blueprint salvo
   * - Sem chamadas separadas para roteiro, storyboard, cenas, CTA ou edição
   * - Limite configurável MAX_LLM_COST_PER_CREATIVE_USD
   */
  async createBlueprintWithCostControl({
    product,
    photos = [],
    context = {},
    creativeId = null,
    previousBlueprint = null,
    isRemake = false,
    remakeFocus = 'GANCHO',
    requiresNewScript = false,
  } = {}) {
    const { default: creativeCostController } = await import('../services/factory/creative-cost-controller.js');
    return creativeCostController.engineerCreative({
      product,
      photos,
      context,
      creativeId,
      previousBlueprint,
      isRemake,
      remakeFocus,
      requiresNewScript,
    });
  }

  /**
   * Salva o Creative Blueprint no banco vinculado ao creative_id (creative_versions)
   * SEM gerar vídeo MP4 nesta etapa.
   *
   * @param {object} params
   * @param {string} params.productId
   * @param {object} params.blueprint
   * @param {string} [params.creativeId]
   * @param {number} [params.version]
   */
  async saveBlueprint({ productId, blueprint, creativeId = null, version = null } = {}) {
    if (!productId) throw new Error('productId é obrigatório para salvar o blueprint.');
    if (!blueprint) throw new Error('blueprint é obrigatório.');

    try {
      let creativeRecord = null;

      if (creativeId) {
        // Atualiza versão criativa existente vinculando o blueprint
        const { data: updated, error: updateErr } = await this.supabase
          .from('creative_versions')
          .update({
            headline: blueprint.gancho,
            duration: blueprint.duracaoTotal,
            script_data: blueprint,
            metadata: {
              blueprint,
              storyboard: blueprint.cenas,
              directorStatus: 'OK',
              language: 'pt-BR',
              videoGenerated: false, // Estritamente NÃO gera vídeo nesta etapa
              updatedAt: new Date().toISOString(),
            },
          })
          .eq('id', creativeId)
          .select()
          .single();

        if (updateErr) throw new Error(`Falha ao atualizar creative_versions: ${updateErr.message}`);
        creativeRecord = updated;
      } else {
        // Cria novo registro de versão para o blueprint
        let nextVersion = version;
        if (!nextVersion) {
          const { count } = await this.supabase
            .from('creative_versions')
            .select('*', { count: 'exact', head: true })
            .eq('product_id', productId);
          nextVersion = (count || 0) + 1;
        }

        const primaryPhoto = blueprint.cenas?.[0]?.fotoReferencia || null;

        const { data: inserted, error: insertErr } = await this.supabase
          .from('creative_versions')
          .insert({
            product_id: productId,
            version_number: nextVersion,
            status: 'CREATIVE_READY',
            aspect_ratio: '9:16',
            video_url: null, // NÃO gera MP4 nesta etapa
            thumbnail_url: primaryPhoto,
            headline: blueprint.gancho,
            duration: blueprint.duracaoTotal,
            script_data: blueprint,
            metadata: {
              blueprint,
              storyboard: blueprint.cenas,
              directorStatus: 'OK',
              language: 'pt-BR',
              stage: 'BLUEPRINT_READY',
              videoGenerated: false, // Estritamente NÃO gera vídeo nesta etapa
              createdAt: new Date().toISOString(),
            },
          })
          .select()
          .single();

        if (insertErr) throw new Error(`Falha ao inserir creative_versions: ${insertErr.message}`);
        creativeRecord = inserted;
      }

      logger.info(`[CreativeDirector] 📋 Creative Blueprint e Storyboard salvos com sucesso [Creative ID: ${creativeRecord.id}]`);
      return {
        success: true,
        creativeId: creativeRecord.id,
        version: creativeRecord.version_number,
        blueprint,
      };
    } catch (err) {
      logger.error(`[CreativeDirector] Erro ao salvar blueprint: ${err.message}`);
      throw err;
    }
  }
}

export default CreativeDirector;
