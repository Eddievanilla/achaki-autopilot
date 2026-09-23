/**
 * ACHAki Autopilot — OrganicStrategyEngine (Fase 5.4)
 *
 * Motor de Estratégias Orgânicas para seleção de abordagem de conteúdo:
 *  - 10 Estratégias: PRECO, DESCONTO, URGENCIA, CURIOSIDADE, PROBLEMA_SOLUCAO,
 *                    BENEFICIO, COMPARACAO, PROVA_SOCIAL, ACHADINHO, DEMONSTRACAO
 *  - Mapeia atributos reais do produto e categoria para a estratégia de maior tração
 *  - Prepara ganchos (hooks) e chamadas para ação (CTAs) específicos
 */

import logger from '../utils/logger.js';

export const STRATEGY_CATALOG = {
  PRECO: {
    id: 'PRECO',
    name: 'Foco em Preço Baixo',
    objective: 'Impulso Imediato',
    hooks: ['Menos de R$ 50!', 'Preço de banana!', 'Muito barato para o que entrega!'],
    cta: 'Aproveite antes que o preço suba',
  },
  DESCONTO: {
    id: 'DESCONTO',
    name: 'Desconto Real Comprovado',
    objective: 'Percepção de Oportunidade',
    hooks: ['Caiu muito de preço!', 'Economia real comprovada no histórico!'],
    cta: 'Garanta seu desconto agora',
  },
  URGENCIA: {
    id: 'URGENCIA',
    name: 'Gatilho de Urgência',
    objective: 'Conversão Rápida',
    hooks: ['Corre que vai acabar!', 'Últimas unidades com esse valor!'],
    cta: 'Pegue o seu enquanto dura o estoque',
  },
  CURIOSIDADE: {
    id: 'CURIOSIDADE',
    name: 'Gatilho de Curiosidade',
    objective: 'Cliques e Engajamento',
    hooks: ['Você não sabia que precisava disso!', 'O que esse gadget faz vai te surpreender.'],
    cta: 'Descubra como funciona no link',
  },
  PROBLEMA_SOLUCAO: {
    id: 'PROBLEMA_SOLUCAO',
    name: 'Problema e Solução',
    objective: 'Identificação Direta',
    hooks: ['Cansado de bagunça na cozinha?', 'A solução definitiva para organizar seu espaço.'],
    cta: 'Veja como resolver isso aqui',
  },
  BENEFICIO: {
    id: 'BENEFICIO',
    name: 'Foco no Benefício Prático',
    objective: 'Convencimento Racional',
    hooks: ['Economize tempo e esforço no seu dia a dia.', 'Praticidade que vale cada centavo.'],
    cta: 'Facilite sua rotina com esse item',
  },
  COMPARACAO: {
    id: 'COMPARACAO',
    name: 'Comparativo de Custo-Benefício',
    objective: 'Decisão Qualificada',
    hooks: ['Faz a mesma coisa que a marca cara por 1/3 do preço!', 'Melhor custo-benefício da categoria.'],
    cta: 'Confira o comparativo no link',
  },
  PROVA_SOCIAL: {
    id: 'PROVA_SOCIAL',
    name: 'Validação Social',
    objective: 'Confiança e Credibilidade',
    hooks: ['Mais de 1.000 vendidos e nota quase máxima!', 'Quem comprou não se arrependeu.'],
    cta: 'Veja as avaliações de quem comprou',
  },
  ACHADINHO: {
    id: 'ACHADINHO',
    name: 'Achadinho Exclusivo',
    objective: 'Viralidade e Compartilhamento',
    hooks: ['Achei essa pérola escondida!', 'Garimpo do dia com preço sensacional.'],
    cta: 'Clique para conferir esse achadinho',
  },
  DEMONSTRACAO: {
    id: 'DEMONSTRACAO',
    name: 'Demonstração de Uso',
    objective: 'Retenção e Desejo',
    hooks: ['Olha como isso funciona na prática!', 'Testando a utilidade que todo mundo está comentando.'],
    cta: 'Veja os detalhes e fotos reais',
  },
};

