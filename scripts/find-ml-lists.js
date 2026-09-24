/**
 * Script para inspecionar onde fica "Minhas recomendações" / "Lista de afiliados | Predeterminada"
 */
import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';

async function main() {
  const browser = new BrowserManager();
  // Usa as configurações padrão do projeto (headless: false se BROWSER_HEADLESS não for true)
  await browser.launch();
  const page = await browser.openPage();

  try {
    console.log('[1] Navegando para https://www.mercadolivre.com.br/ ...');
    await page.goto('https://www.mercadolivre.com.br/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Encontrar o link de Favoritos no cabeçalho
    const favLink = await page.$('a[href*="favoritos"], a[href*="bookmarks"], a[href*="list"]');
    let favHref = favLink ? await favLink.getAttribute('href') : null;
    console.log(`[2] Link de Favoritos no Header: ${favHref}`);

    // Se não encontrou no header, busca no menu do usuário ou tenta URLs conhecidas
    const candidateUrls = [
      favHref,
      'https://www.mercadolivre.com.br/gz/home/bookmarks',
      'https://myaccount.mercadolivre.com.br/bookmarks/list',
      'https://myaccount.mercadolivre.com.br/lists',
      'https://www.mercadolivre.com.br/afiliados',
      'https://afiliados.mercadolivre.com.br/',
    ].filter(Boolean);

    for (const url of candidateUrls) {
      console.log(`\n--- Testando URL: ${url} ---`);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(3000);
        const currentUrl = page.url();
        const title = await page.title();
        console.log(`  Resultado: ${currentUrl} | Título: "${title}"`);

        // Busca por "Minhas recomendações", "Lista de afiliados", "Predeterminada", etc.
        const pageText = await page.evaluate(() => document.body.innerText);
        const hasRecomendacoes = pageText.includes('Minhas recomendações');
        const hasAfiliados = pageText.includes('Lista de afiliados') || pageText.includes('afiliados') || pageText.includes('Afiliados');
        const hasPredeterminada = pageText.includes('Predeterminada');

        console.log(`  Contém "Minhas recomendações"? ${hasRecomendacoes}`);
        console.log(`  Contém "Lista de afiliados"? ${hasAfiliados}`);
        console.log(`  Contém "Predeterminada"? ${hasPredeterminada}`);

        if (hasRecomendacoes || hasAfiliados || hasPredeterminada) {
          console.log(`  >>> ENCONTRADO EM: ${currentUrl}!`);
          
          // Extrai estrutura dos elementos encontrados
          const details = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('a, button, [role="tab"], [role="button"], h1, h2, h3, h4, span, div')).filter(el => {
              const t = el.innerText?.trim() || '';
              return t.includes('Minhas recomendações') || t.includes('Lista de afiliados') || t.includes('Predeterminada');
            }).map(el => ({
              tag: el.tagName,
              text: el.innerText.trim(),
              href: el.getAttribute('href'),
              className: el.className?.toString().slice(0, 100),
            }));

            // Extrair links e botões da lista/página
            const links = Array.from(document.querySelectorAll('a')).map(a => ({
              text: a.innerText.trim(),
              href: a.href,
            })).filter(a => a.href && (a.href.includes('list') || a.href.includes('bookmark') || a.href.includes('recommend') || a.href.includes('share') || a.href.includes('MLB')));

            return { items: items.slice(0, 20), links: links.slice(0, 30) };
          });

          console.log('  Detalhes dos elementos:', JSON.stringify(details.items, null, 2));
          console.log('  Links encontrados:', JSON.stringify(details.links, null, 2));
          
          // Captura screenshot para conferência
          await page.screenshot({ path: 'scratch/bookmarks_found.png', fullPage: false });
          console.log('  Screenshot salva em scratch/bookmarks_found.png');
          break;
        }
      } catch (err) {
        console.log(`  Erro ao acessar ${url}: ${err.message}`);
      }
    }

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
