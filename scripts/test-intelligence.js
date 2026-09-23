/**
 * ACHAki Autopilot — Teste do Motor Inteligente de Ofertas (Fase 5)
 *
 * Executa uma busca real de ofertas aplicando:
 *  - Memória operacional e histórico Supabase
 *  - Cálculo determinístico de LOCAL_SCORE
 *  - Detecção de descontos suspeitos e produtos repetidos
 *  - Pré-seleção de até 15 candidatos para envio à IA (economia de tokens)
 *  - Curadoria IA com OpenRouter
 *  - Cálculo do FINAL_SCORE (40% Local + 60% IA)
 *  - Garantia de DIVERSIDADE no TOP 5 (máximo 2 por categoria)
 *  - Gravação segura em offer_candidates
 *
 * USO:
 *   npm run test:intelligence
 */

import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';
import OpenRouterAgent from '../src/agents/openrouter-agent.js';
import ProductSearchService from '../src/services/product-search.js';
import { supabase } from '../src/database/supabase.js';

function printBanner() {
  console.log('\n' +
    '╔══════════════════════════════════════════════════════════╗\n' +
    '║   ACHAki Autopilot — Motor Inteligente de Ofertas (F5)   ║\n' +
    '╚══════════════════════════════════════════════════════════╝\n'
  );
}

async function main() {
  printBanner();

  const browserManager = new BrowserManager();
  const openrouterAgent = new OpenRouterAgent();

  try {
    await browserManager.launch();

    const searchService = new ProductSearchService({
      browserManager,
      openrouterAgent,
    });

    console.log('1. Executando ciclo de inteligência de ofertas...\n');
    const result = await searchService.searchAndSelect({
      limit: 5,
      itemsPerMarketplace: 10,
    });

    const intel = result.stats.intelligence || {};
    const mem = result.stats.memory || {};

    // Validar status no Supabase
    const { count: candidatesCount } = await supabase
      .from('offer_candidates')
      .select('*', { count: 'exact', head: true });

    // Validações determinísticas
    const localScoreOk = result.topOffers.every((o) => typeof o.localScore === 'number' && o.localScore >= 0 && o.localScore <= 100);
    const finalScoreOk = result.topOffers.every((o) => typeof o.finalScore === 'number' && o.finalScore >= 0 && o.finalScore <= 100);

    // Validação de diversidade (máximo 2 por categoria se houver múltiplas)
    const categoryFreq = {};
    for (const offer of result.topOffers) {
      const cat = offer.category || 'outros';
      categoryFreq[cat] = (categoryFreq[cat] || 0) + 1;
    }
    const maxInSingleCat = Math.max(...Object.values(categoryFreq));
    const diversityOk = maxInSingleCat <= 2 || intel.topCategories.length === 1;

    console.log('\n──────────────────────────────────────────────────────────');
    console.log('TOP 5 OFERTAS SELECIONADAS PELO MOTOR INTELIGENTE:');
    console.log('──────────────────────────────────────────────────────────');
    result.topOffers.forEach((o, i) => {
      console.log(`  ${i + 1}. [${o.category?.toUpperCase()}] ${o.title.slice(0, 48)}...`);
      console.log(`     Marketplace : ${o.marketplace} | Preço: R$ ${Number(o.currentPrice).toFixed(2)} (desc: ${o.announcedDiscount}%)`);
      console.log(`     Scores      : Local=${o.localScore} | IA=${o.aiScore} | FINAL=${o.finalScore}`);
      console.log(`     Confiança   : ${o.historyConfidence} (obs: ${o.priceObservations}x)`);
      console.log(`     Motivo      : ${o.reasons}`);
      console.log(`     Riscos      : ${o.risks}\n`);
    });

    console.log('──────────────────────────────────────────────────────────');
    console.log('RELATÓRIO DO MOTOR INTELIGENTE');
    console.log('──────────────────────────────────────────────────────────');
    console.log(`PRODUTOS ANALISADOS:             ${intel.analyzed ?? result.stats.afterFilter}`);
    console.log(`PRÉ-SELECIONADOS LOCALMENTE:     ${intel.preSelected ?? 0}`);
    console.log(`ENVIADOS À IA:                   ${intel.sentToAI ?? 0}`);
    console.log(`SELECIONADOS:                    ${intel.selected ?? result.topOffers.length}`);
    console.log(`CATEGORIAS NO TOP 5:             ${(intel.topCategories || []).join(', ')}`);
    console.log(`HISTÓRICO LOW/MEDIUM/HIGH:       LOW=${intel.confidenceCounts?.LOW || 0}, MEDIUM=${intel.confidenceCounts?.MEDIUM || 0}, HIGH=${intel.confidenceCounts?.HIGH || 0}`);
    console.log(`PRODUTOS REPETIDOS PENALIZADOS:  ${intel.repeatedPenalties ?? 0}`);
    console.log(`DESCONTOS SUSPEITOS PENALIZADOS: ${intel.suspiciousDiscounts ?? 0}`);
    console.log(`TOKENS UTILIZADOS:               ${intel.tokensUsed ?? 'N/A'}`);
    console.log(`LOCAL SCORE:                     ${localScoreOk ? 'OK' : 'ERRO'}`);
    console.log(`FINAL SCORE:                     ${finalScoreOk ? 'OK' : 'ERRO'}`);
    console.log(`DIVERSIDADE:                     ${diversityOk ? 'OK' : 'ERRO'}`);
    console.log(`MEMÓRIA SUPABASE:                ${mem.candidatesSaved > 0 ? 'OK' : 'ERRO'}`);
    console.log(`FLUXO COMPLETO:                  OK`);
    console.log('──────────────────────────────────────────────────────────\n');

  } finally {
    await browserManager.close();
  }
}

main().catch((err) => {
  console.error('\n❌ Falha no teste de inteligência:', err.message);
  process.exit(1);
});
