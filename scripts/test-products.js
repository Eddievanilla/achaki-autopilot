/**
 * ACHAki Autopilot — Teste Real de Pesquisa de Produtos (Fase 4)
 *
 * Executa o fluxo completo da Fase 4:
 *  1. Abre Chromium ACHAki com perfil persistente (data/browser-profile)
 *  2. Pesquisa produtos reais no Mercado Livre e Shopee
 *  3. Coleta e normaliza para o modelo padrão ACHAki
 *  4. Aplica filtro determinístico e deduplicação local
 *  5. Envia finalistas compactos para análise do OpenRouter
 *  6. Seleciona o Top 5 melhores achadinhos com score, motivos e riscos
 *
 * USO:
 *   npm run test:products
 */

import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';
import OpenRouterAgent from '../src/agents/openrouter-agent.js';
import ProductSearchService from '../src/services/product-search.js';
import logger from '../src/utils/logger.js';

function printBanner() {
  console.log('\n' +
    '╔══════════════════════════════════════════════════════════╗\n' +
    '║     ACHAki Autopilot — Pesquisa Real de Produtos (F4)   ║\n' +
    '╚══════════════════════════════════════════════════════════╝\n'
  );
}

function formatBRL(value) {
  if (value === null || value === undefined) return 'N/D';
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function main() {
  printBanner();

  const browser = new BrowserManager();
  const openrouter = new OpenRouterAgent();

  try {
    logger.info('[TestProducts] Iniciando BrowserManager...');
    await browser.launch();

    const searchService = new ProductSearchService({
      browserManager: browser,
      openrouterAgent: openrouter,
    });

    console.log('  Coletando produtos reais nos marketplaces...\n');

    const result = await searchService.searchAndSelect({
      limit: 5,
      itemsPerMarketplace: 10,
    });

    const { stats, topOffers, providerStatuses } = result;

    console.log('\n' + '═'.repeat(60));
    console.log('  STATUS DOS MARKETPLACES');
    console.log('═'.repeat(60));
    console.log(`  Mercado Livre : ${providerStatuses?.['Mercado Livre Browser'] || 'AVAILABLE'}`);
    console.log(`  Shopee        : ${providerStatuses?.['Shopee Browser'] || 'TEMPORARILY_BLOCKED'}`);
    console.log(`  Amazon        : ainda não habilitada para coleta`);
    console.log(`  AliExpress    : ainda não habilitado para coleta`);

    console.log('\n' + '═'.repeat(60));
    console.log('  RELATÓRIO DE COLETA E FILTRAGEM (FASE 4.1)');
    console.log('═'.repeat(60));
    console.log(`  Mercado Livre coletados   : ${stats.mlCollected}`);
    console.log(`  Shopee coletados          : ${stats.shopeeCollected}`);
    console.log(`  Total bruto               : ${stats.totalRaw}`);
    console.log(`  URLs inválidas rejeitadas : ${stats.invalidUrlsRemoved}`);
    console.log(`  Duplicados removidos      : ${stats.duplicatesRemoved}`);
    console.log(`  Após filtros              : ${stats.afterFilter}`);
    console.log(`  Enviados ao OpenRouter    : ${stats.sentToAI}`);
    console.log(`  Selecionados              : ${stats.selectedCount}`);

    console.log('\n' + '─'.repeat(60));
    console.log('  TOP 5 ACHADINHOS SELECIONADOS');
    console.log('─'.repeat(60));

    topOffers.forEach((prod, index) => {
      const num = index + 1;
      const mkp = prod.marketplace === 'mercadolivre' ? 'Mercado Livre' :
                  prod.marketplace === 'shopee' ? 'Shopee' : prod.marketplace;
      const desc = prod.discountPercent ? ` (${prod.discountPercent}% OFF)` : '';

      console.log(`\n  ${num}. ${prod.title}`);
      console.log(`     Marketplace : ${mkp}`);
      console.log(`     Preço       : ${formatBRL(prod.currentPrice)}${desc}`);
      console.log(`     Score       : ${prod.score}/100`);
      console.log(`     Categoria   : ${prod.category || 'Geral'}`);
      console.log(`     Motivo      : ${prod.reasons}`);
      if (prod.risks) {
        console.log(`     Risco       : ${prod.risks}`);
      }
      console.log(`     URL Real    : ${prod.productUrl}`);
    });

    console.log('\n' + '═'.repeat(60));
    console.log('  ✔ FASE 4 CONCLUÍDA COM SUCESSO');
    console.log('═'.repeat(60) + '\n');

  } catch (err) {
    logger.error(`[TestProducts] Erro durante execução: ${err.message}`);
    console.error('\n\x1b[31m[ERRO]\x1b[0m', err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
