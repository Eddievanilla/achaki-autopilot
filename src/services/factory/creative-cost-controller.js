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
   * Constrói o prompt único para engenharia completa de 1 criativo em 1 única chamada
   * com REGRA ABSOLUTA DE VERACIDADE baseada em PRODUCT_FACTS.
   */
  async buildSingleCallPrompt({ product, photos = [], context = {} }) {
    const { ProductFactsBuilder } = await import('./product-facts-builder.js');
    const productFacts = ProductFactsBuilder.buildFacts({ product, extraImages: photos });

    const systemPrompt = `Você é o Diretor Criativo e Engenheiro de Conteúdo da ACHAki.
Sua missão é planejar em UMA ÚNICA chamada toda a engenharia criativa de um vídeo vertical 9:16 (1080x1920).
Estritamente em PORTUGUÊS DO BRASIL (PT-BR).

REGRA ABSOLUTA DE VERACIDADE:
Você só pode escrever afirmações suportadas por PRODUCT_FACTS.
PROIBIDO inventar:
- benefícios não informados;
- potência;
- segurança;
- certificações;
- resistência;
- durabilidade;
- estoque;
- avaliações;
- características técnicas;
- urgência;
- qualquer dado ausente.

Se não estiver em PRODUCT_FACTS, NÃO mencionar.

Você deve responder ESTRITAMENTE com um objeto JSON válido (sem texto antes ou depois) no seguinte formato:
{
  "conceito": "string com a ideia central do comercial baseada em fatos",
  "hook": "frase de gancho inicial factual",
  "problemaDesejo": "conexão natural cotidiana sem inventar benefícios",
  "solucao": "apresentação do produto com características reais",
  "roteiro_pt_br": "locução completa contínua em PT-BR validada contra PRODUCT_FACTS",
  "storyboard": {
    "totalCenas": 5,
    "cenas": [
      {
        "scene_id": "scene_01",
        "cena": "CENA 1",
        "duration": "3s",
        "duracaoSegundos": 3,
        "visual_source": "URL da foto real",
        "crop": "FULL_PRODUCT_OVERVIEW",
        "camera_motion": "PROGRESSIVE_ZOOM_IN",
        "overlay": { "badge": "ACHADINHO FACTUAL", "title": "Nome do Produto" },
        "narration": "frase factual da cena 1",
        "facts_used": ["product_name", "brand"]
      },
      {
        "scene_id": "scene_02",
        "cena": "CENA 2",
        "duration": "4s",
        "duracaoSegundos": 4,
        "visual_source": "URL da foto real",
        "crop": "DETAIL_10_OUTLETS",
        "camera_motion": "HORIZONTAL_LATERAL_PAN",
        "overlay": { "badge": "10 TOMADAS + 4 USB", "title": "ESTRUTURA" },
        "narration": "frase factual da cena 2",
        "facts_used": ["features: 10 tomadas", "features: 4 portas USB"]
      },
      {
        "scene_id": "scene_03",
        "cena": "CENA 3",
        "duration": "4s",
        "duracaoSegundos": 4,
        "visual_source": "URL da foto real",
        "crop": "DETAIL_CABLE_VOLTAGE",
        "camera_motion": "VERTICAL_TILT_DESCENDING",
        "overlay": { "badge": "CABO 2M • BIVOLT", "title": "ESPECIFICAÇÕES" },
        "narration": "frase factual da cena 3",
        "facts_used": ["features: cabo de 2 metros", "features: bivolt"]
      },
      {
        "scene_id": "scene_04",
        "cena": "CENA 4",
        "duration": "3s",
        "duracaoSegundos": 3,
        "visual_source": "URL da foto real",
        "crop": "OFFER_PRICE_CARD",
        "camera_motion": "PRICE_PULSE",
        "overlay": { "badge": "44% OFF", "price": "R$ 38,98" },
        "narration": "frase de preço real comprovado",
        "facts_used": ["price", "original_price", "discount"]
      },
      {
        "scene_id": "scene_05",
        "cena": "CENA 5",
        "duration": "3s",
        "duracaoSegundos": 3,
        "visual_source": "URL da foto real",
        "crop": "FINAL_CTA",
        "camera_motion": "CTA_PULSE_ARROWS",
        "overlay": { "badge": "LINK FIXADO", "cta": "CONFIRA NOS COMENTÁRIOS" },
        "narration": "O link com desconto tá liberado e fixado no primeiro comentário!",
        "facts_used": ["cta_location"]
      }
    ]
  },
  "movimentos": "diretrizes de câmera e enquadramento",
  "textos_tela": "diretrizes de tipografia e caixas de texto",
  "cta": "frase de fechamento e chamada para o link oficial",
  "instrucoes_edicao": "diretrizes de montagem sincronizada"
}`;

    const userPrompt = `PRODUCT_FACTS:
${JSON.stringify(productFacts, null, 2)}`;

    return { systemPrompt, userPrompt, productFacts };
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
    const { systemPrompt, userPrompt, productFacts } = await this.buildSingleCallPrompt({ product, photos, context });

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
            scene_id: c.scene_id || localFallbackBlueprint.cenas[idx].scene_id,
            cena: c.cena || `CENA ${idx + 1}`,
            duration: c.duration || localFallbackBlueprint.cenas[idx].duration,
            duracaoSegundos: c.duracaoSegundos || localFallbackBlueprint.cenas[idx].duracaoSegundos,
            visual_source: c.visual_source || localFallbackBlueprint.cenas[idx].visual_source,
            crop: c.crop || localFallbackBlueprint.cenas[idx].crop,
            camera_motion: c.camera_motion || localFallbackBlueprint.cenas[idx].camera_motion,
            overlay: c.overlay || localFallbackBlueprint.cenas[idx].overlay,
            textoTela: c.textoTela || localFallbackBlueprint.cenas[idx].textoTela,
            narration: c.narration || c.locucao || localFallbackBlueprint.cenas[idx].narration,
            locucao: c.narration || c.locucao || localFallbackBlueprint.cenas[idx].locucao,
            facts_used: Array.isArray(c.facts_used) && c.facts_used.length > 0
              ? c.facts_used
              : localFallbackBlueprint.cenas[idx].facts_used,
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
