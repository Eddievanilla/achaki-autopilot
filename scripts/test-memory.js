/**
 * ACHAki Autopilot — Teste de Memória Operacional (Fase 4.4)
 *
 * Executa uma busca real de ofertas com integração completa ao Supabase:
 *  - Coleta
 *  - Validação & Deduplicação
 *  - Gravação de produtos (Upsert em `products`)
 *  - Registro de histórico de preços (ignora repetições em `product_prices`)
 *  - Curadoria IA via OpenRouter
 *  - Registro de candidatos selecionados em `offer_candidates`
 *  - Verificação de integridade no Supabase (ausência de duplicatas)
 *
 * USO:
 *   npm run test:memory
 */

import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';
import OpenRouterAgent from '../src/agents/openrouter-agent.js';
import ProductSearchService from '../src/services/product-search.js';
import { supabase } from '../src/database/supabase.js';

function printBanner() {
  console.log('\n' +
    '╔══════════════════════════════════════════════════════════╗\n' +
    '║     ACHAki Autopilot — Teste Memória Operacional (F4.4)  ║\n' +
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

    console.log('1. Executando ciclo de pesquisa real e sincronização...');
    const result = await searchService.searchAndSelect({
      limit: 5,
      itemsPerMarketplace: 10,
    });

    console.log('\n2. Auditando integridade no banco de dados Supabase...');

    // Contagem de produtos no banco
    const { count: totalProducts, error: prodErr } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true });

    if (prodErr) throw new Error('Erro ao contar products: ' + prodErr.message);

    // Contagem de preços no banco
    const { count: totalPrices, error: priceErr } = await supabase
      .from('product_prices')
      .select('*', { count: 'exact', head: true });

    if (priceErr) throw new Error('Erro ao contar product_prices: ' + priceErr.message);

    // Contagem de candidatos selecionados
    const { count: totalCandidates, error: candErr } = await supabase
      .from('offer_candidates')
      .select('*', { count: 'exact', head: true });

    if (candErr) throw new Error('Erro ao contar offer_candidates: ' + candErr.message);

    // Verificação estrita de duplicações na tabela products
    let hasDuplicates = false;
    const { data: allProds, error: allProdsErr } = await supabase
      .from('products')
      .select('marketplace, marketplace_product_id');

    if (allProdsErr) throw new Error('Erro ao listar produtos para checagem: ' + allProdsErr.message);

    if (allProds) {
      const keys = new Set();
      for (const p of allProds) {
        const key = `${p.marketplace}:${p.marketplace_product_id}`;
        if (keys.has(key)) {
          hasDuplicates = true;
          break;
        }
        keys.add(key);
      }
    }

    const mem = result.stats.memory || {};

    console.log('──────────────────────────────────────────────────────────');
    console.log('RESULTADO DA MEMÓRIA OPERACIONAL');
    console.log('──────────────────────────────────────────────────────────');
    console.log(`  Produtos Coletados (após filtros) : ${result.stats.afterFilter}`);
    console.log(`  Produtos Novos Inseridos          : ${mem.newCount ?? 0}`);
    console.log(`  Produtos Atualizados              : ${mem.updatedCount ?? 0}`);
    console.log(`  Preços Registrados                : ${mem.pricesRecorded ?? 0}`);
    console.log(`  Preços Repetidos Ignorados        : ${mem.pricesSkipped ?? 0}`);
    console.log(`  Candidatos IA Salvos              : ${mem.candidatesSaved ?? 0}`);
    console.log(`  Total no Banco (products)         : ${totalProducts}`);
    console.log(`  Total no Banco (product_prices)   : ${totalPrices}`);
    console.log(`  Total no Banco (offer_candidates) : ${totalCandidates}`);
    console.log(`  Duplicação em products            : ${hasDuplicates ? 'SIM' : 'NÃO'}`);
    console.log('──────────────────────────────────────────────────────────\n');

  } finally {
    await browserManager.close();
  }
}

main().catch((err) => {
  console.error('\n❌ Falha no teste de memória:', err.message);
  process.exit(1);
});
