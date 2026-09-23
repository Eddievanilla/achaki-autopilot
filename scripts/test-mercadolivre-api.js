/**
 * ACHAki Autopilot — Teste da API do Mercado Livre (Fase 4.2)
 *
 * Realiza teste de conexão e busca na API oficial do Mercado Livre.
 *
 * Resultados possíveis:
 *  - Mercado Livre API: AVAILABLE
 *  - Mercado Livre API: NOT_CONFIGURED
 *  - Mercado Livre API: AUTH_ERROR
 *
 * USO:
 *   npm run test:ml-api
 */

import 'dotenv/config';
import MercadoLivreApiProvider from '../src/providers/mercadolivre/api-provider.js';

function printBanner() {
  console.log('\n' +
    '╔══════════════════════════════════════════════════════════╗\n' +
    '║    ACHAki Autopilot — Teste Mercado Livre API (F4.2)     ║\n' +
    '╚══════════════════════════════════════════════════════════╝\n'
  );
}

async function main() {
  printBanner();

  const provider = new MercadoLivreApiProvider();
  const missing = provider.getMissingCredentials();

  if (missing.length > 0) {
    console.log('  Status de Credenciais:');
    console.log(`  Ausentes: ${missing.join(', ')}\n`);
    console.log('────────────────────────────────────────────────────────────');
    console.log('  \x1b[33mMercado Livre API: NOT_CONFIGURED\x1b[0m');
    console.log('────────────────────────────────────────────────────────────\n');
    console.log('  Para configurar a API oficial, execute:');
    console.log('    npm run setup:ml-api\n');
    return;
  }

  console.log('  Testando autenticação oficial com /users/me...');
  const authResult = await provider.validateCredentials();

  if (!authResult.valid) {
    console.log('\n────────────────────────────────────────────────────────────');
    console.log(`  \x1b[31mMercado Livre API: ${authResult.status}\x1b[0m`);
    console.log('────────────────────────────────────────────────────────────\n');
    console.log(`  Motivo: ${authResult.message}\n`);
    console.log('  Verifique seu Access Token no arquivo .env e tente novamente.\n');
    process.exitCode = 1;
    return;
  }

  console.log(`  ✔ Autenticação confirmada para o usuário: "${authResult.user}"\n`);
  console.log('  Testando busca na API oficial (/sites/MLB/search?q=cozinha)...');

  const items = await provider.search({
    category: 'cozinha',
    query: 'utilidades cozinha',
    limit: 3,
  });

  console.log(`  ✔ Itens retornados pela API: ${items.length}`);
  if (items.length > 0) {
    console.log(`     Exemplo: "${items[0].title}" | R$ ${items[0].currentPrice}`);
    console.log(`     Link   : ${items[0].productUrl}`);
  }

  console.log('\n────────────────────────────────────────────────────────────');
  console.log('  \x1b[32mMercado Livre API: AVAILABLE\x1b[0m');
  console.log('────────────────────────────────────────────────────────────\n');
}

main().catch(console.error);
