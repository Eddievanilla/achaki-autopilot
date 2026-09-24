/**
 * Testar o Gerador Oficial de Links de Afiliados do Mercado Livre
 * URL: https://www.mercadolivre.com.br/afiliados/linkbuilder#hub
 */
import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';

async function main() {
  const browser = new BrowserManager();
  await browser.launch();
  const page = await browser.openPage();

  const networkResponses = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('link') || url.includes('affiliate') || url.includes('shorten') || url.includes('builder') || url.includes('generate')) {
      try {
        const status = response.status();
        const text = await response.text();
        networkResponses.push({ url, status, text: text.slice(0, 500) });
      } catch {}
    }
  });

  try {
    const pilotProductUrl = 'https://produto.mercadolivre.com.br/MLB-4817578135-lampada-camera-de-seguranca-wi-fi-com-viso-noturna-para-casa-_JM';
    console.log(`\n[1] Navegando para https://www.mercadolivre.com.br/afiliados/linkbuilder#hub ...`);
    await page.goto('https://www.mercadolivre.com.br/afiliados/linkbuilder#hub', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    console.log('[2] Procurando textarea de URL...');
    const textarea = await page.$('#url-0, textarea[placeholder*="mercadolivre"], textarea');
    if (!textarea) {
      console.log('Textarea não encontrada!');
      return;
    }

    console.log(`[3] Preenchendo com a URL do produto piloto: ${pilotProductUrl}`);
    await textarea.fill(pilotProductUrl);
    await page.waitForTimeout(1000);

    console.log('[4] Clicando no botão "Gerar"...');
    const generateBtn = await page.$('button:has-text("Gerar"), .andes-button:has-text("Gerar")');
    if (!generateBtn) {
      console.log('Botão Gerar não encontrado!');
      return;
    }

    await generateBtn.click();
    console.log('Botão Gerar clicado. Aguardando resultado...');
    await page.waitForTimeout(4000);

    // Extrair o resultado na tela
    const result = await page.evaluate(() => {
      // Procura por inputs de link gerado, botões de copiar, etc.
      const links = Array.from(document.querySelectorAll('a, input, textarea, span, p')).map(el => {
        const val = el.value || el.innerText || el.href || '';
        return {
          tag: el.tagName,
          val: val.trim(),
          id: el.id,
          className: el.className?.toString().slice(0, 50),
        };
      }).filter(el => el.val.includes('mercadolivre') || el.val.includes('meli.la') || el.val.includes('matt_tool') || el.val.includes('matt_word') || el.val.includes('afiliado'));

      const allButtons = Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean);

      return {
        links,
        allButtons,
        bodySnippet: document.body.innerText.slice(0, 1500),
      };
    });

    console.log('\n--- Links e Elementos Gerados na Tela ---');
    console.log(JSON.stringify(result.links, null, 2));

    console.log('\n--- Botões Encontrados ---');
    console.log(JSON.stringify(result.allButtons, null, 2));

    console.log('\n--- Texto Completo da Tela Após Gerar ---');
    console.log(result.bodySnippet);

    console.log('\n--- Chamadas de Rede Relevantes (API) ---');
    console.log(JSON.stringify(networkResponses, null, 2));

    await page.screenshot({ path: 'scratch/link_gerado_sucesso.png', fullPage: true });
    console.log('\nScreenshot salva em scratch/link_gerado_sucesso.png');

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
