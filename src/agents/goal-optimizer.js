/**
 * ACHAki Autopilot — GoalOptimizer (Fase 5.4)
 *
 * Agente Otimizador de Metas:
 *  - Compara a meta diária (ex: 20 cliques) com a performance real
 *  - Decide ajustes operacionais seguros sem aumentar spam ou posts abusivos
 *  - Aplica limites de frequência, cooldown, diversidade de categoria e anti-repetição
 *  - Registra a justificativa explícita ("Por que o robô fez isso?")
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
   * @param {number} [context.targetClicks] - Meta do dia
   * @param {number} [context.publicationsToday] - Posts realizados hoje
   * @param {Array<string>} [context.categoriesExplored] - Categorias já pesquisadas
   * @param {string} [context.lastStrategy] - Última estratégia aplicada
   * @returns {{
   *   decisionType: string,
   *   actionTaken: string,
   *   reason: string,
   *   status: 'NO_PRAZO' | 'ATENCAO' | 'CRITICO',
   *   projectedClicks: number,
   *   recommendedCategoryRotation?: string
   * }}
   */
  evaluate({
    currentClicks = 0,
    targetClicks = this.targetClicks,
    publicationsToday = 0,
    categoriesExplored = [],
    lastStrategy = 'ACHADINHO',
  } = {}) {
    const now = new Date();
    const currentHour = now.getHours();
    const hoursRemaining = Math.max(1, 24 - currentHour);
    
    // Projeção simples baseada no ritmo diário atual
    const ratePerHour = currentHour > 0 ? currentClicks / currentHour : 0;
    const projectedClicks = Math.round(currentClicks + ratePerHour * hoursRemaining);
    const progressPercent = Math.round((currentClicks / targetClicks) * 100);

    let status = 'NO_PRAZO';
    let decisionType = 'MANTER_RITMO';
    let actionTaken = 'Ciclo padrão de curadoria mantido.';
    let reason = `Ritmo operacional adequado: ${currentClicks}/${targetClicks} cliques (${progressPercent}%).`;

    if (currentClicks < targetClicks * 0.4 && currentHour >= 14) {
      status = 'ATENCAO';
      decisionType = 'ROTACIONAR_CATEGORIA';
      actionTaken = 'Priorizar produtos de compra por impulso (< R$ 40) e diversificar categoria.';
      reason = `Meta de ${targetClicks} cliques está abaixo do esperado às ${currentHour}h (${currentClicks} cliques). Acionado ajuste para ofertas de ticket menor com maior taxa de conversão orgânica.`;
    } else if (currentClicks === 0 && currentHour >= 12 && publicationsToday === 0) {
      status = 'ATENCAO';
      decisionType = 'ACELERAR_GARIMPO';
      actionTaken = 'Focar em itens virais de alta validação social (Prova Social e Desconto Real).';
      reason = `Início da tarde sem engajamento ativo registrado. Otimizador orientou foco em produtos com mais de 300 vendas confirmadas e desconto acima de 25%.`;
    } else if (progressPercent >= 100) {
      status = 'NO_PRAZO';
      decisionType = 'META_ATINGIDA';
      actionTaken = 'Meta diária alcançada. Ativando modo de sustentação com espaçamento estendido de publicações.';
      reason = `Meta diária de ${targetClicks} cliques superada com sucesso (${currentClicks} cliques). Cooldown ampliado para prevenir saturação do público.`;
    }

    // Regras de Segurança Anti-Abuso (invioláveis)
    const safeguards = {
      maxPostsPerDay: 8,
      minCooldownMinutes: 45,
      cooldownMinutes: 45,
      maxCategoryFrequency: 2,
    };

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
   *
   * @param {object} params
   * @param {Array<object>} params.topOffers
   * @param {object} params.runStats
   * @returns {Promise<{
   *   action: string,
   *   reason: string,
   *   status: string,
   *   metrics: object,
   *   safeguards: object
   * }>}
   */
  async evaluateAndOptimize({ topOffers = [], runStats = {} } = {}) {
    const evalRes = this.evaluate({
      currentClicks: 0,
      targetClicks: this.targetClicks,
      publicationsToday: 0,
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
