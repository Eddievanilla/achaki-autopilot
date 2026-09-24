/**
 * Deep inspection of https://myaccount.mercadolivre.com.br/bookmarks/list and https://www.mercadolivre.com.br/afiliados
 */
import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';

async function main() {
  const browser = new BrowserManager();
  await browser.launch();
  const page = await browser.openPage();

  try {
    console.log('[1] Navegando para https://myaccount.mercadolivre.com.br/bookmarks/list ...');
    await page.goto('https://myaccount.mercadolivre.com.br/bookmarks/list', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const title = await page.title();
    const url = page.url();
    console.log(`URL: ${url} | Title: "${title}"`);

    // Extrair abas, listas e botões
    const bookmarksInfo = await page.evaluate(() => {
      // Todos os links, botões e tabs
      const elements = Array.from(document.querySelectorAll('a, button, [role="tab"], [role="button"], h1, h2, h3, h4, span, p')).map(el => ({
        tag: el.tagName,
        text: el.innerText?.trim() || '',
        href: el.getAttribute('href') || '',
        className: el.className?.toString().slice(0, 100) || '',
        role: el.getAttribute('role') || '',
      })).filter(e => e.text && (
        e.text.includes('lista') || 
        e.text.includes('Lista') || 
        e.text.includes('recomenda') || 
        e.text.includes('Recomenda') || 
        e.text.includes('Afiliado') || 
        e.text.includes('afiliado') || 
        e.text.includes('Favorito') || 
        e.text.includes('Compartilhar') ||
        e.text.includes('Predeterminada') ||
        e.text.includes('Criar')
      ));

      return {
        elements: elements.slice(0, 40),
        bodyText: document.body.innerText.slice(0, 2000),
      };
    });

    console.log('\n--- Elementos de Listas/Afiliados ---');
    console.log(JSON.stringify(bookmarksInfo.elements, null, 2));

    console.log('\n--- Texto Completo da Página Bookmarks ---');
    console.log(bookmarksInfo.bodyText);

    await page.screenshot({ path: 'scratch/bookmarks_list_full.png', fullPage: true });
    console.log('\nScreenshot salva em scratch/bookmarks_list_full.png');

    // [2] Agora vamos para https://www.mercadolivre.com.br/afiliados
    console.log('\n[2] Navegando para https://www.mercadolivre.com.br/afiliados ...');
    await page.goto('https://www.mercadolivre.com.br/afiliados', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    console.log(`URL: ${page.url()} | Title: "${await page.title()}"`);
    const affiliatesInfo = await page.evaluate(() => {
      return document.body.innerText.slice(0, 2000);
    });
    console.log('\n--- Texto da Página de Afiliados ---');
    console.log(affiliatesInfo);

    await page.screenshot({ path: 'scratch/afiliados_page.png', fullPage: false });

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
