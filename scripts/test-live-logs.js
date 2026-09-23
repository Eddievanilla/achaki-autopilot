/**
 * ACHAki Autopilot — Teste de Telemetria e Logs em Tempo Real
 *
 * USO:
 *   npm run test:live-logs
 *
 * REGRAS CRÍTICAS DE SEGURANÇA:
 *  - NÃO pesquisa produtos reais.
 *  - NÃO gera links de afiliados reais.
 *  - NÃO publica nada no Facebook ou qualquer canal.
 *  - NÃO executa ciclo real do robô.
 *  - Gera SOMENTE eventos artificiais de telemetria para validação visual em tempo real.
 */

import 'dotenv/config';
import eventLogger from '../src/services/event-logger.js';

// Utilitário para pausa entre eventos
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('\n===============================================================');
  console.log('  ACHAki Autopilot — Teste de Telemetria e Logs em Tempo Real');
  console.log('  Abra o dashboard para acompanhar o streaming ao vivo.');
  console.log('===============================================================\n');

  const testRunId = '00000000-0000-0000-0000-000000000001';
  eventLogger.setRunId(testRunId);

  // 1. SYSTEM
  await eventLogger.info('SYSTEM', 'ACHAki Autopilot v1.0 inicializado em modo ASSISTIDO', {
    action: 'INIT',
    metadata: { version: '1.0.0', node: process.version, env: 'test' },
  });
  await sleep(900);

  // 2. ROBOT
  await eventLogger.info('ROBOT', 'Ciclo de monitoramento iniciado [ID: #SIM-101]', {
    action: 'CYCLE_START',
    metadata: { cycleType: 'SIMULADO', scheduledIntervalMinutes: 25 },
  });
  await sleep(900);

  // 3. MERCADOLIVRE
  await eventLogger.info('MERCADOLIVRE', 'Pesquisando ofertas na categoria "Eletrônicos & Acessórios"...', {
    action: 'SEARCH_START',
    metadata: { category: 'Eletrônicos', sort: 'melhores_ofertas' },
  });
  await sleep(1000);

  // 4. MERCADOLIVRE (Success)
  await eventLogger.success('MERCADOLIVRE', '12 ofertas encontradas com desconto acima de 25%', {
    action: 'SEARCH_COMPLETE',
    durationMs: 420,
    metadata: { itemsFound: 12, topDiscountPercent: 48 },
  });
  await sleep(900);

  // 5. PRICE (Success)
  await eventLogger.success('PRICE', 'Preço revalidado: de R$ 189,90 por R$ 129,90 (-32% OFF)', {
    action: 'PRICE_VALIDATED',
    durationMs: 180,
    metadata: { originalPrice: 189.90, currentPrice: 129.90, status: 'CONFIRMADO' },
  });
  await sleep(900);

  // 6. PRICE (Warning)
  await eventLogger.warning('PRICE', 'Item #MLB-99412: Estoque baixo (apenas 2 unidades restantes)', {
    action: 'STOCK_CHECK',
    metadata: { stockRemaining: 2, alert: 'URGENCIA_ALTA' },
  });
  await sleep(900);

  // 7. JEV (Success)
  await eventLogger.success('JEV', 'Cache operacional aproveitado: 8 ofertas reutilizadas (0 tokens consumidos)', {
    action: 'CACHE_HIT',
    metadata: { cacheHits: 8, tokensSaved: 1600 },
  });
  await sleep(900);

  // 8. AI (Success)
  await eventLogger.success('AI', 'Curadoria JEV aprovou oferta #MLB-88321: Score 89/100 (Alto potencial orgânico)', {
    action: 'AI_APPROVAL',
    durationMs: 310,
    metadata: { score: 89, impulseScore: 92, strategy: 'ACHADINHO' },
  });
  await sleep(900);

  // 9. AFFILIATE (Success)
  await eventLogger.success('AFFILIATE', 'Link rastreável comissionado gerado com sucesso', {
    action: 'AFFILIATE_LINK_READY',
    metadata: { trackingCode: 'achaki_sim_01', verified: true },
  });
  await sleep(900);

  // 10. FACEBOOK (Info)
  await eventLogger.info('FACEBOOK', 'Página oficial validada: ACHAki Achadinhos e Ofertas (ID: 61587794361596)', {
    action: 'PAGE_VALIDATED',
    metadata: { pageId: '61587794361596', canPost: true },
  });
  await sleep(900);

  // 11. FACEBOOK (Success)
  await eventLogger.success('FACEBOOK', 'Permissões de publicação verificadas: pages_show_list, pages_read_engagement, pages_manage_posts', {
    action: 'PERMISSIONS_CHECK',
    metadata: { pages_manage_posts: true, readyToPublish: true },
  });
  await sleep(900);

  // 12. ERROR (Simulação controlada de erro operacional não impeditivo)
  await eventLogger.error('ERROR', 'Tentativa de obter imagem secundária excedeu timeout (usando imagem principal)', {
    action: 'MEDIA_FALLBACK',
    durationMs: 2500,
    metadata: { recovered: true, fallback: 'primary_image_used' },
  });
  await sleep(1000);

  // 13. ROBOT (Success - Conclusão do teste)
  await eventLogger.success('ROBOT', 'Ciclo simulado concluído com sucesso. Telemetria em tempo real 100% operacional!', {
    action: 'CYCLE_END',
    durationMs: 8250,
    metadata: { totalEventsEmitted: 13, allChannelsOk: true },
  });

  console.log('\n===============================================================');
  console.log('  ✔ Teste de logs em tempo real finalizado com sucesso!');
  console.log('  Eventos gravados no Supabase e distribuídos via Realtime.');
  console.log('===============================================================\n');
}

main().catch(console.error);
