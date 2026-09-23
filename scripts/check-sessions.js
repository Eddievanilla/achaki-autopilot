/**
 * ACHAki Autopilot — Verificação de Sessões (Fase 3)
 *
 * Verifica silenciosamente se todas as sessões configuradas ainda são válidas.
 * Pode ser chamado antes de cada execução automática do operador.
 *
 * USO:
 *   npm run check:sessions
 *
 * Retorna exit code 0 se todas as sessões estão ativas.
 * Retorna exit code 1 se alguma sessão expirou (para alertar o operador).
 */

import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';
import SessionManager from '../src/services/session-manager.js';
import logger from '../src/utils/logger.js';

function printBanner() {
  console.log('\n' +
    '╔══════════════════════════════════════════════════════════╗\n' +
    '║     ACHAki Autopilot — Verificação de Sessões (F3)      ║\n' +
    '╚══════════════════════════════════════════════════════════╝\n'
  );
}

async function main() {
  printBanner();

  const browser = new BrowserManager();
  const session = new SessionManager(browser);

  try {
    logger.info('[CheckSessions] Iniciando verificação...');
    await browser.launch();

    const results = await session.checkAllAccounts();

    console.log('\n  Status das sessões:\n');

    let allOk = true;
    for (const r of results) {
      const icon   = r.loggedIn ? '✔' : '✘';
      const status = r.loggedIn ? 'ATIVA' : 'EXPIRADA / NÃO CONFIGURADA';
      console.log(`  ${icon}  ${r.name.padEnd(20)} ${status}`);
      if (!r.loggedIn) allOk = false;
    }

    if (allOk) {
      console.log('\n  ✔ Todas as sessões estão ativas. Sistema pronto para operar.\n');
    } else {
      console.log('\n  ⚠  Uma ou mais sessões estão expiradas.');
      console.log('     Execute: npm run setup:accounts\n');
      process.exitCode = 1;
    }

  } catch (err) {
    logger.error(`[CheckSessions] Erro: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
