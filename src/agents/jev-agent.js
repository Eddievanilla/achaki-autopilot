/**
 * ACHAki Autopilot — JevAgent (Fase 5.1)
 *
 * Agente de decisões estruturadas consumindo o modelo `typesafe/jev-1.13`
 * através da Decisions API oficial do OpenRouter (`/api/alpha/decisions`).
 *
 * Características:
 *  - System One Decision Model: saídas tipadas (noul, choice, score), sem geração de texto longo.
 *  - Custo ultra baixo: $0.042 por milhão de tokens de entrada (~30x mais econômico que GPT-4o-mini).
 *  - Roteamento e Gating: decide se o produto precisa de escalonamento para o GPT-4o-mini.
 *
 * SEGURANÇA:
 *  - NUNCA registra ou expõe chaves de API, senhas ou tokens nos logs.
 */

import logger from '../utils/logger.js';

export class JevAgent {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey]
   * @param {string} [options.model='typesafe/jev-1.13']
   * @param {string} [options.apiUrl='https://openrouter.ai/api/alpha/decisions']
   * @param {number} [options.timeoutMs=10000]
   */
  constructor({
    apiKey = process.env.OPENROUTER_API_KEY,
    model = 'typesafe/jev-1.13',
    apiUrl = 'https://openrouter.ai/api/alpha/decisions',
    timeoutMs = 10000,
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.apiUrl = apiUrl;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Valida se a chave de API está presente.
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  /**
   * Avalia um candidato individual através do JEV.
   *
   * @param {object} candidate - Produto com métricas e LOCAL_SCORE
   * @returns {Promise<{ ok: boolean, data?: object, usage?: object, error?: string }>}
   */
  async evaluateCandidate(candidate) {
    if (!this.isConfigured()) {
      return { ok: false, error: 'OPENROUTER_API_KEY não configurada para JEV' };
    }

    const state = {
      title: candidate.title,
      marketplace: candidate.marketplace,
      category: candidate.category || 'outros',
      price: candidate.currentPrice,
      original_price: candidate.originalPrice || undefined,
      discount_percent: candidate.announcedDiscount || candidate.discountPercent || undefined,
      real_discount_vs_avg: candidate.realDiscountVsAvg || undefined,
      rating: candidate.rating || undefined,
      sales: candidate.soldCount || undefined,
      shipping: candidate.shipping || undefined,
      local_score: candidate.localScore,
      history_confidence: candidate.historyConfidence || 'LOW',
      risk_signals: candidate.localPenalties || [],
    };

    const questions = {
      is_achadinho: {
        type: 'noul',
        instructions: "Is this product an attractive 'achadinho' bargain deal for daily utility and impulse purchase?",
        criteria: {
          true: 'Affordable, useful, good rating, clear discount or great utility.',
          false: 'Overpriced, low utility, poor reviews or misleading promotion.',
        },
      },
      quality_tier: {
        type: 'choice',
        instructions: 'What is the quality and appeal tier of this deal?',
        criteria: {
          top_tier: 'Highly viral, outstanding price-to-value ratio, high rating.',
          solid_deal: 'Standard good deal with reliable utility and fair price.',
          mediocre_or_risky: 'Unimpressive discount, weak ratings, or high risk.',
        },
      },
      risk_level: {
        type: 'choice',
        instructions: 'Assess consumer dissatisfaction or misleading deal risk.',
        criteria: {
          low_risk: 'High rating, verified seller, realistic discount, solid product.',
          moderate_risk: 'Missing reviews or minor price fluctuations.',
          high_risk: 'Inflated discount, negative sentiment, or questionable quality.',
        },
      },
      needs_deep_analysis: {
        type: 'noul',
        instructions: 'Does this product require deeper LLM reasoning (escalation) due to ambiguity, borderline score, or high price?',
        criteria: {
          true: 'Borderline quality, high price (> R$250), ambiguous value, or uncertain discount.',
          false: 'Clear-cut high quality bargain or obviously poor product with obvious decision.',
        },
      },
      decision_score: {
        type: 'score',
        instructions: 'Rate overall suitability for affiliate publication (0 to 100 scale represented in 4 tiers)',
        criteria: [
          'Reject (Score 0-50)',
          'Neutral candidate (Score 51-70)',
          'Recommended deal (Score 71-85)',
          'Top viral deal (Score 86-100)',
        ],
      },
    };

    const body = {
      model: this.model,
      state: { candidate: state },
      questions,
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://achaki-autopilot.vercel.app',
          'X-Title': 'ACHAki Autopilot JEV',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text();
        return { ok: false, error: `HTTP ${response.status}: ${errorText.slice(0, 150)}` };
      }

      const json = await response.json();
      const answers = json.answers || {};

      // Interpretação dos valores estruturados
      const isAchadinhoProb = answers.is_achadinho?.noul ?? 0.5;
      const qualityTier = answers.quality_tier?.choice || 'solid_deal';
      const riskLevel = answers.risk_level?.choice || 'low_risk';
      const needsDeepAnalysisProb = answers.needs_deep_analysis?.noul ?? 0.2;

      // Score JEV em escala 0-100 (0 a 3 mapeado para ~0 a 100)
      const rawScore = answers.decision_score?.score ?? 2.0;
      const jevScore = Math.max(0, Math.min(100, Math.round(rawScore * 33.33)));

      // Determina escalonamento
      // Escala se JEV indicar incerteza, ou se o preço for alto (> R$ 250) com score limítrofe
      const needsEscalation =
        needsDeepAnalysisProb >= 0.45 ||
        (candidate.currentPrice > 250 && jevScore >= 65 && jevScore <= 80);

      // Gera justificativa estruturada a partir das respostas do JEV
      let reason = `Classificado como "${qualityTier}" pelo JEV (probabilidade de achadinho: ${Math.round(isAchadinhoProb * 100)}%).`;
      if (candidate.realDiscountVsAvg > 5) {
        reason += ` Desconto real de ${candidate.realDiscountVsAvg}% sobre a média histórica.`;
      }

      let risk = riskLevel === 'high_risk'
        ? 'Risco alto identificado pelo modelo de decisão.'
        : riskLevel === 'moderate_risk'
        ? 'Risco moderado: atenção à validação de especificações.'
        : 'Nenhum risco relevante detectado.';

      return {
        ok: true,
        data: {
          jevDecisionScore: jevScore,
          jevQualityTier: qualityTier,
          jevIsAchadinho: Math.round(isAchadinhoProb * 100) / 100,
          jevRiskLevel: riskLevel,
          jevNeedsEscalation: needsEscalation,
          aiScore: jevScore,
          reasons: reason,
          risks: risk,
          confidence: answers.decision_score?.confidence ?? 0.85,
        },
        usage: json.usage || { input_tokens: 0, output_tokens: 0, cost: 0 },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Avalia em lote uma lista de candidatos pré-selecionados.
   *
   * @param {Array<object>} candidates - Lista de até 15 candidatos
   * @param {object} [options]
   * @param {number} [options.concurrency=4]
   * @returns {Promise<{
   *   evaluated: Array<object>,
   *   tokensUsed: { inputTokens: number, outputTokens: number, totalCalls: number },
   *   needsEscalation: Array<object>,
   *   failures: number
   * }>}
   */
  async evaluateCandidatesBatch(candidates, { concurrency = 4 } = {}) {
    const results = [];
    const tokensUsed = { inputTokens: 0, outputTokens: 0, totalCalls: 0 };
    let failures = 0;

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return { evaluated: [], tokensUsed, needsEscalation: [], failures: 0 };
    }

    logger.info(`[JevAgent] Iniciando avaliação de ${candidates.length} candidatos via ${this.model}...`);

    // Processamento com concorrência controlada
    for (let i = 0; i < candidates.length; i += concurrency) {
      const slice = candidates.slice(i, i + concurrency);
      const promises = slice.map(async (cand) => {
        const res = await this.evaluateCandidate(cand);
        if (res.ok && res.data) {
          tokensUsed.totalCalls++;
          tokensUsed.inputTokens += res.usage?.input_tokens || 0;
          tokensUsed.outputTokens += res.usage?.output_tokens || 0;
          return {
            ...cand,
            ...res.data,
            modelUsed: this.model,
          };
        }

        failures++;
        logger.warn(`[JevAgent] Falha na avaliação do item ${cand.productId}: ${res.error}`);
        // Fallback individual no item
        return {
          ...cand,
          jevDecisionScore: cand.localScore,
          jevQualityTier: 'unknown',
          jevIsAchadinho: 0.5,
          jevRiskLevel: 'unknown',
          jevNeedsEscalation: true, // Se falhou no JEV, encaminha para análise se necessário
          aiScore: cand.localScore,
          reasons: 'Classificação baseada em regras locais após indisponibilidade do JEV.',
          risks: 'Análise não assistida por System One.',
          modelUsed: 'local_fallback',
        };
      });

      const batchResults = await Promise.all(promises);
      results.push(...batchResults);
    }

    const needsEscalation = results.filter((r) => r.jevNeedsEscalation);

    logger.info(
      `[JevAgent] Concluído: ${results.length} avaliados, ${tokensUsed.totalCalls} chamadas, ` +
      `${tokensUsed.inputTokens} input tokens, ${needsEscalation.length} marcados para escalonamento.`
    );

    return {
      evaluated: results,
      tokensUsed,
      needsEscalation,
      failures,
    };
  }
}

export default JevAgent;
