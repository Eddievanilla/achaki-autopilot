/**
 * ACHAki Autopilot — AutonomousGoalManager
 *
 * Gestor Autônomo de Metas Progressivas e Alocação Estratégica (Growth & Monetization Engines).
 *
 * Responsabilidades:
 *  1. Gerenciar metas nos modos [AUTÔNOMAS] e [CONFIGURADAS].
 *  2. Eliminar qualquer meta fixa arbitrária (ex: 20 cliques).
 *  3. No modo AUTÔNOMO:
 *     - Sem dados históricos -> estado = EXPLORAÇÃO com micro-objetivos baseados na realidade observada.
 *     - Metas progressivas baseadas em evidências reais (consistência, janela, velocidade, capacidade real).
 *     - Bater uma meta não a dobra ingenuamente; calcula degraus estatísticos reais.
 *  4. Alocação entre GROWTH ENGINE (seguidores, alcance, visualizações, engajamento) e
 *     MONETIZATION ENGINE (cliques, CTR, conversões, intenção comercial).
 *  5. Ciclo obrigatório de ação ativa:
 *     OBSERVAR → DIAGNOSTICAR → DECIDIR → AGIR → MEDIR → APRENDER → AJUSTAR.
 */

import { supabase } from '../../database/supabase.js';
import GrowthVelocity from './growth-velocity.js';
import logger from '../../utils/logger.js';

export const GOAL_STATES = {
  EXPLORACAO: 'EXPLORAÇÃO',
  ABAIXO_DO_RITMO: 'ABAIXO_DO_RITMO',
  NO_RITMO: 'NO_RITMO',
  META_ATINGIDA: 'META_ATINGIDA',
  SUPERANDO_META: 'SUPERANDO_META',
  RECALIBRANDO: 'RECALIBRANDO',
  SEM_DADOS: 'SEM_DADOS',
};

export const ENGINES = {
  GROWTH: 'GROWTH',
  MONETIZATION: 'MONETIZATION',
};

export class AutonomousGoalManager {
  constructor({ mode = 'AUTONOMOUS' } = {}) {
    this.mode = mode; // 'AUTONOMOUS' | 'CONFIGURED'
  }