export class OrganicStrategyEngine {
  /**
   * Avalia os atributos reais de um produto e seleciona a estratégia orgânica ideal.
   *
   * @param {object} product - Produto coletado e avaliado
   * @param {object} [context] - Histórico e métricas adicionais
   * @returns {{
   *   strategyId: string,
   *   strategyName: string,
   *   reason: string,
   *   objective: string,
   *   suggestedHook: string,
   *   suggestedCta: string
   * }}
   */
  determineStrategy(product, context = {}) {
    const price = Number(product.currentPrice) || 0;
    const discount = Number(product.announcedDiscount || product.discountPercent || 0);
    const realDiscount = Number(product.realDiscountVsAvg || 0);
    const rating = Number(product.rating) || 0;
    const sold = Number(product.soldCount) || 0;
    const category = (product.category || '').toLowerCase();

    // 1. Prova Social se tiver muitas vendas e avaliação excelente
    if (sold >= 300 && rating >= 4.6) {
      const s = STRATEGY_CATALOG.PROVA_SOCIAL;
      return {
        strategyId: s.id,
        strategyName: s.name,
        reason: `Produto com alta validação social: ${sold}+ vendidos e nota ${rating} estrelas.`,
        objective: s.objective,
        suggestedHook: `Mais de ${sold} unidades vendidas e nota ${rating}!`,
        suggestedCta: s.cta,
      };
    }

    // 2. Preço de Impulso se for muito barato (< R$ 45)
    if (price > 0 && price <= 45) {
      const s = STRATEGY_CATALOG.PRECO;
      return {
        strategyId: s.id,
        strategyName: s.name,
        reason: `Preço altamente acessível de R$ ${price.toFixed(2)}, ideal para compra impulsiva sem fricção.`,
        objective: s.objective,
        suggestedHook: `Por apenas R$ ${price.toFixed(2)}, nem dá para pensar duas vezes!`,
        suggestedCta: s.cta,
      };
    }

    // 3. Desconto se houver quebra expressiva de preço
    if (discount >= 30 || realDiscount >= 20) {
      const s = STRATEGY_CATALOG.DESCONTO;
      const descText = discount >= 30 ? `${discount}% anunciado` : `${realDiscount}% sobre média histórica`;
      return {
        strategyId: s.id,
        strategyName: s.name,
        reason: `Vantagem de preço comprovada com desconto expressivo de ${descText}.`,
        objective: s.objective,
        suggestedHook: `Oportunidade real com ${discount || realDiscount}% de desconto hoje!`,
        suggestedCta: s.cta,
      };
    }

    // 4. Problema e Solução para itens de organização e utilidades domésticas
    if (category.includes('organiza') || category.includes('cozinha') || category.includes('casa')) {
      const s = STRATEGY_CATALOG.PROBLEMA_SOLUCAO;
      return {
        strategyId: s.id,
        strategyName: s.name,
        reason: `Item focado em resolver desorganização e otimizar rotina doméstica.`,
        objective: s.objective,
        suggestedHook: `Cansado de perder tempo com desorganização? Olha essa solução prática.`,
        suggestedCta: s.cta,
      };
    }

    // 5. Curiosidade e Gadgets para itens de tecnologia
    if (category.includes('tecno') || category.includes('gadget') || category.includes('ferramenta')) {
      const s = STRATEGY_CATALOG.CURIOSIDADE;
      return {
        strategyId: s.id,
        strategyName: s.name,
        reason: `Gadget com apelo de novidade e interesse funcional.`,
        objective: s.objective,
        suggestedHook: `Você sabia que existe um dispositivo compacto que faz isso por R$ ${price.toFixed(2)}?`,
        suggestedCta: s.cta,
      };
    }

    // Fallback natural: ACHADINHO
    const s = STRATEGY_CATALOG.ACHADINHO;
    return {
      strategyId: s.id,
      strategyName: s.name,
      code: s.id,
      id: s.id,
      name: s.name,
      reason: `Achadinho versátil com boa pontuação de conveniência.`,
      objective: s.objective,
      suggestedHook: `Achei essa utilidade incrível e não pude deixar de compartilhar!`,
      suggestedCta: s.cta,
    };
  }

  /**
   * Alias amigável para determineStrategy.
   * @param {object} product
   * @param {object} [context]
   */
  selectStrategyForProduct(product, context = {}) {
    const res = this.determineStrategy(product, context);
    return {
      ...res,
      code: res.strategyId,
      id: res.strategyId,
      name: res.strategyName,
    };
  }

  /**
   * Retorna a lista completa das 10 estratégias catalogadas.
   * @returns {Array<object>}
   */
  listStrategies() {
    return Object.values(STRATEGY_CATALOG);
  }

  /**
   * Obtém detalhes de uma estratégia específica por ID.
   * @param {string} id
   * @returns {object|null}
   */
  getStrategy(id) {
    return STRATEGY_CATALOG[id] || null;
  }
}

export default OrganicStrategyEngine;
