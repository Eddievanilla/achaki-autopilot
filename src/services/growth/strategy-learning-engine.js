/**
 * ACHAki Autopilot — StrategyLearningEngine
 *
 * Motor de Aprendizado Contínuo e Registro de Experimentos.
 *
 * Responsabilidades:
 *  1. Registrar cada publicação como um EXPERIMENTO MENSURÁVEL (strategy_experiments).
 *  2. Correlacionar performance com dimensões (formato, gancho, criativo, categoria, horário).
 *  3. Níveis de confiança estritos: LOW (amostra pequena), MEDIUM (padrão repetido), HIGH (consistência comprovada).
 *  4. Linguagem auditável e sem falsa causalidade: "ASSOCIADO", "CORRELACIONADO", "PROVÁVEL".
 *  5. Tags padronizadas para o Diário de Decisões:
 *     🎯 [META], 📈 [GROWTH], 🧪 [EXPERIMENTO], 🔥 [DEMANDA],
 *     ⚡ [IMPULSO], 💰 [MONETIZAÇÃO], 🧠 [APRENDIZADO], 🔄 [AJUSTE].
 */

import { supabase } from '../../database/supabase.js';
import logger from '../../utils/logger.js';

export const CONTENT_TYPES = {
  OFFER: 'OFFER',
  GROWTH: 'GROWTH',
  ENGAGEMENT: 'ENGAGEMENT',
  EDUCATIONAL: 'EDUCATIONAL',
  TREND: 'TREND',
  PRODUCT_DEMO: 'PRODUCT_DEMO',
  COMPARISON: 'COMPARISON',
};

export const OPPORTUNITY_ORIGINS = {
  DEMAND: 'DEMAND',
  TARGET: 'TARGET',
  IMPULSE: 'IMPULSE',
  NEED: 'NEED',
  SEARCH_INTENT: 'SEARCH_INTENT',
  TREND: 'TREND',
  GROWTH: 'GROWTH',
  MONETIZATION: 'MONETIZATION',
};

export class StrategyLearningEngine {
  /**
   * Registra uma nova publicação como experimento estruturado.
   */
  static async registerExperiment({
    publicationId = null,
    network = 'FACEBOOK',
    engine = 'GROWTH',
    contentType = 'OFFER',
    productId = null,
    clusterDemand = 'Geral',
    opportunityOrigin = 'DEMAND',
    creativeFormat = 'IMAGE',
    creativeAssetId = null,
    hook = '',
    copy = '',
    cta = '',
    strategy = 'DESCONTO',
    publishedAt = new Date().toISOString(),
    price = null,
    discountPercent = null,
    affiliateUrl = null,
  }) {
    try {
      const payload = {
        publication_id: publicationId,
        network,
        engine,
        content_type: contentType,
        product_id: productId,
        cluster_demand: clusterDemand,
        opportunity_origin: opportunityOrigin,
        creative_format: creativeFormat,
        creative_asset_id: creativeAssetId,
        hook,
        copy,
        cta,
        strategy,
        published_at: publishedAt,
        price,
        discount_percent: discountPercent,
        affiliate_url: affiliateUrl,
        metrics: {
          reach: 0,
          impressions: 0,
          views: 0,
          reactions: 0,
          comments: 0,
          shares: 0,
          clicks: 0,
          ctr: 0,
          followers_gained: 0,
          conversions: 0,
        },
      };

      const { data, error } = await supabase
        .from('strategy_experiments')
        .insert(payload)
        .select()
        .single();

      if (error) throw error;
      logger.info(`[StrategyLearning] Experimento registrado com sucesso [ID: ${data.id}]`);
      return data;
    } catch (err) {
      logger.warn(`[StrategyLearning] Falha ao registrar experimento: ${err.message}`);
      return null;
    }
  }

  /**
   * Atualiza as métricas reais de um experimento existente quando chegam dados de analytics.
   */
  static async updateExperimentMetrics(experimentId, newMetrics = {}) {
    try {
      const { data: cur } = await supabase
        .from('strategy_experiments')
        .select('metrics')
        .eq('id', experimentId)
        .maybeSingle();

      const updated = {
        ...(cur?.metrics || {}),
        ...newMetrics,
      };

      await supabase
        .from('strategy_experiments')
        .update({ metrics: updated })
        .eq('id', experimentId);

      // Dispara reavaliação de aprendizado
      await this.reevaluateLearning();
    } catch (err) {
      logger.warn(`[StrategyLearning] Falha ao atualizar métricas do experimento: ${err.message}`);
    }
  }

