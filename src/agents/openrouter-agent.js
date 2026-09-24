/**
 * ACHAki Autopilot — OpenRouterAgent
 *
 * Responsável por TODA comunicação com a API OpenRouter.
 *
 * Modelos separados por responsabilidade:
 *  - DECISION_MODEL  → comparar, rankear, selecionar, analisar
 *  - CONTENT_MODEL   → títulos, legendas, chamadas, hashtags
 *
 * Regras de custo:
 *  - A IA NÃO controla o navegador (Playwright faz isso).
 *  - A IA só é chamada quando há ANÁLISE, DECISÃO, CLASSIFICAÇÃO
 *    ou GERAÇÃO DE CONTEÚDO a realizar.
 *
 * Segurança:
 *  - A API key NUNCA é logada, impressa ou exposta.
 *  - Headers de autenticação nunca aparecem nos logs.
 *
 * Node.js 18+ → usa fetch nativo (Node 25 incluso).
 */

import logger from '../utils/logger.js';

// ─── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Lê e valida uma variável de ambiente numérica.
 * @param {string} key
 * @param {number} defaultValue
 * @returns {number}
 */
function envInt(key, defaultValue) {
  const v = parseInt(process.env[key], 10);
  return isNaN(v) ? defaultValue : v;
}

/**
 * Mascara a API key para logs de debug (nunca expõe a chave real).
 * @param {string} key
 * @returns {string}
 */
function maskKey(key) {
  if (!key || key.length < 8) return '***';
  return key.slice(0, 6) + '...' + key.slice(-4);
}

