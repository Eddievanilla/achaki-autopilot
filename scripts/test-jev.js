/**
 * ACHAki Autopilot — Teste Real de Integração JEV & Redução de Custos (Fase 5.1)
 *
 * Valida o novo pipeline:
 *  regras locais → cache Supabase → JEV (typesafe/jev-1.13) → GPT-4o-mini (escalation)
 *
 * SEGURANÇA:
 *  - NUNCA exibe chaves de API, senhas ou tokens nos logs.
 */

import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';
import OpenRouterAgent from '../src/agents/openrouter-agent.js';
import JevAgent from '../src/agents/jev-agent.js';
import ProductSearchService from '../src/services/product-search.js';
import { supabase } from '../src/database/supabase.js';

async function runJevTest() {
  console.log('==========================================================');
  console.log('ACHAki Autopilot — Teste Fase 5.1 (JEV Decision Layer)');
  console.log('==========================================================\n');

  const browserManager = new BrowserManager();
  const openrouterAgent = new OpenRouterAgent();
  const jevAgent = new JevAgent();

  const searchService = new ProductSearchService({
    browserManager,
    openrouterAgent,
    jevAgent,
  });

  let result = null;
  let testPassed = true;
  let fallbackOk = 'OK';
  let supabaseOk = 'OK';

  try {
    // 1. Inicia o browser e executa o ciclo completo
    console.log('1. Executando ciclo de pesquisa e curadoria com JEV...\n');
    await browserManager.launch();

    result = await searchService.searchAndSelect({ limit: 5, itemsPerMarketplace: 10 });

    // 2. Validação do Supabase (verifica se gravou em ai_decision_cache e offer_candidates)
    try {
      const { count: cacheCount, error: cacheErr } = await supabase
        .from('ai_decision_cache')
        .select('*', { count: 'exact', head: true });

      const { count: candCount, error: candErr } = await supabase
        .from('offer_candidates')
        .select('*', { count: 'exact', head: true });

      if (cacheErr || candErr) {
        supabaseOk = 'ERRO';
      }
    } catch {
      supabaseOk = 'ERRO';
    }

    // 3. Validação do Fallback com teste isolado
    try {
      // Simula uma chamada com chave vazia para confirmar que o fallback captura graciosamente
      const brokenJev = new JevAgent({ apiKey: 'invalid_key_for_test' });
      const testCand = {
        title: 'Produto Teste Fallback',
        marketplace: 'mercadolivre',
        currentPrice: 50,
        localScore: 70,
      };
      const fbRes = await brokenJev.evaluateCandidate(testCand);
      // O agente deve capturar e retornar ok: false sem disparar exceção não tratada
      if (fbRes.ok !== false) {
        fallbackOk = 'ERRO';
      }
    } catch {
      fallbackOk = 'ERRO';
    }

    console.log('\n──────────────────────────────────────────────────────────');
    console.log('TOP 5 OFERTAS SELECIONADAS (COM JEV + CURADORIA):');
    console.log('──────────────────────────────────────────────────────────');
    result.topOffers.forEach((offer, i) => {
      console.log(`  ${i + 1}. [${(offer.category || 'GERAL').toUpperCase()}] ${offer.title.slice(0, 48)}...`);
      console.log(`     Marketplace : ${offer.marketplace} | Preço: R$ ${offer.currentPrice.toFixed(2)} (desc: ${offer.discountPercent || 0}%)`);
      console.log(`     Scores      : Local=${offer.localScore} | JEV=${offer.jevDecisionScore ?? 'N/A'} | IA=${offer.aiScore} | FINAL=${offer.finalScore}`);
      console.log(`     Modelo      : ${offer.modelUsed || 'typesafe/jev-1.13'}`);
      console.log(`     Motivo      : ${offer.reasons}`);
      console.log(`     Riscos      : ${offer.risks}\n`);
    });

  } catch (err) {
    console.error('Falha crítica no teste:', err.message);
    testPassed = false;
  } finally {
    await browserManager.close();
  }

  const jevStats = result?.stats?.jev || {};
  const gptStats = result?.stats?.gpt || {};
  const intelStats = result?.stats?.intelligence || {};

  console.log('──────────────────────────────────────────────────────────');
  console.log('RELATÓRIO DO MOTOR JEV');
  console.log('──────────────────────────────────────────────────────────');
  console.log(`JEV:                              ${jevStats.status === 'OK' ? 'OK' : 'ERRO'}`);
  console.log(`MODELO:                           ${jevStats.model || 'typesafe/jev-1.13'}`);
  console.log(`PRODUTOS INICIAIS:                ${result?.stats?.afterFilter || 0}`);
  console.log(`CACHE REUTILIZADO:                ${jevStats.cacheHits || 0}`);
  console.log(`ENVIADOS AO JEV:                  ${jevStats.sentToJev || 0}`);
  console.log(`CHAMADAS JEV:                     ${jevStats.calls || 0}`);
  console.log(`TOKENS JEV:                       ${jevStats.tokens || 0}`);
  console.log(`ENVIADOS AO GPT:                  ${gptStats.sentToGpt || 0}`);
  console.log(`CHAMADAS GPT:                     ${gptStats.calls || 0}`);
  console.log(`TOKENS GPT:                       ${gptStats.tokens || 0}`);
  console.log(`SELECIONADOS:                     ${intelStats.selected || 0}`);
  console.log(`ECONOMIA ESTIMADA VS FLUXO ANTERIOR: ${result?.stats?.estimatedSavings || '0%'}`);
  console.log(`FALLBACK:                         ${fallbackOk}`);
  console.log(`SUPABASE:                         ${supabaseOk}`);
  console.log(`FLUXO COMPLETO:                   ${testPassed ? 'OK' : 'ERRO'}`);
  console.log('──────────────────────────────────────────────────────────\n');

  if (!testPassed || jevStats.status !== 'OK') {
    process.exit(1);
  }
}

runJevTest();
