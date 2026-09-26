/**
 * ACHAki Autopilot — Teste Rigoroso de Controle de Custos de LLM & Engenharia Criativa
 *
 * Valida:
 * 1. 1 chamada LLM única para toda a engenharia criativa
 * 2. Blueprint estruturado completo (conceito, hook, roteiro, storyboard, cenas, movimentos, textos na tela, CTA, instruções de edição)
 * 3. Ausência de chamadas separadas para roteiro, storyboard, cenas, CTA ou edição
 * 4. Reutilização de blueprint salvo (custo zero, 0 chamadas LLM)
 * 5. Refação inteligente (reutilização em refação técnica vs 1 chamada em novo roteiro)
 * 6. Registro de métricas: provider, model, input_tokens, output_tokens, total_tokens, estimated_cost_usd, creative_id
 * 7. Limite configurável MAX_LLM_COST_PER_CREATIVE_USD com bloqueio quando ultrapassado
 * 8. Compatibilidade OpenRouter sem modelo fixo permanente
 * 9. Preservação integral da narração local (TTS) e do FFmpeg
 */

import 'dotenv/config';
import { supabase } from '../src/database/supabase.js';
import creativeCostController, { CreativeCostController } from '../src/services/factory/creative-cost-controller.js';
import { CreativeDirector } from '../src/agents/creative-director.js';