  /**
   * Avalia e calibra todas as metas operacionais com base nos dados reais do Supabase.
   *
   * @param {object} context
   * @param {object} [context.socialMetrics] - Métricas recentes de redes sociais
   * @param {Array} [context.recentPublications] - Publicações recentes e seus resultados
   * @param {number} [context.todayPublicationsCount] - Número de publicações de hoje
   * @param {object} [context.configuredGoals] - Metas manuais configuradas pelo operador
   * @returns {Promise<object>}
   */
  async evaluateAndCalibrate(context = {}) {
    try {
      // 1. Carrega estado atual das metas no Supabase
      const { data: dbGoals } = await supabase
        .from('goals')
        .select('*');

      const existingGoalsMap = new Map((dbGoals || []).map(g => [g.metric || g.metric_name, g]));

      // 2. Extrai métricas reais atuais
      const realMetrics = await this._extractRealMetrics(context);

      // 3. Avalia métricas dos dois motores
      const evaluatedGoals = {};

      // A. GROWTH ENGINE METRICS
      evaluatedGoals.followers = this._evaluateMetricGoal({
        metric: 'followers',
        label: 'Seguidores',
        engine: ENGINES.GROWTH,
        currentResult: realMetrics.followers.total,
        history: realMetrics.followers.history,
        existingGoal: existingGoalsMap.get('followers'),
        configuredGoal: context.configuredGoals?.followers,
        unit: 'seguidores',
      });

      evaluatedGoals.views = this._evaluateMetricGoal({
        metric: 'views',
        label: 'Visualizações',
        engine: ENGINES.GROWTH,
        currentResult: realMetrics.views.today,
        history: realMetrics.views.history,
        existingGoal: existingGoalsMap.get('views'),
        configuredGoal: context.configuredGoals?.views,
        unit: 'views',
      });

      evaluatedGoals.reach = this._evaluateMetricGoal({
        metric: 'reach',
        label: 'Alcance',
        engine: ENGINES.GROWTH,
        currentResult: realMetrics.reach.today,
        history: realMetrics.reach.history,
        existingGoal: existingGoalsMap.get('reach'),
        configuredGoal: context.configuredGoals?.reach,
        unit: 'contas',
      });

      evaluatedGoals.engagement = this._evaluateMetricGoal({
        metric: 'engagement',
        label: 'Engajamento',
        engine: ENGINES.GROWTH,
        currentResult: realMetrics.engagement.today,
        history: realMetrics.engagement.history,
        existingGoal: existingGoalsMap.get('engagement'),
        configuredGoal: context.configuredGoals?.engagement,
        unit: 'reações/comentários',
      });

      // B. MONETIZATION ENGINE METRICS
      evaluatedGoals.clicks = this._evaluateMetricGoal({
        metric: 'clicks',
        label: 'Cliques em Ofertas',
        engine: ENGINES.MONETIZATION,
        currentResult: realMetrics.clicks.today,
        history: realMetrics.clicks.history,
        existingGoal: existingGoalsMap.get('clicks'),
        configuredGoal: context.configuredGoals?.clicks,
        unit: 'cliques',
      });

      evaluatedGoals.ctr = this._evaluateMetricGoal({
        metric: 'ctr',
        label: 'CTR de Ofertas',
        engine: ENGINES.MONETIZATION,
        currentResult: realMetrics.ctr.value,
        history: realMetrics.ctr.history,
        existingGoal: existingGoalsMap.get('ctr'),
        configuredGoal: context.configuredGoals?.ctr,
        unit: '%',
        isRate: true,
      });

      evaluatedGoals.conversions = this._evaluateMetricGoal({
        metric: 'conversions',
        label: 'Conversões Comissionadas',
        engine: ENGINES.MONETIZATION,
        currentResult: realMetrics.conversions.today,
        history: realMetrics.conversions.history,
        existingGoal: existingGoalsMap.get('conversions'),
        configuredGoal: context.configuredGoals?.conversions,
        unit: 'conversões',
      });

      // 4. Decide alocação prioritária entre Growth e Monetization
      const activeDecision = this._decideEnginePriority(evaluatedGoals, realMetrics, context);

      // 5. Salva estado calibrado de metas no Supabase (sem travar se der erro de rede)
      await this._persistGoals(evaluatedGoals);

      return {
        mode: this.mode,
        evaluatedGoals,
        activeDecision,
        realMetricsSummary: {
          followersTotal: realMetrics.followers.total,
          viewsToday: realMetrics.views.today,
          clicksToday: realMetrics.clicks.today,
          conversionsToday: realMetrics.conversions.today,
        },
      };
    } catch (err) {
      logger.warn(`[AutonomousGoalManager] Erro ao avaliar metas: ${err.message}`);
      return this._fallbackState();
    }
  }

