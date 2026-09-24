/**
 * Test bookmarks URLs directly
 */
import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';

async function main() {
  const browser = new BrowserManager();
  await browser.launch();
  const page = await browser.openPage();

  try {
    const urls = [
      'https://myaccount.mercadolivre.com.br/bookmarks/list',
      'https://www.mercadolivre.com.br/gz/home/bookmarks',
      'https://myaccount.mercadolivre.com.br/bookmarks',
      'https://myaccount.mercadolivre.com.br/lists',
      'https://www.mercadolivre.com.br/my-account/bookmarks',
    ];

    for (const url of urls) {
      console.log(`\n========================================`);
      console.log(`Navegando para: ${url}`);
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
      } catch (e) {
        console.log(`  (load event timeout, prosseguindo... ${e.message})`);
      }
      await page.waitForTimeout(2000);

      const finalUrl = page.url();
      const title = await page.title();
      console.log(`  URL Final: ${finalUrl}`);
      console.log(`  Título: "${title}"`);

      const textSnippet = await page.evaluate(() => {
        return document.body.innerText.slice(0, 500).replace(/\n+/g, ' | ');
      });
      console.log(`  Texto: ${textSnippet}`);

      // Se encontrou algo de listas/favoritos/recomendações
      const listsFound = await page.evaluate(() => {
        const found = [];
        document.querySelectorAll('*').forEach(el => {
          const t = el.innerText?.trim();
          if (t && (t.includes('recomenda') || t.includes('afiliado') || t.includes('Favorito') || t.includes('Predeterminada') || t.includes('Criar lista'))) {
            if (el.children.length === 0) {
              found.push(t);
            }
          }
        });
        return [...new Set(found)];
      });

      console.log(`  Termos encontrados:`, listsFound);
      if (listsFound.length > 0) {
        await page.screenshot({ path: `scratch/found_${Date.now()}.png` });
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
