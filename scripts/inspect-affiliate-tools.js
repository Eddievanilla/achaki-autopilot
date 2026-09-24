/**
 * Investigar Listas (9) em Bookmarks e Gerador de Links na Central de Afiliados
 */
import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';

async function main() {
  const browser = new BrowserManager();
  await browser.launch();
  const page = await browser.openPage();

  try {
    // 1. Inspecionar Listas (9) em Bookmarks
    console.log('[1] Navegando para https://myaccount.mercadolivre.com.br/bookmarks/list ...');
    await page.goto('https://myaccount.mercadolivre.com.br/bookmarks/list', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Clicar na aba "Listas (9)"
    console.log('Clicando na aba Listas...');
    const listTab = await page.$('button[role="tab"]:has-text("Listas"), button:has-text("Listas (9)")');
    if (listTab) {
      await listTab.click();
      await page.waitForTimeout(3000);
      console.log('Aba Listas clicada com sucesso!');

      const listsOnPage = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, button, div, span, p')).filter(el => {
          const t = el.innerText?.trim() || '';
          return t.includes('Minhas recomendações') || t.includes('Lista de afiliados') || t.includes('Predeterminada');
        }).map(el => ({
          tag: el.tagName,
          text: el.innerText.trim(),
          href: el.getAttribute('href') || el.closest('a')?.getAttribute('href') || '',
          className: el.className?.toString().slice(0, 80),
        }));

        const allListLinks = Array.from(document.querySelectorAll('a[href*="bookmark"], a[href*="list"]')).map(a => ({
          text: a.innerText.trim(),
          href: a.href,
        }));

        return {
          matches: links,
          allListLinks: allListLinks,
          bodySnippet: document.body.innerText.slice(0, 1500),
        };
      });

      console.log('\n--- Listas Encontradas no DOM ---');
      console.log(JSON.stringify(listsOnPage.matches, null, 2));
      console.log('\n--- Links de Listas ---');
      console.log(JSON.stringify(listsOnPage.allListLinks, null, 2));
      console.log('\n--- Texto após clicar na aba Listas ---');
      console.log(listsOnPage.bodySnippet);

      await page.screenshot({ path: 'scratch/tab_listas_clicked.png', fullPage: true });
    } else {
      console.log('Aba Listas não encontrada!');
    }

    // 2. Inspecionar Central de Afiliados: Gerador de Links e Listas de Afiliados
    console.log('\n[2] Navegando para Central de Afiliados...');
    await page.goto('https://www.mercadolivre.com.br/afiliados/hub?is_affiliate=true', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const affiliateTools = await page.evaluate(() => {
      const tools = Array.from(document.querySelectorAll('a, button')).map(el => ({
        tag: el.tagName,
        text: el.innerText?.trim() || '',
        href: el.getAttribute('href') || '',
      })).filter(t => t.text.includes('Gerador') || t.text.includes('Listas') || t.text.includes('etiquetas') || t.text.includes('Compartilhar'));

      return tools;
    });

    console.log('\n--- Ferramentas de Afiliado Encontradas ---');
    console.log(JSON.stringify(affiliateTools, null, 2));

    // Se houver link para "Gerador de links", inspecionar essa URL
    const linkGenerator = affiliateTools.find(t => t.text.includes('Gerador de links'));
    if (linkGenerator && linkGenerator.href) {
      console.log(`\n[3] Navegando para Gerador de Links: ${linkGenerator.href}`);
      await page.goto(linkGenerator.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      console.log(`URL do Gerador: ${page.url()}`);
      console.log(`Título: "${await page.title()}"`);

      const genSnippet = await page.evaluate(() => document.body.innerText.slice(0, 1500));
      console.log('\n--- Texto do Gerador de Links ---');
      console.log(genSnippet);
      await page.screenshot({ path: 'scratch/gerador_links_page.png' });
    }

    // Se houver link para "Listas de afiliados", inspecionar essa URL
    const affLists = affiliateTools.find(t => t.text.includes('Listas de afiliados'));
    if (affLists && affLists.href) {
      console.log(`\n[4] Navegando para Listas de Afiliados: ${affLists.href}`);
      await page.goto(affLists.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      console.log(`URL de Listas de Afiliados: ${page.url()}`);
      console.log(`Título: "${await page.title()}"`);

      const listsSnippet = await page.evaluate(() => document.body.innerText.slice(0, 1500));
      console.log('\n--- Texto de Listas de Afiliados ---');
      console.log(listsSnippet);
      await page.screenshot({ path: 'scratch/listas_afiliados_page.png' });
    }

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