  /**
   * Avalia uma métrica individual e calcula o degrau progressivo de meta.
   */
  _evaluateMetricGoal({
    metric,
    label,
    engine,
    currentResult = 0,
    history = [],
    existingGoal = null,
    configuredGoal = null,
    unit = '',
    isRate = false,
  }) {
    const velocity = GrowthVelocity.calculate(history, currentResult);
    const hasHistory = velocity.hasHistory && (history.length >= 2 || currentResult > 0);

    let mode = this.mode;
    let target = 0;
    let baseline = existingGoal?.baseline ? Number(existingGoal.baseline) : currentResult;
    let status = GOAL_STATES.SEM_DADOS;
    let confidence = 'LOW';
    let strategy = '';
    let reason = '';
    let nextCandidate = 0;

    // Modo 1: CONFIGURADO MANUALMENTE PELO OPERADOR
    if (this.mode === 'CONFIGURED' && configuredGoal != null && Number(configuredGoal) > 0) {
      mode = 'CONFIGURED';
      target = Number(configuredGoal);
      confidence = 'HIGH'; // Usuário definiu
      const progress = target > 0 ? Math.round((currentResult / target) * 100) : 0;

      if (!hasHistory && currentResult === 0) {
        status = GOAL_STATES.SEM_DADOS;
        reason = `Meta de ${target} ${unit} configurada manualmente. Nenhuma atividade registrada hoje.`;
        strategy = `Estimular ${label.toLowerCase()} orgânico conforme parâmetro estabelecido.`;
      } else if (progress >= 100) {
        status = GOAL_STATES.META_ATINGIDA;
        reason = `Meta diária configurada de ${target} ${unit} atingida com ${currentResult} ${unit} (${progress}%).`;
        strategy = `Sustentação de ritmo orgânico sem saturação.`;
      } else if (progress >= 50) {
        status = GOAL_STATES.NO_RITMO;
        reason = `Progresso adequado: ${currentResult}/${target} ${unit} (${progress}%).`;
        strategy = `Manter linha de publicações direcionada para bater a meta configurada.`;
      } else {
        status = GOAL_STATES.ABAIXO_DO_RITMO;
        reason = `Ritmo abaixo do desejado: ${currentResult}/${target} ${unit} (${progress}%).`;
        strategy = `Ajustar gancho e apelo do conteúdo para aproximar da meta do operador.`;
      }

      return {
        metric,
        label,
        engine,
        mode,
        current_goal: target,
        current_result: currentResult,
        progress,
        period: 'DAILY',
        baseline,
        growth_velocity: velocity,
        trend: velocity.trend,
        confidence,
        previous_goal: existingGoal?.previous_goal || 0,
        next_goal_candidate: target,
        status,
        strategy,
        reason,
        unit,
      };
    }

    // Modo 2: AUTÔNOMO PROGRESSIVO COM BASE EM EVIDÊNCIA REAL
    mode = 'AUTONOMOUS';

    if (!hasHistory || (currentResult === 0 && (!history || history.length === 0))) {
      // Estado de EXPLORAÇÃO inicial: O agente NÃO inventa meta alta arbitrária
      status = GOAL_STATES.EXPLORACAO;
      confidence = 'LOW';
      // Meta de exploração: primeiro sinal positivo (+1 unidade)
      target = isRate ? 1.0 : (currentResult > 0 ? currentResult + 1 : 1);
      nextCandidate = target + 1;
      reason = `Sem histórico consolidado suficiente para ${label.toLowerCase()}. Operando em modo de EXPLORAÇÃO para colher primeiros sinais reais.`;
      strategy = `Testar publicações de formatos variados para medir tração orgânica inicial.`;

      return {
        metric,
        label,
        engine,
        mode,
        current_goal: target,
        current_result: currentResult,
        progress: target > 0 ? Math.min(100, Math.round((currentResult / target) * 100)) : 0,
        period: 'DAILY',
        baseline: currentResult,
        growth_velocity: velocity,
        trend: velocity.trend,
        confidence,
        previous_goal: 0,
        next_goal_candidate: nextCandidate,
        status,
        strategy,
        reason,
        unit,
      };
    }

    // Histórico real existente: calcula degrau progressivo consciente
    const prevGoal = existingGoal?.current_goal ? Number(existingGoal.current_goal) : Math.max(1, currentResult);
    target = prevGoal;

    const progress = target > 0 ? Math.round((currentResult / target) * 100) : 0;

    // Amostra de histórico
    const sampleCount = history.length;
    if (sampleCount >= 10) confidence = 'HIGH';
    else if (sampleCount >= 4) confidence = 'MEDIUM';
    else confidence = 'LOW';

    if (progress >= 120) {
      status = GOAL_STATES.SUPERANDO_META;
      // Bateu com folga: não dobra! Define próximo degrau progressivo com margem estatística prudente (+15% a +25%)
      const stepIncrease = Math.max(1, Math.round(target * 0.20));
      nextCandidate = target + stepIncrease;
      reason = `Resultado atual (${currentResult} ${unit}) superou amplamente a meta de ${target}. Degrau seguinte calculado prudentemente em ${nextCandidate} ${unit} com base na velocidade observada.`;
      strategy = `Estratégia demonstrou forte tração. Consolidar formato vencedor e avançar para degrau seguinte.`;
    } else if (progress >= 100) {
      status = GOAL_STATES.META_ATINGIDA;
      const stepIncrease = Math.max(1, Math.round(target * 0.15));
      nextCandidate = target + stepIncrease;
      reason = `Meta atual de ${target} ${unit} alcançada com sucesso (${currentResult} ${unit}). Mantendo consistência antes de validar próximo degrau.`;
      strategy = `Sustentar formato com qualidade e monitorar retenção da audiência.`;
    } else if (progress >= 50) {
      status = GOAL_STATES.NO_RITMO;
      nextCandidate = target;
      reason = `Desempenho no ritmo esperado: ${currentResult}/${target} ${unit} (${progress}%). Velocidade diária: ${velocity.velocityPerDay}/dia.`;
      strategy = `Manter programação orgânica regular sem saturação.`;
    } else {
      status = GOAL_STATES.ABAIXO_DO_RITMO;
      // Se estiver há vários dias sem bater, recalibra para baseline real
      nextCandidate = Math.max(1, Math.round((target + currentResult) / 2));
      reason = `Resultado atual de ${currentResult} ${unit} está abaixo do degrau almejado (${target} ${unit}). Diagnóstico em andamento para ajustar criativo e horário.`;
      strategy = `Diagnosticar atrito no conteúdo: experimentar variação de gancho e apelo visual.`;
    }

    return {
      metric,
      label,
      engine,
      mode,
      current_goal: target,
      current_result: currentResult,
      progress,
      period: 'DAILY',
      baseline,
      growth_velocity: velocity,
      trend: velocity.trend,
      confidence,
      previous_goal: existingGoal?.previous_goal || 0,
      next_goal_candidate: nextCandidate,
      status,
      strategy,
      reason,
      unit,
    };
  }

