/**
 * Testar chamada direta via page.evaluate(fetch) autenticado
 */
import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';

async function main() {
  const browser = new BrowserManager();
  await browser.launch();
  const page = await browser.openPage();

  try {
    await page.goto('https://www.mercadolivre.com.br/afiliados/linkbuilder#hub', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const testUrl = 'https://produto.mercadolivre.com.br/MLB-4817578135-lampada-camera-de-seguranca-wi-fi-com-viso-noturna-para-casa-_JM';

    const result = await page.evaluate(async (productUrl) => {
      // Obter csrf token da página
      let csrfToken = '';
      const csrfMeta = document.querySelector('meta[name="csrf-token"], input[name="_csrf"]');
      if (csrfMeta) {
        csrfToken = csrfMeta.getAttribute('content') || csrfMeta.value;
      }

      // Se não achar meta, tenta buscar do window ou cookies
      const res = await fetch('/affiliate-program/api/v2/affiliates/createLink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          urls: [productUrl],
          tag: 'techlinecia'
        })
      });

      return {
        status: res.status,
        data: await res.json()
      };
    }, testUrl);

    console.log('Resultado do fetch direto autenticado:');
    console.log(JSON.stringify(result, null, 2));

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