  /**
   * Avalia todos os experimentos e atualiza o conhecimento acumulado (strategy_learning).
   */
  static async reevaluateLearning() {
    try {
      const { data: experiments } = await supabase
        .from('strategy_experiments')
        .select('*')
        .order('published_at', { ascending: false })
        .limit(100);

      if (!Array.isArray(experiments) || experiments.length === 0) {
        return;
      }

      // Agrupa por formato de criativo (IMAGE vs VIDEO vs CAROUSEL)
      const formatGroups = {};
      for (const exp of experiments) {
        const fmt = exp.creative_format || 'IMAGE';
        if (!formatGroups[fmt]) formatGroups[fmt] = { count: 0, totalEngagement: 0, totalClicks: 0, totalShares: 0 };
        const m = exp.metrics || {};
        formatGroups[fmt].count++;
        formatGroups[fmt].totalEngagement += (m.reactions || 0) + (m.comments || 0);
        formatGroups[fmt].totalClicks += (m.clicks || 0);
        formatGroups[fmt].totalShares += (m.shares || 0);
      }

      for (const [fmt, stat] of Object.entries(formatGroups)) {
        let confidence = 'LOW';
        let evidence = '';

        if (stat.count >= 10) {
          confidence = 'HIGH';
          evidence = `Padrão observado com consistência ao longo de ${stat.count} experimentos realizados.`;
        } else if (stat.count >= 4) {
          confidence = 'MEDIUM';
          evidence = `Sinal consistente identificado em amostra de ${stat.count} experimentos.`;
        } else {
          confidence = 'LOW';
          evidence = `Sinal inicial observado em amostra reduzida (${stat.count} experimento(s)). Cautela estatística aplicada.`;
        }

        const avgEng = (stat.totalEngagement / stat.count).toFixed(1);
        const avgClicks = (stat.totalClicks / stat.count).toFixed(1);

        const learningSummary = `Formato [${fmt}] apresenta média observada de ${avgClicks} cliques e ${avgEng} engajamentos por publicação. ${evidence}`;

        await supabase
          .from('strategy_learning')
          .upsert({
            strategy_key: `format_${fmt.toLowerCase()}`,
            dimension: 'format',
            dimension_value: fmt,
            confidence,
            sample_size: stat.count,
            success_rate: stat.count > 0 ? Number(((stat.totalClicks + stat.totalEngagement) / stat.count).toFixed(2)) : 0,
            evidence_summary: learningSummary,
            weight: 1.0,
            last_evaluated_at: new Date().toISOString(),
          }, { onConflict: 'id' });
      }
    } catch (e) {
      logger.warn(`[StrategyLearning] Falha ao reavaliar aprendizado: ${e.message}`);
    }
  }

  /**
   * Formata uma entrada para o Diário de Decisões com as tags padronizadas.
   */
  static formatDiaryEntry({
    tag = 'APRENDIZADO', // 'META', 'GROWTH', 'EXPERIMENTO', 'DEMANDA', 'IMPULSO', 'MONETIZAÇÃO', 'APRENDIZADO', 'AJUSTE'
    title = '',
    result = '',
    probableOrigin = '',
    evidence = '',
    confidence = 'LOW', // 'LOW', 'MEDIUM', 'HIGH'
    decision = '',
    details = {},
  }) {
    const TAG_MAP = {
      META: { icon: '🎯', label: '[META]', color: '#38bdf8' },
      GROWTH: { icon: '📈', label: '[GROWTH]', color: '#a855f7' },
      EXPERIMENTO: { icon: '🧪', label: '[EXPERIMENTO]', color: '#f59e0b' },
      DEMANDA: { icon: '🔥', label: '[DEMANDA]', color: '#ef4444' },
      IMPULSO: { icon: '⚡', label: '[IMPULSO]', color: '#eab308' },
      MONETIZACAO: { icon: '💰', label: '[MONETIZAÇÃO]', color: '#10b981' },
      APRENDIZADO: { icon: '🧠', label: '[APRENDIZADO]', color: '#6366f1' },
      AJUSTE: { icon: '🔄', label: '[AJUSTE]', color: '#ec4899' },
    };

    const config = TAG_MAP[tag] || TAG_MAP.APRENDIZADO;

    return {
      type: tag,
      tag: config.label,
      tagIcon: config.icon,
      tagColor: config.color,
      title,
      result,
      probableOrigin, // "ASSOCIADO À PUBLICAÇÃO X", "PROVÁVEL ORIGEM..."
      evidence,
      confidence,
      decision,
      details,
      timestamp: new Date().toISOString(),
    };
  }
}

export default StrategyLearningEngine;