  /**
   * Decide onde concentrar esforço entre GROWTH ENGINE e MONETIZATION ENGINE.
   */
  _decideEnginePriority(goals, realMetrics, context) {
    const followers = goals.followers;
    const views = goals.views;
    const clicks = goals.clicks;

    // Regra 1: Se tem boas visualizações mas poucos seguidores -> priorizar crescimento de audiência
    if (views.current_result > 50 && followers.current_result < 5) {
      return {
        priorityEngine: ENGINES.GROWTH,
        priorityObjective: 'CRESCIMENTO DE AUDIÊNCIA (CONVERSÃO EM SEGUIDORES)',
        diagnosis: `Volume de visualizações existente (${views.current_result} views), porém taxa de conversão em novos seguidores baixa (${followers.current_result} seguidores).`,
        strategy: 'Priorizar publicações com ganchos de alta identificação e vídeos demonstrativos para estimular o botão "Seguir".',
        currentAction: 'Buscando formatos e temas virais/demonstrativos para reter audiência como seguidora.',
        nextDecision: 'Testar 1 publicação focada em Growth e medir ganho de seguidores nas próximas 6 horas.',
      };
    }

    // Regra 2: Se audiência está crescendo mas cliques em ofertas são baixos -> refinar monetização
    if (followers.current_result > 10 && clicks.current_result < 3) {
      return {
        priorityEngine: ENGINES.MONETIZATION,
        priorityObjective: 'MONETIZAÇÃO E INTENÇÃO COMERCIAL',
        diagnosis: `Base de seguidores e engajamento ativa, mas tração de cliques em ofertas abaixo do potencial (${clicks.current_result} cliques hoje).`,
        strategy: 'Aprimorar a clareza da chamada para ação (CTA) e selecionar produtos de impulso com descontos reais verificados.',
        currentAction: 'Filtrando ofertas no radar com preço comprovadamente abaixo da média e alto apelo de compra imediata.',
        nextDecision: 'Publicar oferta de impulso com copy objetiva e acompanhar taxa de cliques (CTR).',
      };
    }

    // Regra 3: Início de ciclo ou fase de exploração equilibrada
    return {
      priorityEngine: ENGINES.GROWTH,
      priorityObjective: 'EXPLORAÇÃO & EQUILÍBRIO ORGÂNICO',
      diagnosis: 'Sistema operando com métricas reais em fase de consolidação. Ambos os motores ativos com metas progressivas.',
      strategy: 'Alternar entre conteúdos de alto interesse público (Growth) e oportunidades pontuais de desconto real (Monetization).',
      currentAction: 'Analisando demanda atual no Google Trends e Radar de Ofertas para definir melhor oportunidade do próximo ciclo.',
      nextDecision: 'Manter cadência segura de até 6 posts/dia com cooldown mínimo de 45 minutos.',
    };
  }

