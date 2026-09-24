/**
 * ACHAki Autopilot — Inspeção do Mecanismo de Afiliados / Listas ML
 */
import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';

async function main() {
  const browser = new BrowserManager();
  // Força headless para inspeção rápida
  browser.headless = true;

  try {
    await browser.launch();
    const page = await browser.openPage();

    // Monitorar todas as chamadas de API / XHR / fetch para entender endpoints internos
    const networkCalls = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/') || url.includes('/bookmarks') || url.includes('/affiliate') || url.includes('/recommend') || url.includes('/social') || url.includes('/share')) {
        networkCalls.push({
          method: req.method(),
          url: url,
          postData: req.postData(),
        });
      }
    });

    console.log('[1/4] Acessando Mercado Livre para checar autenticação...');
    await page.goto('https://www.mercadolivre.com.br/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const homeTitle = await page.title();
    console.log(`  Página inicial: "${homeTitle}" | URL: ${page.url()}`);

    // Verifica usuário logado
    const loggedUser = await page.evaluate(() => {
      const userEl = document.querySelector('.nav-header-user-badge, .nav-menu-item--profile, [class*="user-name"]');
      return userEl ? userEl.innerText.trim() : null;
    });
    console.log(`  Usuário detectado: ${loggedUser || 'Não identificado no seletor simples'}`);

    // [2/4] Acessar área de favoritos / listas
    console.log('\n[2/4] Navegando para área de Favoritos / Listas...');
    await page.goto('https://myaccount.mercadolivre.com.br/bookmarks/list', { waitUntil: 'networkidle', timeout: 30000 }).catch(async () => {
      console.log('  Tentando fallback https://www.mercadolivre.com.br/gz/home/bookmarks...');
      await page.goto('https://www.mercadolivre.com.br/gz/home/bookmarks', { waitUntil: 'networkidle', timeout: 30000 });
    });

    console.log(`  Área de Favoritos/Listas URL: ${page.url()}`);
    const bookmarksTitle = await page.title();
    console.log(`  Título: "${bookmarksTitle}"`);

    // Extrair listas visíveis e links de compartilhamento/recomendações
    const listsInfo = await page.evaluate(() => {
      // Procura por abas, listas, nomes de listas, etc.
      const elements = Array.from(document.querySelectorAll('*'));
      const foundTexts = [];
      for (const el of elements) {
        const text = el.innerText?.trim();
        if (text && (
          text.includes('Minhas recomendações') || 
          text.includes('Lista de afiliados') || 
          text.includes('Predeterminada') || 
          text.includes('Compartilhar') ||
          text.includes('Recomendar') ||
          text.includes('Criar lista')
        )) {
          if (el.children.length === 0) { // nó folha
            foundTexts.push({
              tag: el.tagName,
              text: text,
              className: el.className,
              parentTag: el.parentElement?.tagName,
              parentClass: el.parentElement?.className,
            });
          }
        }
      }

      // Procura por todos os botões e links
      const buttonsAndLinks = Array.from(document.querySelectorAll('button, a')).map(b => ({
        tag: b.tagName,
        text: b.innerText?.trim(),
        href: b.getAttribute('href') || '',
        ariaLabel: b.getAttribute('aria-label') || '',
        dataTestId: b.getAttribute('data-testid') || '',
      })).filter(b => b.text || b.ariaLabel || b.href);

      return {
        foundTexts: foundTexts.slice(0, 30),
        buttonsAndLinks: buttonsAndLinks.slice(0, 50),
        bodySnippet: document.body.innerText.slice(0, 1500)
      };
    });

    console.log('\n--- Textos relevantes encontrados em Listas/Favoritos ---');
    console.log(JSON.stringify(listsInfo.foundTexts, null, 2));

    console.log('\n--- Primeiros 1500 caracteres da página ---');
    console.log(listsInfo.bodySnippet);

    // [3/4] Acessar o produto piloto diretamente
    console.log('\n[3/4] Navegando para o produto piloto MLB4817578135...');
    const pilotUrl = 'https://produto.mercadolivre.com.br/MLB-4817578135-lampada-camera-de-seguranca-wi-fi-com-viso-noturna-para-casa-_JM';
    await page.goto(pilotUrl, { waitUntil: 'networkidle', timeout: 30000 });
    console.log(`  Produto carregado: "${await page.title()}"`);

    // Inspecionar botões de ação na página do produto (favoritar, compartilhar, adicionar à lista, etc.)
    const productActions = await page.evaluate(() => {
      const actions = Array.from(document.querySelectorAll('button, a, [role="button"], [class*="bookmark"], [class*="share"], [class*="favorite"], [class*="heart"], [class*="affiliate"], [class*="recommend"]')).map(el => ({
        tag: el.tagName,
        text: el.innerText?.trim(),
        ariaLabel: el.getAttribute('aria-label') || '',
        className: el.className?.toString().slice(0, 80) || '',
        href: el.getAttribute('href') || '',
        dataTestId: el.getAttribute('data-testid') || '',
      })).filter(a => a.text || a.ariaLabel || a.className.includes('bookmark') || a.className.includes('share'));

      return actions;
    });

    console.log('\n--- Ações encontradas na página do produto ---');
    console.log(JSON.stringify(productActions.slice(0, 25), null, 2));

    // [4/4] Verificar chamadas de rede registradas
    console.log(`\n[4/4] Chamadas de rede relevantes capturadas: ${networkCalls.length}`);
    for (const call of networkCalls.slice(0, 15)) {
      console.log(`  ${call.method} ${call.url}`);
      if (call.postData) console.log(`    Data: ${call.postData.slice(0, 200)}`);
    }

  } catch (err) {
    console.error('Erro na inspeção:', err);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
