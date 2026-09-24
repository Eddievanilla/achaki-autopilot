/**
 * ACHAki Autopilot — Login Interativo Mercado Livre
 *
 * Abre o Chromium persistente em modo visual (headful) para que o operador
 * faça login manual na conta de Afiliados do Mercado Livre.
 *
 * USO:
 *   node scripts/login-mercadolivre.js
 */

import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';
import logger from '../src/utils/logger.js';
import readline from 'readline';

function waitForEnter(msg) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`\n${msg}\nPressione ENTER quando terminar o login... `, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  console.log('\n======================================================');
  console.log('   ACHAki Autopilot — Login Mercado Livre Afiliados');
  console.log('======================================================\n');
  console.log('➜ Abrindo o navegador do robô em modo visual...');
  console.log('➜ Faça o login ou resolva qualquer verificação/desafio na janela que abrir.\n');

  const browser = new BrowserManager();
  browser.headless = false;

  try {
    await browser.launch();
    const page = await browser.openPage();

    await page.goto('https://www.mercadolivre.com.br/afiliados/linkbuilder#hub', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    console.log(`[Browser] URL carregada: ${page.url()}`);
    await waitForEnter('Após completar seu login e visualizar a Central de Afiliados');

    const finalUrl = page.url();
    const cookies = await browser.context.cookies(['https://www.mercadolivre.com.br']);
    console.log(`\n✔ URL final: ${finalUrl}`);
    console.log(`✔ Cookies salvos: ${cookies.length}`);
    console.log('✔ Sessão gravada com sucesso em data/browser-profile!\n');
  } catch (err) {
    logger.error(`Erro durante login interativo: ${err.message}`);
  } finally {
    await browser.close().catch(() => {});
    console.log('Navegador fechado. O robô já pode utilizar a sessão salva.');
    process.exit(0);
  }
}

main();
