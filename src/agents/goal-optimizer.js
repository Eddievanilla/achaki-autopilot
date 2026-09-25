/**
 * ACHAki Autopilot — GoalOptimizer (Evoluído: AutonomousGoalManager + GoalOptimizer)
 *
 * Agente Otimizador e Gestor Autônomo de Metas Progressivas:
 *  - Suporte completo a dois modos: [AUTÔNOMAS] e [CONFIGURADAS]
 *  - Eliminação da dependência fixa de 20 cliques
 *  - Dois motores operacionais: GROWTH ENGINE e MONETIZATION ENGINE
 *  - Ciclo obrigatório de ação ativa: OBSERVAR → DIAGNOSTICAR → DECIDIR → AGIR → MEDIR → APRENDER → AJUSTAR
 *  - Estados estritos: EXPLORAÇÃO, ABAIXO_DO_RITMO, NO_RITMO, META_ATINGIDA, SUPERANDO_META, RECALIBRANDO, SEM_DADOS
 *  - Níveis de confiança: LOW, MEDIUM, HIGH
 *  - ZERO MOCK.
 */

import AutonomousGoalManager, { GOAL_STATES, ENGINES } from '../services/growth/autonomous-goal-manager.js';
import logger from '../utils/logger.js';

export { GOAL_STATES, ENGINES };

export class GoalOptimizer {
  constructor({ mode = 'AUTONOMOUS', targetClicks = null } = {}) {
    this.mode = mode; // 'AUTONOMOUS' | 'CONFIGURED'
    this.targetClicks = targetClicks;
    this.manager = new AutonomousGoalManager({ mode });
  }

  /**
   * Avalia a situação atual das metas progressivas e recomenda ações operacionais.
   * Mantém retrocompatibilidade total com as chamadas existentes do pipeline.
   *
   * @param {object} context
   * @returns {Promise<object>|object}
   */
  async evaluateAsync(context = {}) {
    return await this.manager.evaluateAndCalibrate(context);
  }

  /**
   * Avaliação síncrona/adaptativa para o worker e dashboard.
   */
  evaluate({
    currentClicks = 0,
    targetClicks = null,
    publicationsToday = 0,
    categoriesExplored = [],
    lastStrategy = 'ACHADINHO',
    lastEventAction = null,
    lastEventReason = null,
    mode = this.mode,
    followersCount = 0,
    viewsCount = 0,
  } = {}) {
    const isAutonomous = (mode === 'AUTONOMOUS' || !targetClicks);
    const effectiveTarget = targetClicks != null && Number(targetClicks) > 0 ? Number(targetClicks) : (currentClicks > 0 ? currentClicks + 2 : 5);

    // Safeguards invioláveis do sistema
    const safeguards = {
      maxPostsPerDay: 6,
      minCooldownMinutes: 45,
      cooldownMinutes: 45,
      maxCategoryFrequency: 2,
    };

    // Caso 1: Sem dados históricos suficientes / Nenhuma publicação hoje
    if (publicationsToday === 0 && currentClicks === 0) {
      let dynamicAction = 'Pesquisando oportunidade orgânica com evidência real de demanda.';
      if (lastEventAction === 'PRICE_MULTI_SOURCE_FALLBACK') {
        dynamicAction = 'Validação realizada por fonte alternativa segura. Prosseguindo.';
      } else if (lastEventAction === 'OFFER_DISCARDED') {
        dynamicAction = 'Oferta descartada: preço/margem não confirmados. Pesquisando próxima.';
      }

      return {
        decisionType: 'EXPLORACAO_INICIAL',
        actionTaken: dynamicAction,
        reason: isAutonomous 
          ? 'Modo AUTÔNOMO em estado de EXPLORAÇÃO. Estabelecendo primeiro degrau baseado em sinais orgânicos reais sem inflar metas artificialmente.'
          : `Modo CONFIGURADO. Aguardando primeira publicação para iniciar tração rumo a ${effectiveTarget} cliques.`,
        status: GOAL_STATES.EXPLORACAO,
        projectedClicks: 0,
        progressPercent: 0,
        targetClicks: effectiveTarget,
        currentClicks: 0,
        mode: isAutonomous ? 'AUTONOMOUS' : 'CONFIGURED',
        priorityEngine: ENGINES.GROWTH,
        priorityObjective: 'EXPLORAÇÃO & TRAÇÃO INICIAL',
        confidence: 'LOW',
        safeguards,
      };
    }

    // Projeção baseada em dados reais
    const now = new Date();
    const currentHour = now.getHours();
    const hoursRemaining = Math.max(1, 24 - currentHour);
    const ratePerHour = currentHour > 0 ? currentClicks / currentHour : 0;
    const projectedClicks = Math.round(currentClicks + ratePerHour * hoursRemaining);
    const progressPercent = effectiveTarget > 0 ? Math.round((currentClicks / effectiveTarget) * 100) : 0;

    let status = GOAL_STATES.NO_RITMO;
    let decisionType = 'MANTER_RITMO';
    let actionTaken = 'Operação em andamento no ritmo adequado da meta.';
    let reason = `Ritmo operacional: ${currentClicks}/${effectiveTarget} cliques (${progressPercent}%). Projeção: ${projectedClicks} hoje.`;

    if (progressPercent >= 120) {
      status = GOAL_STATES.SUPERANDO_META;
      decisionType = 'SUPERANDO_META';
      actionTaken = 'Superando meta. Próximo degrau será recalibrado com margem prudente (+15% a +25%).';
      reason = `Meta superada com consistência (${currentClicks}/${effectiveTarget}). Sem desespero para dobrar meta; avançando para o próximo degrau real.`;
    } else if (progressPercent >= 100) {
      status = GOAL_STATES.META_ATINGIDA;
      decisionType = 'META_ATINGIDA';
      actionTaken = 'Meta atingida. Sustentando qualidade sem saturação da audiência.';
      reason = `Meta de ${effectiveTarget} alcançada (${currentClicks} registrados).`;
    } else if (progressPercent >= 50) {
      status = GOAL_STATES.NO_RITMO;
      decisionType = 'MANTER_RITMO';
      actionTaken = 'Oferta selecionada mantendo progressão segura da meta.';
      reason = `Progresso satisfatório: ${progressPercent}% da meta alcançada com cadência estável.`;
    } else {
      status = GOAL_STATES.ABAIXO_DO_RITMO;
      decisionType = 'AJUSTAR_ESTRATEGIA';
      actionTaken = 'Ritmo abaixo do degrau almejado. Ajustando gancho e apelo visual da oferta.';
      reason = `Ritmo atual (${currentClicks}/${effectiveTarget}) requer refinamento de cópia e formato sem aumentar frequência de spam.`;
    }

    return {
      decisionType,
      actionTaken,
      reason,
      status,
      projectedClicks,
      progressPercent,
      targetClicks: effectiveTarget,
      currentClicks,
      mode: isAutonomous ? 'AUTONOMOUS' : 'CONFIGURED',
      priorityEngine: progressPercent >= 100 ? ENGINES.GROWTH : ENGINES.MONETIZATION,
      priorityObjective: progressPercent >= 100 ? 'CRESCIMENTO DE AUDIÊNCIA' : 'INTENÇÃO COMERCIAL & CLIQUES',
      confidence: publicationsToday >= 4 ? 'MEDIUM' : 'LOW',
      safeguards,
    };
  }
}

export default GoalOptimizer;