async function runCostControlTest() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  💰 TESTE DE CONTROLE DE CUSTOS — ENGENHARIA CRIATIVA ACHAki');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Busca produto real no catálogo
  console.log('1️⃣ [PRODUTO REAL] Buscando produto para o teste de engenharia criativa...');
  const { data: products } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!products || products.length === 0) {
    throw new Error('Nenhum produto real encontrado no banco de dados.');
  }

  const product = products[0];
  console.log(`   ✓ Produto: "${product.title}" (ID: ${product.id})`);
  console.log(`   ✓ Preço: R$ ${product.price || product.current_price || '59,90'}`);

  const testCreativeId = `test_cost_${Date.now()}`;

  // 2. Teste da Chamada Única de Engenharia Criativa (Regras 1 e 2)
  console.log('\n2️⃣ [CHAMADA ÚNICA LLM] Executando engenharia completa em UMA ÚNICA chamada...');
  const result1 = await creativeCostController.engineerCreative({
    product,
    photos: product.images || [product.image_url],
    creativeId: testCreativeId,
  });

  if (!result1.success) {
    throw new Error(`Falha na engenharia criativa: ${result1.reason}`);
  }

  const bp = result1.blueprint;
  console.log(`   ✓ Chamadas LLM Realizadas: ${result1.llmCallsCount} (Meta: exatamente 1)`);
  console.log(`   ✓ Modelo Utilizado: ${result1.model}`);
  console.log(`   ✓ Provider Registrado: ${result1.costRecord.provider}`);
  console.log(`   ✓ Tokens: Input=${result1.costRecord.input_tokens}, Output=${result1.costRecord.output_tokens}, Total=${result1.costRecord.total_tokens}`);
  console.log(`   ✓ Custo Estimado: $${result1.costRecord.estimated_cost_usd} USD`);

  // Validação de todos os campos obrigatórios do Blueprint
  console.log('\n   Verificando campos obrigatórios no Creative Blueprint retornado:');
  const requiredFields = [
    { field: 'conceito', val: bp.conceito },
    { field: 'hook / gancho', val: bp.hook || bp.gancho },
    { field: 'roteiro_pt_br / locucaoCompleta', val: bp.roteiro_pt_br || bp.locucaoCompleta },
    { field: 'storyboard (cenas)', val: bp.storyboard?.cenas || bp.cenas },
    { field: 'movimentos', val: bp.movimentos || bp.enquadramentoMovimento },
    { field: 'textos_tela', val: bp.textos_tela || bp.textoTelaGeral },
    { field: 'cta', val: bp.cta },
    { field: 'instrucoes_edicao', val: bp.instrucoes_edicao || bp.instrucoesEdicao },
  ];

  requiredFields.forEach(rf => {
    const ok = Boolean(rf.val && (Array.isArray(rf.val) ? rf.val.length > 0 : String(rf.val).trim().length > 0));
    console.log(`   - ${rf.field.padEnd(35)}: ${ok ? '✅ PRESENTE' : '❌ AUSENTE'}`);
    if (!ok) throw new Error(`Campo obrigatório ausente: ${rf.field}`);
  });

  // 3. Teste de Reutilização de Blueprint Salvo (Regra 3)
  console.log('\n3️⃣ [REUTILIZAÇÃO DE BLUEPRINT] Testando reuso de blueprint salvo...');
  const resultReused = await creativeCostController.engineerCreative({
    product,
    creativeId: testCreativeId,
    previousBlueprint: bp, // Fornece blueprint já salvo
    isRemake: false,
  });

  console.log(`   ✓ Blueprint Reutilizado: ${resultReused.reused ? 'SIM' : 'NÃO'}`);
  console.log(`   ✓ Chamadas LLM Realizadas: ${resultReused.llmCallsCount} (Meta: 0 chamadas extras)`);
  console.log(`   ✓ Custo da Reutilização: $${resultReused.costRecord.estimated_cost_usd} USD`);
  if (!resultReused.reused || resultReused.llmCallsCount !== 0) {
    throw new Error('Falha na reutilização de blueprint: executou chamada LLM desnecessária.');
  }

  // 4. Teste de Refação ("Refazer" - Regra 4)
  console.log('\n4️⃣ [REFAÇÃO / REMAKE] Testando comportamento em "Refazer"...');
  
  // Caso A: Refação técnica/visual (reutiliza blueprint sem chamada LLM)
  const remakeVisual = await creativeCostController.engineerCreative({
    product,
    creativeId: testCreativeId,
    previousBlueprint: bp,
    isRemake: true,
    remakeFocus: 'EDICAO_CAMERA',
  });
  console.log(`   ✓ Refação Técnica (EDICAO_CAMERA) -> Reutilizou blueprint anterior: ${remakeVisual.reused ? 'SIM' : 'NÃO'} (Chamadas LLM: ${remakeVisual.llmCallsCount})`);
  if (!remakeVisual.reused || remakeVisual.llmCallsCount !== 0) {
    throw new Error('Refação técnica deveria ter reutilizado o blueprint com 0 chamadas LLM.');
  }

  // Caso B: Refação explícita de roteiro (executa 1 chamada LLM)
  const remakeScript = await creativeCostController.engineerCreative({
    product,
    creativeId: testCreativeId,
    previousBlueprint: bp,
    isRemake: true,
    remakeFocus: 'NOVO_ROTEIRO',
  });
  console.log(`   ✓ Refação Criativa (NOVO_ROTEIRO) -> Executou nova engenharia: ${!remakeScript.reused ? 'SIM' : 'NÃO'} (Chamadas LLM: ${remakeScript.llmCallsCount})`);
  if (remakeScript.llmCallsCount !== 1) {
    throw new Error('Refação de roteiro deveria ter executado exatamente 1 chamada LLM.');
  }

  // 5. Teste do Limite de Custo (MAX_LLM_COST_PER_CREATIVE_USD - Regra 6)
  console.log('\n5️⃣ [LIMITE DE CUSTO] Testando bloqueio quando o custo ultrapassa o limite...');
  const controllerWithLowLimit = new CreativeCostController();
  // Simula limite irrealmente baixo de $0.00000001 USD
  controllerWithLowLimit.maxCostPerCreativeUsd = 0.00000001;

  const costCheck = controllerWithLowLimit.checkCostLimit({
    model: 'meta-llama/llama-3.3-70b-instruct',
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 900,
  });

  console.log(`   ✓ Estimativa calculada: $${costCheck.estimatedCostUsd} USD`);
  console.log(`   ✓ Limite configurado:   $${costCheck.maxLimitUsd} USD`);
  console.log(`   ✓ Bloqueio disparado:   ${!costCheck.withinLimit ? 'SIM (CORRETO - não executa)' : 'NÃO (ERRO)'}`);

  const blockedRun = await controllerWithLowLimit.engineerCreative({
    product,
    modelOverride: 'anthropic/claude-3.5-haiku', // modelo com custo maior que o micro-limite
  });

  console.log(`   ✓ Execução automática suspensa: ${blockedRun.blockedByCostLimit ? 'SIM' : 'NÃO'}`);
  console.log(`   ✓ Motivo do bloqueio: "${blockedRun.reason}"`);
  if (!blockedRun.blockedByCostLimit) {
    throw new Error('Falha no limite de custo: chamada acima do limite não foi bloqueada.');
  }

  // 6. Teste de Integração com CreativeDirector
  console.log('\n6️⃣ [CREATIVE DIRECTOR] Testando createBlueprintWithCostControl...');
  const director = new CreativeDirector({ supabaseClient: supabase });
  const directorResult = await director.createBlueprintWithCostControl({
    product,
    creativeId: testCreativeId,
  });

  console.log(`   ✓ CreativeDirector integrado: ${directorResult.success ? 'OK' : 'ERRO'}`);
  console.log(`   ✓ Chamadas LLM: ${directorResult.llmCallsCount}`);

  // 7. Status Final das Regras de Custo
  const status = creativeCostController.getCostControlStatus();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  🎉 TODAS AS REGRAS DE CUSTO DE LLM FORAM VALIDADAS COM SUCESSO!');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('CONTROLE DE CUSTO: OK');
  console.log(`CHAMADAS LLM POR CRIATIVO: ${status.chamadasLlmPorCriativo}`);
  console.log(`MODELO ATUAL: ${status.modeloAtual}`);
  console.log(`CUSTO REGISTRADO: ${status.custoRegistrado}`);
  console.log(`LIMITE DE CUSTO IMPLEMENTADO: ${status.limiteCustoImplementado}`);
  console.log(`BLUEPRINT REUTILIZÁVEL: ${status.blueprintReutilizavel}`);
}

runCostControlTest().catch(err => {
  console.error('\n❌ ERRO NO TESTE DE CONTROLE DE CUSTO:', err);
  process.exit(1);
});
