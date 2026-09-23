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
      id: candidate.productId,
      cat: candidate.category || 'outros',
      price: candidate.currentPrice,
      desc: candidate.announcedDiscount || candidate.discountPercent || 0,
      score: candidate.localScore,
      hist: candidate.historyConfidence || 'LOW',
      rate: candidate.rating || undefined,
      revs: candidate.reviewCount || undefined,
      reps: candidate.selectionFrequency || 0,
      pub: candidate.isPublished || false,
    };

    const questions = {
      is_achadinho: {
        type: 'noul',
        instructions: 'Is this an attractive deal for impulse buying?',
      },
      quality_tier: {
        type: 'choice',
        instructions: 'Deal tier:',
        criteria: {
          top: 'High viral appeal and great price',
          solid: 'Standard useful deal with fair discount',
          poor: 'Weak discount or low utility',
        },
      },
      decision_score: {
        type: 'score',
        instructions: 'Affiliate suitability (0-100 scale):',
        criteria: [
          'Reject',
          'Neutral',
          'Recommended',
          'Top Pick',
        ],
      },
    };

    const body = {
      model: this.model,
      state: { item: state },
      questions,
    };

    // Função interna com suporte a 1 retry em caso de HTTP 529/429
    const executeFetch = async (isRetry = false) => {
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

        // Tratamento de HTTP 529 (overloaded) ou 429 com 1 retry
        if ((response.status === 529 || response.status === 429) && !isRetry) {
          logger.warn(`[JevAgent] HTTP ${response.status} detectado. Aguardando 1.5s para retry com backoff...`);
          await new Promise((res) => setTimeout(res, 1500));
          return executeFetch(true);
        }

        if (!response.ok) {
          const errorText = await response.text();
          return { ok: false, status: response.status, error: `HTTP ${response.status}: ${errorText.slice(0, 100)}` };
        }

        const json = await response.json();
        return { ok: true, json };
      } catch (err) {
        if (!isRetry) {
          await new Promise((res) => setTimeout(res, 1000));
          return executeFetch(true);
        }
        return { ok: false, error: err.message };
      }
    };

    const fetchResult = await executeFetch();

    if (!fetchResult.ok) {
      // Se indisponível (ex: 529 persistente), usa LocalScore diretamente sem acionar GPT
      return {
        ok: false,
        fallbackData: {
          jevDecisionScore: candidate.localScore,
          jevQualityTier: 'solid',
          jevIsAchadinho: 0.7,
          jevNeedsEscalation: false, // Nunca forçar escalonamento por falha de infraestrutura
          aiScore: candidate.localScore,
          reasons: 'Classificação orientada por regras locais (resiliência de infraestrutura).',
          risks: 'Análise mantida sem escalonamento.',
          confidence: 0.75,
        },
        error: fetchResult.error,
      };
    }

    const answers = fetchResult.json?.answers || {};
    const isAchadinhoProb = answers.is_achadinho?.noul ?? 0.6;
    const qualityTier = answers.quality_tier?.choice || 'solid';

    // Score JEV normalizado 0 a 100
    const rawScore = answers.decision_score?.score ?? 2.0;
    const jevScore = Math.max(0, Math.min(100, Math.round(rawScore * 33.33)));
    const confidence = answers.decision_score?.confidence ?? 0.85;

    // Regra estrita de escalonamento: somente ambiguidade real
    // 1. Confiança baixa (< 0.50)
    // 2. OU Conflito severo entre LocalScore e JEV (|local - jev| >= 35)
    const severeConflict = Math.abs((candidate.localScore || 50) - jevScore) >= 35;
    const isAmbiguous = confidence < 0.50;
    const needsEscalation = isAmbiguous || severeConflict;

    let reason = `Classificado como "${qualityTier}" pelo JEV (apelo de achadinho: ${Math.round(isAchadinhoProb * 100)}%).`;
    if (candidate.realDiscountVsAvg > 5) {
      reason += ` Desconto real de ${candidate.realDiscountVsAvg}% sobre a média histórica.`;
    }

    return {
      ok: true,
      data: {
        jevDecisionScore: jevScore,
        jevQualityTier: qualityTier,
        jevIsAchadinho: Math.round(isAchadinhoProb * 100) / 100,
        jevNeedsEscalation: needsEscalation,
        aiScore: jevScore,
        reasons: reason,
        risks: qualityTier === 'poor' ? 'Qualidade ou apelo abaixo da média.' : 'Nenhum risco crítico identificado.',
        confidence,
      },
      usage: fetchResult.json?.usage || { input_tokens: 0, output_tokens: 0, cost: 0 },
    };
  }

  /**
   * Avalia em lote uma lista de candidatos pré-selecionados com controle de taxa e concorrência.
   *
   * @param {Array<object>} candidates - Lista de candidatos competitivos
   * @param {object} [options]
   * @param {number} [options.concurrency=3]
   * @returns {Promise<{
   *   evaluated: Array<object>,
   *   tokensUsed: { inputTokens: number, outputTokens: number, totalCalls: number },
   *   needsEscalation: Array<object>,
   *   failures: number
   * }>}
   */
  async evaluateCandidatesBatch(candidates, { concurrency = 3 } = {}) {
    const results = [];
    const tokensUsed = { inputTokens: 0, outputTokens: 0, totalCalls: 0 };
    let failures = 0;

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return { evaluated: [], tokensUsed, needsEscalation: [], failures: 0 };
    }

    logger.info(`[JevAgent] Iniciando avaliação otimizada de ${candidates.length} candidatos via ${this.model}...`);

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

        // Fallback seguro usando LocalScore
        failures++;
        logger.warn(`[JevAgent] Resiliência ativada para item ${cand.productId}: ${res.error}`);
        const fb = res.fallbackData || {};
        return {
          ...cand,
          jevDecisionScore: fb.jevDecisionScore ?? cand.localScore,
          jevQualityTier: fb.jevQualityTier ?? 'solid',
          jevIsAchadinho: fb.jevIsAchadinho ?? 0.6,
          jevNeedsEscalation: false, // Não escalar falhas de rede para o GPT
          aiScore: cand.localScore,
          reasons: fb.reasons || 'Decisão baseada em regras locais determinísticas.',
          risks: fb.risks || 'Análise mantida sem escalonamento.',
          modelUsed: 'local_resilience',
        };
      });

      const batchResults = await Promise.all(promises);
      results.push(...batchResults);

      // Pequena pausa entre lotes para prevenir sobrecarga de requisições no OpenRouter (HTTP 529)
      if (i + concurrency < candidates.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
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
