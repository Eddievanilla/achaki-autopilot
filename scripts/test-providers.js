/**
 * ACHAki Autopilot — Teste de Provedores (Fase 4.1 API-First)
 *
 * Exibe o status consolidado de todos os provedores registrados
 * (APIs oficiais e automações via navegador).
 * Não falha quando APIs ainda não possuem credenciais configuradas.
 *
 * USO:
 *   npm run test:providers
 */

import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';
import ProviderManager from '../src/services/provider-manager.js';

function printBanner() {
  console.log('\n' +
    '╔══════════════════════════════════════════════════════════╗\n' +
    '║     ACHAki Autopilot — Status de Provedores (F4.1)      ║\n' +
    '╚══════════════════════════════════════════════════════════╝\n'
  );
}

function colorStatus(status) {
  switch (status) {
    case 'AVAILABLE':
      return `\x1b[32m✔ ${status}\x1b[0m`;
    case 'NOT_CONFIGURED':
      return `\x1b[33m○ ${status}\x1b[0m`;
    case 'TEMPORARILY_BLOCKED':
      return `\x1b[31m⚠ ${status}\x1b[0m`;
    default:
      return status;
  }
}

async function main() {
  printBanner();

  const browser = new BrowserManager();
  const manager = new ProviderManager({ browserManager: browser });

  console.log('────────────────────────────────────────────────────────────');
  console.log('  PROVIDER STATUS');
  console.log('────────────────────────────────────────────────────────────\n');

  const statuses = manager.getStatuses();

  for (const [providerName, status] of Object.entries(statuses)) {
    console.log(`  ${providerName.padEnd(25)} ${colorStatus(status)}`);
  }

  console.log('\n────────────────────────────────────────────────────────────');
  console.log('  FONTES ATIVAS SELECIONADAS (API-FIRST)');
  console.log('────────────────────────────────────────────────────────────\n');

  const active = manager.getActiveProviders();
  if (active.length === 0) {
    console.log('  Nenhuma fonte ativa disponível no momento.\n');
  } else {
    for (const item of active) {
      const label = item.provider.source === 'official_api' ? 'API Oficial' : 'Browser Fallback';
      console.log(`  ✔ ${item.marketplace.toUpperCase().padEnd(16)} -> ${label}`);
    }
  }

  console.log('\n  Legenda:');
  console.log('  ✔ AVAILABLE           -> Provedor configurado e pronto');
  console.log('  ○ NOT_CONFIGURED      -> Aguardando credenciais (sem bloqueio)');
  console.log('  ⚠ TEMPORARILY_BLOCKED -> Bloqueio temporário (ignorado com segurança)\n');
}

main().catch(console.error);
