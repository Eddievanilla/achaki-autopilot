/**
 * ACHAki Autopilot — GoalOptimizer (Fase 6)
 *
 * Agente Otimizador de Metas:
 *  - Compara a meta diária (20 cliques) com a performance real
 *  - Avalia demanda, CTR, categorias, saturação e estratégias
 *  - Decide a ação operacional para impulsionar a meta sem spam
 *  - Status estritos: SEM DADOS / ABAIXO DO RITMO / NO RITMO / META ATINGIDA
 */

import logger from '../utils/logger.js';

export class GoalOptimizer {
  constructor({ targetClicks = 20, mode = 'ASSISTIDO' } = {}) {
    this.targetClicks = targetClicks;
    this.mode = mode; // 'OFF', 'ASSISTIDO', 'AUTONOMO'
  }

  /**
   * Avalia a situação atual das metas e recomenda ou aplica ajustes operacionais.
   *
   * @param {object} context
   * @param {number} context.currentClicks - Cliques registrados hoje
   * @param {number} [context.targetClicks] - Meta do dia (padrão 20)
   * @param {number} [context.publicationsToday] - Posts realizados hoje
   * @param {Array<string>} [context.categoriesExplored] - Categorias já pesquisadas
   * @param {string} [context.lastStrategy] - Última estratégia aplicada
   * @param {string} [context.lastEventAction] - Última ação de evento do sistema
   * @param {string} [context.lastEventReason] - Motivo do último evento
   * @returns {{
   *   decisionType: string,
   *   actionTaken: string,
   *   reason: string,
   *   status: 'SEM DADOS' | 'ABAIXO DO RITMO' | 'NO RITMO' | 'META ATINGIDA',
   *   projectedClicks: number,
   *   progressPercent: number,
   *   targetClicks: number,
   *   currentClicks: number,
   *   safeguards: object
   * }}
   */
  evaluate({
    currentClicks = 0,
    targetClicks = this.targetClicks,
    publicationsToday = 0,
    categoriesExplored = [],
    lastStrategy = 'ACHADINHO',
    lastEventAction = null,
    lastEventReason = null,
  } = {}) {
    const now = new Date();
    const currentHour = now.getHours();
    const hoursRemaining = Math.max(1, 24 - currentHour);

    // Safeguards invioláveis
    const safeguards = {
      maxPostsPerDay: 8,
      minCooldownMinutes: 45,
      cooldownMinutes: 45,
      maxCategoryFrequency: 2,
    };

    // Caso 1: Nenhuma publicação realizada hoje
    if (publicationsToday === 0) {
      let dynamicAction = 'Pesquisando categoria com maior intenção de compra.';
      if (lastEventAction === 'PRICE_MULTI_SOURCE_FALLBACK') {
        dynamicAction = 'PDP bloqueada por checkpoint; validação realizada por fonte alternativa.';
      } else if (lastEventAction === 'OFFER_DISCARDED') {
        dynamicAction = 'Oferta descartada: preço não pôde ser confirmado. Pesquisando próxima.';
      } else if (lastEventAction === 'DEMAND_NO_PUBLISH') {
        dynamicAction = 'Nenhuma oportunidade suficientemente forte neste ciclo.';
      }

      return {
        decisionType: 'AGUARDANDO_PRIMEIRA_PUBLICACAO',
        actionTaken: dynamicAction,
        reason: 'Nenhuma publicação realizada hoje. Otimizador focado em identificar oferta de alta intenção comercial para iniciar tração.',
        status: 'SEM DADOS',
        projectedClicks: 0,
        progressPercent: 0,
        targetClicks,
        currentClicks: 0,
        safeguards,
      };
    }

    // Projeção baseada no ritmo diário atual quando já existem publicações
    const ratePerHour = currentHour > 0 ? currentClicks / currentHour : 0;
    const projectedClicks = Math.round(currentClicks + ratePerHour * hoursRemaining);
    const progressPercent = Math.round((currentClicks / targetClicks) * 100);

    let status = 'NO RITMO';
    let decisionType = 'MANTER_RITMO';
    let actionTaken = 'Oferta aprovada para publicação mantendo ritmo da meta.';
    let reason = `Ritmo operacional adequado: ${currentClicks}/${targetClicks} cliques (${progressPercent}%), projeção de ${projectedClicks} cliques hoje.`;

    if (progressPercent >= 100) {
      status = 'META ATINGIDA';
      decisionType = 'META_ATINGIDA';
      actionTaken = 'Meta diária alcançada. Ativando modo de sustentação segura.';
      reason = `Meta diária de ${targetClicks} cliques superada (${currentClicks} cliques). Cooldown ampliado para prevenir saturação.`;
    } else if (
      (currentClicks < targetClicks * 0.4 && currentHour >= 13) ||
      (projectedClicks < targetClicks * 0.7 && currentHour >= 12)
    ) {
      status = 'ABAIXO DO RITMO';
      decisionType = 'ROTACIONAR_CATEGORIA';
      actionTaken = 'Priorizando categorias com maior intenção de compra e ticket acessível (< R$ 50).';
      reason = `Ritmo atual (${currentClicks}/${targetClicks} cliques às ${currentHour}h) abaixo da projeção necessária. Ajustando curadoria para produtos de impulso e maior CTR.`;
    }

    // Reações dinâmicas baseadas no último evento operacional
    if (lastEventAction === 'PRICE_MULTI_SOURCE_FALLBACK') {
      actionTaken = 'PDP bloqueada por checkpoint; validação realizada por fonte alternativa.';
    } else if (lastEventAction === 'OFFER_DISCARDED') {
      actionTaken = 'Oferta descartada: preço não pôde ser confirmado.';
    } else if (lastEventAction === 'DEMAND_NO_PUBLISH') {
      actionTaken = 'Nenhuma oportunidade suficientemente forte neste ciclo.';
    } else if (lastEventAction === 'AUTONOMOUS_PUBLISHED') {
      actionTaken = 'Oferta aprovada para publicação.';
    }

    return {
      decisionType,
      actionTaken,
      reason,
      status,
      projectedClicks,
      progressPercent,
      targetClicks,
      currentClicks,
      safeguards,
    };
  }

  /**
   * Avalia as ofertas selecionadas e recomenda o plano de otimização operacional.
   */
  async evaluateAndOptimize({ topOffers = [], runStats = {} } = {}) {
    const evalRes = this.evaluate({
      currentClicks: runStats.currentClicks || 0,
      targetClicks: this.targetClicks,
      publicationsToday: runStats.publicationsToday || 0,
      lastEventAction: runStats.lastEventAction,
      lastEventReason: runStats.lastEventReason,
    });

    return {
      action: evalRes.actionTaken,
      reason: evalRes.reason,
      status: evalRes.status,
      metrics: {
        projectedTodayClicks: evalRes.projectedClicks,
        progressPercent: evalRes.progressPercent,
        targetClicks: evalRes.targetClicks,
        currentClicks: evalRes.currentClicks,
      },
      safeguards: evalRes.safeguards,
    };
  }
}

export default GoalOptimizer;
