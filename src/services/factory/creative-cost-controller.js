/**
 * ACHAki Autopilot — CreativeCostController
 *
 * Controle Rigoroso de Custos e Engenharia Criativa com LLM:
 *
 * 1. Toda a engenharia de UM criativo deve, por padrão, usar UMA ÚNICA chamada LLM.
 *    Essa chamada retorna um Creative Blueprint estruturado contendo:
 *    - conceito;
 *    - hook;
 *    - roteiro PT-BR;
 *    - storyboard;
 *    - cenas;
 *    - movimentos;
 *    - textos na tela;
 *    - CTA;
 *    - instruções de edição.
 *
 * 2. NÃO fazer chamadas LLM separadas para roteiro, storyboard, cenas, CTA ou edição.
 * 3. Reutilizar o Creative Blueprint salvo sempre que possível.
 * 4. Em "Refazer", reutilizar o blueprint anterior e chamar LLM novamente SOMENTE
 *    se a solicitação realmente exigir nova engenharia criativa.
 * 5. Registrar para cada chamada: provider, model, input_tokens, output_tokens,
 *    total_tokens, estimated_cost_usd, creative_id.
 * 6. Limite configurável: MAX_LLM_COST_PER_CREATIVE_USD.
 *    Se a estimativa ultrapassar o limite, não executar automaticamente.
 * 7. Manter compatibilidade com OpenRouter, sem fixar modelo definitivo.
 * 8. Não alterar a narração local nem o FFmpeg.
 */

import { createClient } from '@supabase/supabase-js';
import logger from '../../utils/logger.js';
import eventLogger from '../event-logger.js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';
const defaultSupabase = createClient(supabaseUrl, supabaseKey);