/**
 * Aguarda ms milissegundos.
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Classe principal ─────────────────────────────────────────────────────────

class OpenRouterAgent {
  constructor() {
    this.apiKey        = process.env.OPENROUTER_API_KEY        || '';
    this.decisionModel = process.env.OPENROUTER_DECISION_MODEL || '';
    this.contentModel  = process.env.OPENROUTER_CONTENT_MODEL  || '';
    this.offlineMode = !this.apiKey || !this.decisionModel || !this.contentModel;

    this.maxTokensDecision = envInt('OPENROUTER_MAX_TOKENS_DECISION', 1000);
    this.maxTokensContent  = envInt('OPENROUTER_MAX_TOKENS_CONTENT',  500);
    this.timeoutMs         = envInt('OPENROUTER_TIMEOUT_MS',          30000);
    this.maxRetries        = envInt('OPENROUTER_MAX_RETRIES',          2);

    this.baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
  }

  // ─── Validação de pré-condições ─────────────────────────────────────────────

  /**
   * Verifica se a API key está configurada.
   * @throws {Error} se a chave estiver ausente
   */
  _requireApiKey() {
    if (this.offlineMode) {
      return;
    }
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error(
        'OPENROUTER_API_KEY não configurada.\n' +
        'Insira sua chave no arquivo .env e execute novamente:\n' +
        'npm run test:openrouter'
      );
    }
  }

  /**
   * Verifica se um modelo está configurado para o tipo solicitado.
   * @param {'decision'|'content'} type
   * @throws {Error} se o modelo estiver ausente
   */
  _requireModel(type) {
    if (this.offlineMode) {
      return;
    }
    const model = type === 'decision' ? this.decisionModel : this.contentModel;
    const envKey = type === 'decision'
      ? 'OPENROUTER_DECISION_MODEL'
      : 'OPENROUTER_CONTENT_MODEL';

    if (!model || model.trim() === '') {
      throw new Error(
        `${envKey} não configurado.\n` +
        `Defina o modelo no arquivo .env.\n` +
        `Exemplos: openai/gpt-4o-mini | google/gemini-flash-1.5 | meta-llama/llama-3.1-8b-instruct`
      );
    }
  }

  // ─── Requisição HTTP com retry ────────────────────────────────────────────────

  /**
   * Envia uma requisição à API OpenRouter com retry automático.
   * A API key é transmitida apenas no Authorization header — nunca logada.
   *
   * @param {object} payload - Corpo da requisição (messages, model, etc.)
   * @param {'decision'|'content'} operationType - Para logging
   * @returns {Promise<object>} Resposta JSON da API
   */
  async _request(payload, operationType) {
    // Ensure the API returns a JSON object in the content field
    if (!payload.response_format) {
      payload.response_format = { type: 'json_object' };
    }
    this._requireApiKey();

    const startTime = Date.now();
    let lastError   = null;

    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      try {
        logger.info(
          `[OpenRouter] Chamada #${attempt} | op=${operationType} | model=${payload.model}`
        );

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        let response;
        try {
          response = await fetch(this.baseUrl, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              // A chave NUNCA será impressa em log — apenas transmitida aqui
              'Authorization': `Bearer ${this.apiKey}`,
              'HTTP-Referer': 'https://github.com/achaki-autopilot',
              'X-Title': 'ACHAki Autopilot',
            },
            body: JSON.stringify(payload),
          });
        } finally {
          clearTimeout(timer);
        }

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          throw new Error(
            `HTTP ${response.status} ${response.statusText} — ${errorBody.slice(0, 200)}`
          );
        }

        const data = await response.json();
        const elapsed = Date.now() - startTime;

        // Log de uso (sem expor a chave)
        const usage = data.usage || {};
        logger.info(
          `[OpenRouter] Concluído | op=${operationType} | model=${payload.model} | ` +
          `prompt_tokens=${usage.prompt_tokens ?? '?'} | ` +
          `completion_tokens=${usage.completion_tokens ?? '?'} | ` +
          `tempo=${elapsed}ms`
        );

        return data;

      } catch (err) {
        lastError = err;
        const isAbort = err.name === 'AbortError';

        if (isAbort) {
          logger.warn(`[OpenRouter] Timeout após ${this.timeoutMs}ms (tentativa ${attempt})`);
        } else {
          logger.warn(`[OpenRouter] Erro na tentativa ${attempt}: ${err.message}`);
        }

        if (attempt <= this.maxRetries) {
          const delay = 1000 * attempt; // backoff simples
          logger.info(`[OpenRouter] Aguardando ${delay}ms antes de retry...`);
          await sleep(delay);
        }
      }
    }

    throw new Error(
      `[OpenRouter] Todas as ${this.maxRetries + 1} tentativas falharam. ` +
      `Último erro: ${lastError?.message}`
    );
  }

  // ─── Parser de resposta JSON estruturada ─────────────────────────────────────

  /**
   * Extrai o conteúdo de texto da resposta OpenRouter.
   * @param {object} data - Resposta bruta da API
   * @returns {string}
   */
  _extractText(data) {
    const message = data?.choices?.[0]?.message;
    const content = message?.content ?? (typeof message === 'string' ? message : null);
    if (typeof content !== 'string') {
      throw new Error('[OpenRouter] Resposta inesperada: campo content ausente.');
    }
    return content.trim();
  }

  /**
   * Extrai e parseia JSON da resposta.
   * Suporta JSON embutido em bloco de código markdown.
   * @param {object} data - Resposta bruta da API
   * @returns {object}
   */
  _extractJSON(data) {
    const text = this._extractText(data);

    // Remove blocos markdown ```json ... ```
    const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '').trim();

    try {
      return JSON.parse(cleaned);
    } catch {
      throw new Error(
        `[OpenRouter] Não foi possível parsear JSON da resposta.\n` +
        `Conteúdo recebido:\n${text.slice(0, 500)}`
      );
    }
  }

  // ─── Métodos públicos ─────────────────────────────────────────────────────────

  /**
   * Rankeia uma lista de produtos por oportunidade de venda.
   *
   * @param {Array<{id: string, name: string, price: number, stars: number, sales: number}>} products
   * @returns {Promise<Array<{id: string, score: number, reasoning: string}>>}
   */
  async rankProducts(products) {
    if (this.offlineMode) {
      return {
        ranking: [...products].map((product, index) => ({
          productId: product.productId ?? product.id ?? index + 1,
          score: Number(product.score ?? product.finalScore ?? 50) || 50,
          reason: 'Modo local sem OpenRouter.',
        })),
      };
    }
    this._requireApiKey();
    this._requireModel('decision');

    logger.info(`[OpenRouter] rankProducts — ${products.length} produto(s)`);

    const payload = {
      model: this.decisionModel,
      max_tokens: this.maxTokensDecision,
      messages: [
        {
          role: 'system',
          content:
            'Você é um analista de e-commerce especialista em oportunidades de afiliado no Brasil. ' +
            'Avalie os produtos e retorne APENAS JSON válido, sem markdown.',
        },
        {
          role: 'user',
          content:
            `Rankei os produtos abaixo por potencial de venda como afiliado. ` +
            `Considere: preço acessível, alta avaliação, volume de vendas, apelo ao público brasileiro.\n\n` +
            `Produtos:\n${JSON.stringify(products, null, 2)}\n\n` +
            `Retorne JSON no formato:\n` +
            `{\n` +
            `  "ranking": [\n` +
            `    { "id": "A", "score": 9.2, "reasoning": "..." },\n` +
            `    ...\n` +
            `  ]\n` +
            `}`,
        },
      ],
    };

    const data   = await this._request(payload, 'decision');
    const result = this._extractJSON(data);

    if (!Array.isArray(result.ranking)) {
      throw new Error('[OpenRouter] rankProducts: resposta sem campo "ranking".');
    }

    return result.ranking;
  }

  /**
   * Seleciona as melhores ofertas de uma lista de produtos.
   *
   * @param {Array<object>} products - Lista de produtos
   * @param {number} limit - Quantidade máxima a selecionar
   * @returns {Promise<{selected: string[], reasoning: object, scores?: object, risks?: object}>}
   */
  async selectBestOffers(products, limit = 2) {
    if (this.offlineMode) {
      const selected = [...products]
        .sort((left, right) => Number(right.score ?? right.finalScore ?? 0) - Number(left.score ?? left.finalScore ?? 0))
        .slice(0, limit)
        .map((product) => product.productId ?? product.id)
        .filter(Boolean);

      return {
        selected,
        reasoning: { mode: 'local-fallback', note: 'Seleção feita sem OpenRouter.' },
        scores: Object.fromEntries(selected.map((id) => [id, 50])),
        risks: {},
      };
    }
    this._requireApiKey();
    this._requireModel('decision');

    logger.info(`[OpenRouter] selectBestOffers — ${products.length} produtos, limite ${limit}`);

    const payload = {
      model: this.decisionModel,
      max_tokens: Math.max(this.maxTokensDecision, 1500),
      messages: [
        {
          role: 'system',
          content:
            'Você é um curador de ofertas e achadinhos para afiliados no Brasil. ' +
            'Avalie as oportunidades com foco em apelo de achadinho, preço acessível, desconto real, popularidade e potencial de compra por impulso. ' +
            'Priorize diversidade (não selecione itens quase idênticos). ' +
            'Retorne APENAS JSON válido, sem texto adicional nem formatação extra.',
        },
        {
          role: 'user',
          content:
            `Selecione exatamente até ${limit} produto(s) com maior potencial de conversão e apelo de achadinho.\n` +
            `Para cada produto selecionado, atribua uma nota interna ACHAki (0 a 100), o motivo principal (curto, 1 a 2 frases) e eventuais riscos observados (curto, 1 frase).\n\n` +
            `Produtos:\n${JSON.stringify(products, null, 2)}\n\n` +
            `Retorne JSON no formato:\n` +
            `{\n` +
            `  "selected": ["id1", "id2"],\n` +
            `  "reasoning": {\n` +
            `    "id1": "motivo conciso da seleção (max 2 frases)",\n` +
            `    "id2": "motivo conciso da seleção (max 2 frases)"\n` +
            `  },\n` +
            `  "scores": {\n` +
            `    "id1": 92,\n` +
            `    "id2": 88\n` +
            `  },\n` +
            `  "risks": {\n` +
            `    "id1": "risco conciso (max 1 frase)",\n` +
            `    "id2": "nenhum risco relevante"\n` +
            `  }\n` +
            `}`,
        },
      ],
    };

    const data   = await this._request(payload, 'decision');
    const result = this._extractJSON(data);

    if (!Array.isArray(result.selected)) {
      throw new Error('[OpenRouter] selectBestOffers: resposta sem campo "selected".');
    }

    if (!result.reasoning || typeof result.reasoning !== 'object') {
      result.reasoning = {};
    }
    if (!result.scores || typeof result.scores !== 'object') {
      result.scores = {};
    }
    if (!result.risks || typeof result.risks !== 'object') {
      result.risks = {};
    }

    result.usage = data?.usage || null;

    return result;
  }

  /**
   * Gera um post/legenda para publicar um produto.
   *
   * @param {{name: string, price: number|string, stars: number, sales: number, link?: string}} product
   * @returns {Promise<{title: string, caption: string, hashtags: string[]}>}
   */
  async generatePost(product) {
    if (this.offlineMode) {
      const title = product.title || product.name || 'Achadinho ACHAki';
      return {
        title: title.length > 70 ? `${title.slice(0, 67)}...` : title,
        caption: `Oferta selecionada: ${title}. Confira os detalhes no link da publicação.`,
      };
    }
    this._requireApiKey();
    this._requireModel('content');

    logger.info(`[OpenRouter] generatePost — produto: ${product.name}`);

    const payload = {
      model: this.contentModel,
      max_tokens: this.maxTokensContent,
      messages: [
        {
          role: 'system',
          content:
            'Você é um copywriter especialista em marketing de afiliados no Facebook para o público brasileiro. ' +
            'Escreva posts curtos, diretos e persuasivos. Retorne APENAS JSON válido.',
        },
        {
          role: 'user',
          content:
            `Crie um post de oferta para o Facebook com base no produto abaixo.\n\n` +
            `Produto:\n${JSON.stringify(product, null, 2)}\n\n` +
            `Retorne JSON no formato:\n` +
            `{\n` +
            `  "title": "chamada principal curta",\n` +
            `  "caption": "legenda completa do post (max 3 linhas)",\n` +
            `  "hashtags": ["#oferta", "#achaki", "..."]\n` +
            `}`,
        },
      ],
    };

    const data   = await this._request(payload, 'content');
    const result = this._extractJSON(data);

    if (!result.title || !result.caption) {
      throw new Error('[OpenRouter] generatePost: resposta sem campos "title" ou "caption".');
    }

    return result;
  }

  /**
   * Analisa métricas de desempenho de publicações para aprendizado.
   *
   * @param {Array<{postId: string, views: number, clicks: number, conversions: number}>} metrics
   * @returns {Promise<{insights: string[], recommendations: string[]}>}
   */
  async analyzePerformance(metrics) {
    if (this.offlineMode) {
      return {
        summary: 'Modo local sem OpenRouter.',
        recommendations: ['Manter monitoramento local.', 'Revisar desempenho no dashboard.'],
      };
    }
    this._requireApiKey();
    this._requireModel('decision');

    logger.info(`[OpenRouter] analyzePerformance — ${metrics.length} publicação(ões)`);

    const payload = {
      model: this.decisionModel,
      max_tokens: this.maxTokensDecision,
      messages: [
        {
          role: 'system',
          content:
            'Você é um analista de marketing digital especializado em afiliados. ' +
            'Analise as métricas e retorne APENAS JSON válido.',
        },
        {
          role: 'user',
          content:
            `Analise as métricas das publicações abaixo e gere insights acionáveis.\n\n` +
            `Métricas:\n${JSON.stringify(metrics, null, 2)}\n\n` +
            `Retorne JSON no formato:\n` +
            `{\n` +
            `  "insights": ["insight 1", "insight 2"],\n` +
            `  "recommendations": ["recomendação 1", "recomendação 2"]\n` +
            `}`,
        },
      ],
    };

    const data   = await this._request(payload, 'decision');
    const result = this._extractJSON(data);

    return result;
  }
}

export default OpenRouterAgent;
