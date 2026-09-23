/**
 * ACHAki Autopilot — Desbloqueio / Verificação Shopee
 *
 * Abre o Chromium persistente na página da Shopee para que o operador
 * resolva o quebra-cabeça anti-bot manualmente.
 * Uma vez resolvido, o cookie de liberação é salvo no perfil persistente.
 *
 * USO:
 *   node scripts/solve-shopee.js
 */

import 'dotenv/config';
import readline from 'readline';
import BrowserManager from '../src/browser/browser.js';
import ShopeeScraper from '../src/marketplaces/shopee.js';

function waitForEnter(msg) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`\n${msg}\nPressione ENTER quando tiver resolvido o quebra-cabeça...`, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  console.log('\n[Shopee] Abrindo navegador para resolução da verificação da Shopee...');
  const browser = new BrowserManager();
  await browser.launch();

  try {
    const page = await browser.openPage();
    await page.goto('https://shopee.com.br/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    console.log('\nURL atual:', page.url());

    if (page.url().includes('verify') || page.url().includes('captcha')) {
      console.log('\n\x1b[33m[Shopee] O quebra-cabeça está visível na janela do Chromium.\x1b[0m');
      console.log('\x1b[33m[Shopee] Arraste a peça do quebra-cabeça na tela para completar a verificação.\x1b[0m');
      console.log('[Shopee] Aguardando resolução (detecção automática ou pressione ENTER)...');

      // Loop de detecção automática com fallback de ENTER
      const start = Date.now();
      let resolved = false;

      while (Date.now() - start < 120_000) {
        await page.waitForTimeout(1500);
        const url = page.url();
        if (!url.includes('verify') && !url.includes('captcha')) {
          resolved = true;
          break;
        }
      }

      if (resolved) {
        console.log('\n\x1b[32m✔ Verificação detectada e resolvida com sucesso!\x1b[0m');
      } else {
        await waitForEnter('[Shopee] Se já completou');
      }
    }

    console.log('\nTestando busca na Shopee após verificação...');
    const scraper = new ShopeeScraper(browser);
    const items = await scraper.search({ category: 'organizacao', query: 'organizador casa', limit: 5 });
    console.log(`\nItens coletados na Shopee: ${items.length}`);
    if (items.length > 0) {
      console.log('Exemplo coletado:', items[0].title, '| R$', items[0].currentPrice);
    }
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