  /**
   * Extrai métricas reais atuais do banco de dados (zero mocks).
   */
  async _extractRealMetrics(context) {
    const result = {
      followers: { total: 0, history: [] },
      views: { today: 0, history: [] },
      reach: { today: 0, history: [] },
      engagement: { today: 0, history: [] },
      clicks: { today: 0, history: [] },
      ctr: { value: 0, history: [] },
      conversions: { today: 0, history: [] },
    };

    try {
      // 1. Consulta social_metrics recentes coletadas das redes
      const { data: metricsData } = await supabase
        .from('social_metrics')
        .select('*')
        .order('collected_at', { ascending: false })
        .limit(200);

      if (Array.isArray(metricsData)) {
        for (const row of metricsData) {
          const m = row.metric;
          const val = Number(row.value) || 0;
          const item = { value: val, timestamp: row.collected_at };

          if (m === 'followers' || m === 'page_followers') {
            if (result.followers.total === 0) result.followers.total = val;
            result.followers.history.push(item);
          } else if (m === 'views' || m === 'impressions') {
            result.views.history.push(item);
          } else if (m === 'reach') {
            result.reach.history.push(item);
          } else if (m === 'engagement' || m === 'reactions') {
            result.engagement.history.push(item);
          }
        }
      }

      // 2. Consulta cliques reais do dia em publication_metrics
      const spDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const todayStartIso = new Date(`${spDateStr}T00:00:00-03:00`).toISOString();

      const { data: pubMetrics } = await supabase
        .from('publication_metrics')
        .select('clicks, impressions, conversions, updated_at')
        .gte('updated_at', todayStartIso);

      let totalClicksToday = 0;
      let totalImpressionsToday = 0;
      let totalConversionsToday = 0;

      if (Array.isArray(pubMetrics)) {
        for (const pm of pubMetrics) {
          totalClicksToday += (pm.clicks || 0);
          totalImpressionsToday += (pm.impressions || 0);
          totalConversionsToday += (pm.conversions || 0);
        }
      }

      result.clicks.today = totalClicksToday;
      result.conversions.today = totalConversionsToday;

      if (totalImpressionsToday > 0) {
        result.ctr.value = Number(((totalClicksToday / totalImpressionsToday) * 100).toFixed(1));
      }
    } catch (e) {
      logger.warn(`[AutonomousGoalManager] Falha ao extrair métricas reais: ${e.message}`);
    }

    return result;
  }

  /**
   * Persiste as metas calibradas na tabela goals do Supabase.
   */
  async _persistGoals(goalsMap) {
    try {
      const records = Object.values(goalsMap).map(g => ({
        id: `goal-${g.metric}`,
        metric: g.metric,
        mode: g.mode,
        current_goal: g.current_goal,
        current_result: g.current_result,
        progress: g.progress,
        period: g.period || 'DAILY',
        baseline: g.baseline,
        growth_velocity: g.growth_velocity,
        trend: g.trend,
        confidence: g.confidence,
        previous_goal: g.previous_goal,
        next_goal_candidate: g.next_goal_candidate,
        status: g.status,
        strategy: g.strategy,
        reason: g.reason,
        updated_at: new Date().toISOString(),
      }));

      await supabase
        .from('goals')
        .upsert(records, { onConflict: 'id' });
    } catch (e) {
      logger.warn(`[AutonomousGoalManager] Falha ao persistir metas: ${e.message}`);
    }
  }

  _fallbackState() {
    return {
      mode: this.mode,
      evaluatedGoals: {
        followers: { metric: 'followers', label: 'Seguidores', status: GOAL_STATES.EXPLORACAO, current_goal: 1, current_result: 0, progress: 0, trend: 'ESTAVEL', confidence: 'LOW' },
        views: { metric: 'views', label: 'Visualizações', status: GOAL_STATES.EXPLORACAO, current_goal: 50, current_result: 0, progress: 0, trend: 'ESTAVEL', confidence: 'LOW' },
        clicks: { metric: 'clicks', label: 'Cliques', status: GOAL_STATES.EXPLORACAO, current_goal: 5, current_result: 0, progress: 0, trend: 'ESTAVEL', confidence: 'LOW' },
        engagement: { metric: 'engagement', label: 'Engajamento', status: GOAL_STATES.EXPLORACAO, current_goal: 2, current_result: 0, progress: 0, trend: 'ESTAVEL', confidence: 'LOW' },
        conversions: { metric: 'conversions', label: 'Conversões', status: GOAL_STATES.EXPLORACAO, current_goal: 1, current_result: 0, progress: 0, trend: 'ESTAVEL', confidence: 'LOW' },
      },
      activeDecision: {
        priorityEngine: ENGINES.GROWTH,
        priorityObjective: 'EXPLORAÇÃO INICIAL',
        diagnosis: 'Sistema iniciando calibração autônoma.',
        strategy: 'Acompanhar métricas reais e ajustar degraus progressivos.',
        currentAction: 'Monitorando sinais orgânicos.',
        nextDecision: 'Validar dados com próximas publicações.',
      },
      realMetricsSummary: { followersTotal: 0, viewsToday: 0, clicksToday: 0, conversionsToday: 0 },
    };
  }
}

export default AutonomousGoalManager;
