/**
 * ACHAki Autopilot — Setup de Contas (Fase 3)
 *
 * Modo interativo de configuração de contas para o operador.
 *
 * USO:
 *   npm run setup:accounts
 *
 * O script:
 *  1. Abre o Chromium com perfil persistente.
 *  2. Abre as páginas de login de cada plataforma.
 *  3. Aguarda o login MANUAL do usuário.
 *  4. Preserva cookies/sessão no perfil persistente.
 *  5. Verifica se a sessão ficou ativa.
 *
 * IMPORTANTE:
 *  - Login é SEMPRE feito pelo usuário, nunca automatizado.
 *  - A sessão fica salva no perfil: data/browser-profile
 *  - Não é necessário refazer login a cada execução.
 */

import 'dotenv/config';
import readline from 'readline';
import BrowserManager from '../src/browser/browser.js';
import SessionManager, { ACCOUNTS } from '../src/services/session-manager.js';
import logger from '../src/utils/logger.js';

// ─── Helper: aguardar ENTER do usuário ───────────────────────────────────────

/**
 * Aguarda o usuário pressionar ENTER no terminal.
 * @param {string} message - Mensagem a exibir antes de aguardar
 * @returns {Promise<void>}
 */
function waitForEnter(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`\n${message}\nPressione ENTER quando terminar...`, () => {
      rl.close();
      resolve();
    });
  });
}

// ─── Helper: exibir banner ────────────────────────────────────────────────────

function printBanner() {
  console.log('\n' +
    '╔══════════════════════════════════════════════════════════╗\n' +
    '║     ACHAki Autopilot — Setup de Contas (Fase 3)         ║\n' +
    '╚══════════════════════════════════════════════════════════╝\n'
  );
}

function printSeparator(label = '') {
  const line = '─'.repeat(60);
  console.log(label ? `\n${line}\n  ${label}\n${line}` : `\n${line}`);
}

// ─── Fluxo principal ──────────────────────────────────────────────────────────

/**
 * Mensagens customizadas por conta para instrução de login.
 * @type {Record<string, string>}
 */
const LOGIN_INSTRUCTIONS = {
  'amazon-associates': [
    '  A área Amazon Associados usa a mesma conta Amazon.',
    '  ➜ Se você já fez login na Amazon acima, clique em ENTER.',
    '  ➜ Se a página pedir login novamente, faça manualmente.',
    '  ➜ Não é necessário nenhuma credencial adicional.',
  ].join('\n'),
  'aliexpress': [
    '  [ACHAki] Faça login manualmente no AliExpress no browser que abriu.',
    '  [ACHAki] Quando estiver autenticado, pressione ENTER.',
    '',
    '  ℹ  Dicas de login AliExpress:',
    '     • Use o login via Google, Apple, ou e-mail/senha.',
    '     • Se aparecer CAPTCHA ou verificação, resolva manualmente.',
    '     • Após login, aguarde a página inicial carregar completamente.',
  ].join('\n'),
};

async function main() {
  printBanner();

  console.log('  Este assistente vai abrir o Chromium e as páginas de login');
  console.log('  de cada plataforma para que você faça login MANUALMENTE.\n');
  console.log('  ✔ Os cookies serão preservados no perfil persistente.');
  console.log('  ✔ Você não precisará refazer login a cada execução.\n');

  const browser = new BrowserManager();
  const session = new SessionManager(browser);

  // Rastreia resultados da sessão atual para lógica de dependência
  const sessionResults = {};

  try {
    // ── Inicia o Chromium ─────────────────────────────────────────────────────
    printSeparator('Iniciando Chromium...');
    await browser.launch();
    logger.info('[Setup] Chromium iniciado com perfil persistente.');

    // ── Abre cada conta para login manual ─────────────────────────────────────
    for (const account of ACCOUNTS) {
      printSeparator(`LOGIN: ${account.name}`);

      console.log(`\n  Plataforma : ${account.name}`);
      console.log(`  URL        : ${account.loginUrl}`);

      // Instrução especial para Amazon Associados
      if (account.id === 'amazon-associates') {
        console.log('\n  ℹ  Amazon Associados utiliza a mesma sessão da Amazon.');
        if (sessionResults['amazon']) {
          console.log('  ✔  Sessão Amazon detectada — verificando acesso a Associados...\n');
        } else {
          console.log('  ⚠  Faça login na Amazon antes de continuar.\n');
        }
      }

      console.log(`\n  ➜ Abrindo ${account.name} no browser...`);

      // Abre a página
      const page = await browser.openPage();
      await page.goto(account.loginUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });

      // Mensagem de instrução (personalizada ou padrão)
      const customInstruction = LOGIN_INSTRUCTIONS[account.id];
      if (customInstruction) {
        console.log(customInstruction);
        await waitForEnter('');
      } else {
        await waitForEnter(`  [ACHAki] Faça login manualmente no ${account.name} no browser que abriu.\n  [ACHAki] Quando estiver autenticado, pressione ENTER.`);
      }

      // Verifica se o login foi bem-sucedido
      console.log(`\n  Verificando sessão do ${account.name}...`);
      const result = await session.checkAccount(account);
      sessionResults[account.id] = result.loggedIn;

      if (result.loggedIn) {
        console.log(`\n  ✔ ${account.name}: sessão ATIVA e salva!\n`);
      } else {
        console.log(`\n  ✘ ${account.name}: sessão NÃO detectada.`);
        console.log(`     Verifique se o login foi concluído corretamente.\n`);
      }
    }

    // ── Verificação final de todas as sessões ─────────────────────────────────
    printSeparator('Verificação Final das Sessões');

    const allResults = await session.checkAllAccounts();

    console.log('\n  Status das contas:\n');
    for (const r of allResults) {
      const icon   = r.loggedIn ? '✔' : '✘';
      const status = r.loggedIn ? 'ATIVA' : 'NÃO AUTENTICADA';
      console.log(`  ${icon}  ${r.name.padEnd(22)} ${status}`);
    }

    const allOk = allResults.every((r) => r.loggedIn);

    if (allOk) {
      console.log('\n  ══════════════════════════════════════════════════════════');
      console.log('    ✔ FASE 3 CONCLUÍDA — Todas as sessões estão configuradas!');
      console.log('  ══════════════════════════════════════════════════════════\n');
    } else {
      const pending = allResults.filter((r) => !r.loggedIn).map((r) => r.name);
      console.log(`\n  ⚠  Contas pendentes: ${pending.join(', ')}`);
      console.log('     Execute "npm run setup:accounts" novamente para configurá-las.\n');
    }

  } catch (err) {
    logger.error(`[Setup] Erro: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();