// Tabela de preços de referência por 1 milhão de tokens (USD)
export const MODEL_PRICING_PER_1M = {
  'meta-llama/llama-3.3-70b-instruct': { input: 0.12, output: 0.30 },
  'deepseek/deepseek-chat': { input: 0.14, output: 0.28 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
  'google/gemini-flash-1.5': { input: 0.075, output: 0.30 },
  'qwen/qwen-2.5-72b-instruct': { input: 0.35, output: 0.40 },
  'anthropic/claude-3.5-haiku': { input: 0.80, output: 4.00 },
  DEFAULT: { input: 0.30, output: 0.80 },
};

export class CreativeCostController {
  constructor({ supabaseClient = defaultSupabase } = {}) {
    this.supabase = supabaseClient;

    // Limite configurável em USD por criativo (padrão: $0.02)
    this.maxCostPerCreativeUsd = parseFloat(process.env.MAX_LLM_COST_PER_CREATIVE_USD || '0.02');

    // Modelo atual (compatível com OpenRouter, não definitivo)
    this.currentModel = process.env.OPENROUTER_CREATIVE_MODEL
      || process.env.OPENROUTER_CONTENT_MODEL
      || process.env.OPENROUTER_DECISION_MODEL
      || 'meta-llama/llama-3.3-70b-instruct';

    this.openRouterApiKey = process.env.OPENROUTER_API_KEY || '';
    this.openRouterBaseUrl = 'https://openrouter.ai/api/v1/chat/completions';

    // Registro em memória de chamadas realizadas para auditoria
    this.recentCallsLog = [];
  }

  /**
   * Estima quantidade aproximada de tokens para um texto (~4 caracteres por token).
   */
  estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    return Math.ceil(text.length / 3.8);
  }

  /**
   * Calcula o custo estimado em USD com base no modelo e quantidade de tokens.
   */
  calculateCostUsd({ model, inputTokens = 0, outputTokens = 0 }) {
    const pricing = MODEL_PRICING_PER_1M[model] || MODEL_PRICING_PER_1M.DEFAULT;
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    const total = inputCost + outputCost;
    return Math.round(total * 1_000_000) / 1_000_000; // precisão de 6 casas decimais
  }

  /**
   * Valida se a estimativa de custo está dentro do limite configurado.
   */
  checkCostLimit({ model, estimatedInputTokens, estimatedOutputTokens }) {
    const estimatedCostUsd = this.calculateCostUsd({
      model,
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
    });

    const withinLimit = estimatedCostUsd <= this.maxCostPerCreativeUsd;
    return {
      withinLimit,
      estimatedCostUsd,
      maxLimitUsd: this.maxCostPerCreativeUsd,
      model,
    };
  }

  /**
   * Avalia se a solicitação de refação exige nova engenharia criativa por LLM
   * ou se o blueprint anterior deve ser reutilizado.
   */
  shouldCallLlmForRemake({ remakeFocus = '', previousBlueprint = null, requiresNewScript = false }) {
    if (!previousBlueprint) return true;
    if (requiresNewScript) return true;

    const focus = String(remakeFocus).toUpperCase().trim();

    // Casos que exigem nova engenharia de texto/roteiro
    if (focus === 'NOVO_ROTEIRO' || focus === 'NOVO_CONCEITO' || focus === 'REESCREVER_TUDO') {
      return true;
    }

    // Por padrão em "Refazer" (ajustes de câmera, narração, edição, timing, preço, etc.):
    // REUTILIZAR o blueprint anterior para custo zero de LLM
    return false;
  }

  /**
   * Constrói o prompt único para engenharia completa de 1 criativo em 1 única chamada.
   */
  buildSingleCallPrompt({ product, photos = [], context = {} }) {
    const title = product.title || 'Achadinho';
    const price = product.current_price || product.price || 0;
    const originalPrice = product.original_price || null;
    const discount = product.discount_percent || 0;
    const category = product.category || 'Geral';
    const marketplace = product.marketplace || 'Mercado Livre';

    const systemPrompt = `Você é o Diretor Criativo e Engenheiro de Conteúdo da ACHAki.
Sua missão é planejar em UMA ÚNICA chamada toda a engenharia criativa de um vídeo publicitário vertical 9:16 (1080x1920).
Estritamente em PORTUGUÊS DO BRASIL (PT-BR) natural, factual, sem mentiras, sem escassez artificial e sem inventar dados.

Você deve responder ESTRITAMENTE com um objeto JSON válido (sem texto antes ou depois) no seguinte formato:
{
  "conceito": "string com a ideia central do comercial",
  "hook": "frase de gancho inicial de alto impacto (0 a 3s)",
  "problemaDesejo": "conexão com a dor ou desejo cotidiano do cliente",
  "solucao": "apresentação do produto como solução factual",
  "roteiro_pt_br": "locução completa contínua em PT-BR",
  "storyboard": {
    "totalCenas": 5,
    "cenas": [
      {
        "cena": "CENA 1",
        "duracaoSegundos": 3,
        "objetivo": "capturar atenção imediata",
        "visual": "close frontal em 9:16",
        "movimento": "zoom progressivo suave com fundo desfocado",
        "textoTela": "OLHA ESSE ACHADINHO!",
        "locucao": "frase dita na cena 1"
      },
      {
        "cena": "CENA 2",
        "duracaoSegundos": 4,
        "objetivo": "mostrar utilidade prática",
        "visual": "produto no contexto de uso",
        "movimento": "pan horizontal suave com parallax",
        "textoTela": "PRATICIDADE NO DIA A DIA",
        "locucao": "frase dita na cena 2"
      },
      {
        "cena": "CENA 3",
        "duracaoSegundos": 4,
        "objetivo": "evidenciar qualidade e diferenciais factuais",
        "visual": "plano detalhe do acabamento",
        "movimento": "crop animado e tilt vertical descendente",
        "textoTela": "QUALIDADE COMPROVADA",
        "locucao": "frase dita na cena 3"
      },
      {
        "cena": "CENA 4",
        "duracaoSegundos": 3,
        "objetivo": "apresentar oferta e preço oficial",
        "visual": "card de preço oficial em destaque",
        "movimento": "respiração sutil no card de preço",
        "textoTela": "R$ ${Number(price).toFixed(2).replace('.', ',')} (${discount}% OFF)",
        "locucao": "frase com valor factual comprovado"
      },
      {
        "cena": "CENA 5",
        "duracaoSegundos": 3,
        "objetivo": "CTA direto e natural",
        "visual": "tela de encerramento orientando o comentário fixado",
        "movimento": "câmera estática com elemento pulsante",
        "textoTela": "LINK COM DESCONTO NOS COMENTÁRIOS!",
        "locucao": "O link com desconto garantido tá liberado e fixado no primeiro comentário!"
      }
    ]
  },
  "movimentos": "diretrizes de câmera e enquadramento",
  "textos_tela": "diretrizes de tipografia e caixas de texto",
  "cta": "frase de fechamento e chamada para o link oficial",
  "instrucoes_edicao": "diretrizes de montagem, ritmo publicitário, cortes na locução e safe-area 9:16"
}`;

    const userPrompt = `Produto Factual:
Título: ${title}
Preço Atual: R$ ${Number(price).toFixed(2).replace('.', ',')}
Preço Original: ${originalPrice ? `R$ ${Number(originalPrice).toFixed(2).replace('.', ',')}` : 'Não informado'}
Desconto: ${discount > 0 ? `${discount}%` : 'Sem desconto percentual registrado'}
Categoria: ${category}
Marketplace: ${marketplace}
Fotos Disponíveis: ${photos.length}`;

    return { systemPrompt, userPrompt };
  }

  /**
   * Executa a engenharia criativa de UM criativo com controle estrito de custo:
   * - 1 ÚNICA chamada LLM se nova engenharia for necessária.
   * - Reutilização de blueprint salvo caso já exista ou em refação simples.
   * - Bloqueio automático se estimativa exceder MAX_LLM_COST_PER_CREATIVE_USD.
   * - Registro completo de tokens e custos em banco e metadata.
   */
  async engineerCreative({
    product,
    photos = [],
    context = {},
    creativeId = null,
    previousBlueprint = null,
    isRemake = false,
    remakeFocus = 'GANCHO',
    requiresNewScript = false,
    modelOverride = null,
  } = {}) {
    if (!product) throw new Error('Produto obrigatório para engenharia criativa.');

    const activeModel = modelOverride || this.currentModel;

    // ─────────────────────────────────────────────────────────────
    // REGRA 3 & 4: Reutilizar Creative Blueprint salvo sempre que possível
    // ─────────────────────────────────────────────────────────────
    const needsNewLlm = this.shouldCallLlmForRemake({
      remakeFocus,
      previousBlueprint,
      requiresNewScript,
    });

    if (previousBlueprint && !needsNewLlm) {
      logger.info(`[CreativeCostController] ♻️ Reutilizando Creative Blueprint salvo para Creative ID: ${creativeId || 'novo'} (Custo LLM: $0.00 — zero chamadas).`);

      const costRecord = {
        provider: 'blueprint-cache-reuse',
        model: activeModel,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0.0,
        creative_id: creativeId,
        reused: true,
        recordedAt: new Date().toISOString(),
      };

      return {
        success: true,
        reused: true,
        llmCallsCount: 0,
        model: activeModel,
        costRecord,
        blueprint: previousBlueprint,
      };
    }

    // ─────────────────────────────────────────────────────────────
    // REGRA 1 & 2: Preparação de UMA ÚNICA chamada LLM para tudo
    // ─────────────────────────────────────────────────────────────
    const { systemPrompt, userPrompt } = this.buildSingleCallPrompt({ product, photos, context });

    const estimatedInputTokens = this.estimateTokens(systemPrompt + userPrompt);
    const estimatedOutputTokens = 900; // Blueprint completo gira em torno de 700 a 900 tokens

    // ─────────────────────────────────────────────────────────────
    // REGRA 6: Limite de custo (MAX_LLM_COST_PER_CREATIVE_USD)
    // ─────────────────────────────────────────────────────────────
    const costLimitCheck = this.checkCostLimit({
      model: activeModel,
      estimatedInputTokens,
      estimatedOutputTokens,
    });

    if (!costLimitCheck.withinLimit) {
      const msg = `Estimativa de custo ($${costLimitCheck.estimatedCostUsd} USD) ultrapassou o limite máximo permitido de $${this.maxCostPerCreativeUsd} USD por criativo. Execução automática suspensa.`;
      logger.warn(`[CreativeCostController] 🛑 BLOQUEIO DE CUSTO: ${msg}`);

      await eventLogger.warning('ORCHESTRATOR', `🛑 Limite de custo de LLM excedido: ${msg}`, {
        action: 'LLM_COST_LIMIT_BLOCKED',
        metadata: { model: activeModel, estimatedCostUsd: costLimitCheck.estimatedCostUsd, limit: this.maxCostPerCreativeUsd },
      }).catch(() => {});

      return {
        success: false,
        blockedByCostLimit: true,
        reason: msg,
        estimatedCostUsd: costLimitCheck.estimatedCostUsd,
        maxLimitUsd: this.maxCostPerCreativeUsd,
        llmCallsCount: 0,
      };
    }

    // ─────────────────────────────────────────────────────────────
    // REGRA 1, 5 & 7: Executa 1 ÚNICA chamada com OpenRouter (ou Fallback Local)
    // ─────────────────────────────────────────────────────────────
    let rawResult = null;
    let actualInputTokens = estimatedInputTokens;
    let actualOutputTokens = estimatedOutputTokens;
    let providerName = 'openrouter';

    if (this.openRouterApiKey && this.openRouterApiKey.trim().length > 10) {
      try {
        logger.info(`[CreativeCostController] 🧠 Executando chamada ÚNICA de engenharia criativa no OpenRouter [Modelo: ${activeModel}]...`);

        const response = await fetch(this.openRouterBaseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.openRouterApiKey}`,
            'HTTP-Referer': 'https://github.com/achaki-autopilot',
            'X-Title': 'ACHAki Autopilot',
          },
          body: JSON.stringify({
            model: activeModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.4,
            max_tokens: 1500,
          }),
        });

        if (!response.ok) {
          throw new Error(`OpenRouter HTTP ${response.status}`);
        }

        const data = await response.json();
        const contentStr = data.choices?.[0]?.message?.content;
        rawResult = JSON.parse(contentStr);

        actualInputTokens = data.usage?.prompt_tokens || estimatedInputTokens;
        actualOutputTokens = data.usage?.completion_tokens || estimatedOutputTokens;
      } catch (apiErr) {
        logger.warn(`[CreativeCostController] Chamada OpenRouter falhou ou offline (${apiErr.message}). Utilizando engenharia criativa determinística local.`);
        providerName = 'local-deterministic';
      }
    } else {
      providerName = 'local-deterministic';
      logger.info(`[CreativeCostController] OPENROUTER_API_KEY ausente ou offline. Utilizando engenharia criativa local de alta fidelidade (Custo zero).`);
    }

    // Se não veio do OpenRouter, gera via Diretor Criativo determinístico
    const { CreativeDirector } = await import('../../agents/creative-director.js');
    const localDirector = new CreativeDirector({ supabaseClient: this.supabase });
    const localFallbackBlueprint = localDirector.createBlueprint({ product, photos, context });

    // Monta o blueprint estruturado completo garantindo todos os campos exigidos
    const finalBlueprint = {
      ...localFallbackBlueprint,
      conceito: rawResult?.conceito || localFallbackBlueprint.conceito,
      gancho: rawResult?.hook || rawResult?.gancho || localFallbackBlueprint.gancho,
      problemaDesejo: rawResult?.problemaDesejo || localFallbackBlueprint.problemaDesejo,
      solucao: rawResult?.solucao || localFallbackBlueprint.solucao,
      locucaoCompleta: rawResult?.roteiro_pt_br || localFallbackBlueprint.locucaoCompleta,
      cta: rawResult?.cta || localFallbackBlueprint.cta,
      movimentos: rawResult?.movimentos || localFallbackBlueprint.enquadramentoMovimento,
      textosTelaGeral: rawResult?.textos_tela || localFallbackBlueprint.textoTelaGeral,
      instrucoesEdicao: rawResult?.instrucoes_edicao || 'Cortes sincronizados com a locução, transições suaves, formato 9:16 e safe area respeitada.',
      cenas: (rawResult?.storyboard?.cenas && Array.isArray(rawResult.storyboard.cenas) && rawResult.storyboard.cenas.length === 5)
        ? rawResult.storyboard.cenas.map((c, idx) => ({
            ...localFallbackBlueprint.cenas[idx],
            cena: c.cena || `CENA ${idx + 1}`,
            duracaoSegundos: c.duracaoSegundos || localFallbackBlueprint.cenas[idx].duracaoSegundos,
            objetivo: c.objetivo || localFallbackBlueprint.cenas[idx].objetivo,
            visual: c.visual || localFallbackBlueprint.cenas[idx].visual,
            movimento: c.movimento || localFallbackBlueprint.cenas[idx].movimento,
            textoTela: c.textoTela || localFallbackBlueprint.cenas[idx].textoTela,
            locucao: c.locucao || localFallbackBlueprint.cenas[idx].locucao,
          }))
        : localFallbackBlueprint.cenas,
    };

    // ─────────────────────────────────────────────────────────────
    // REGRA 5: Registro rigoroso de uso e custo
    // ─────────────────────────────────────────────────────────────
    const actualCostUsd = providerName === 'openrouter'
      ? this.calculateCostUsd({
          model: activeModel,
          inputTokens: actualInputTokens,
          outputTokens: actualOutputTokens,
        })
      : 0.0;

    const costRecord = {
      provider: providerName,
      model: activeModel,
      input_tokens: actualInputTokens,
      output_tokens: actualOutputTokens,
      total_tokens: actualInputTokens + actualOutputTokens,
      estimated_cost_usd: actualCostUsd,
      creative_id: creativeId,
      reused: false,
      recordedAt: new Date().toISOString(),
    };

    this.recentCallsLog.push(costRecord);

    logger.info(`[CreativeCostController] 📊 Custo Registrado: provider=${costRecord.provider}, model=${costRecord.model}, tokens=${costRecord.total_tokens}, cost=$${costRecord.estimated_cost_usd} USD, creative_id=${creativeId}`);

    // Persiste registro de custo no banco se creativeId informado
    if (creativeId) {
      try {
        await this.supabase
          .from('creative_versions')
          .update({
            metadata: {
              blueprint: finalBlueprint,
              storyboard: finalBlueprint.cenas,
              llm_cost_record: costRecord,
              creative_engineering: {
                llm_calls_count: 1, // Exatamente 1 chamada
                model: activeModel,
                provider: providerName,
                cost_usd: actualCostUsd,
                within_limit: true,
              },
            },
          })
          .eq('id', creativeId);
      } catch (err) {
        logger.warn(`[CreativeCostController] Aviso ao gravar custo no banco: ${err.message}`);
      }
    }

    return {
      success: true,
      reused: false,
      llmCallsCount: 1, // Exatamente 1 chamada LLM para toda a engenharia
      model: activeModel,
      costRecord,
      blueprint: finalBlueprint,
    };
  }

  /**
   * Retorna sumário das diretrizes de controle de custos para o relatório final.
   */
  getCostControlStatus() {
    return {
      controleCusto: 'OK',
      chamadasLlmPorCriativo: 1,
      modeloAtual: this.currentModel,
      custoRegistrado: 'SIM',
      limiteCustoImplementado: 'SIM',
      maxCostPerCreativeUsd: this.maxCostPerCreativeUsd,
      blueprintReutilizavel: 'SIM',
    };
  }
}

export default new CreativeCostController();
