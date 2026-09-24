/**
 * Testar:
 * 1. Clicar em "Minhas recomendações" em bookmarks/list
 * 2. Clicar no botão "Gerador de links" na Central de Afiliados
 */
import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';

async function main() {
  const browser = new BrowserManager();
  await browser.launch();
  const page = await browser.openPage();

  try {
    // ----------------------------------------------------
    // PARTE 1: CENTRAL DE AFILIADOS - GERADOR DE LINKS
    // ----------------------------------------------------
    console.log('=== [PARTE 1] CENTRAL DE AFILIADOS — GERADOR DE LINKS ===');
    await page.goto('https://www.mercadolivre.com.br/afiliados/hub?is_affiliate=true', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Clicar no botão "Gerador de links"
    const genBtn = await page.$('button:has-text("Gerador de links"), [role="button"]:has-text("Gerador de links")');
    if (genBtn) {
      console.log('Clicando em "Gerador de links"...');
      await genBtn.click();
      await page.waitForTimeout(2000);

      // Inspecionar se abriu modal, drawer ou nova tela
      const modalInfo = await page.evaluate(() => {
        const modals = Array.from(document.querySelectorAll('[role="dialog"], .andes-modal, [class*="modal"], [class*="drawer"], form')).map(m => ({
          tag: m.tagName,
          className: m.className,
          text: m.innerText?.trim()?.slice(0, 500),
        }));

        const inputs = Array.from(document.querySelectorAll('input, textarea')).map(i => ({
          name: i.name,
          placeholder: i.placeholder,
          type: i.type,
          className: i.className,
          id: i.id,
        }));

        const buttons = Array.from(document.querySelectorAll('button')).filter(b => {
          const t = b.innerText?.trim() || '';
          return t.includes('Gerar') || t.includes('Link') || t.includes('Copiar') || t.includes('Continuar');
        }).map(b => b.innerText.trim());

        return { modals, inputs, buttons, currentUrl: window.location.href };
      });

      console.log('Modal / Form do Gerador de Links:');
      console.log('URL atual:', modalInfo.currentUrl);
      console.log('Inputs encontrados:', JSON.stringify(modalInfo.inputs, null, 2));
      console.log('Botões de ação:', JSON.stringify(modalInfo.buttons, null, 2));
      console.log('Texto do Modal/Drawer:', JSON.stringify(modalInfo.modals, null, 2));

      await page.screenshot({ path: 'scratch/gerador_links_modal.png' });
      console.log('Screenshot salva em scratch/gerador_links_modal.png');
    } else {
      console.log('Botão "Gerador de links" não encontrado!');
    }

    // ----------------------------------------------------
    // PARTE 2: BOOKMARKS/LIST - "Minhas recomendações"
    // ----------------------------------------------------
    console.log('\n=== [PARTE 2] BOOKMARKS — "Minhas recomendações" ===');
    await page.goto('https://myaccount.mercadolivre.com.br/bookmarks/list', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Clicar na aba Listas (9)
    const listTab = await page.$('button[role="tab"]:has-text("Listas"), button:has-text("Listas (9)")');
    if (listTab) {
      await listTab.click();
      await page.waitForTimeout(2000);

      // Clicar em "Minhas recomendações"
      const recItem = await page.$('text="Minhas recomendações"');
      if (recItem) {
        console.log('Clicando em "Minhas recomendações"...');
        await recItem.click();
        await page.waitForTimeout(3000);

        console.log('URL da Lista de Recomendações:', page.url());
        console.log('Título:', await page.title());

        const listContent = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button, a')).map(b => ({
            tag: b.tagName,
            text: b.innerText?.trim(),
            href: b.getAttribute('href') || '',
            className: b.className?.toString().slice(0, 60),
          })).filter(b => b.text && (
            b.text.includes('Compartilhar') || 
            b.text.includes('Recomendar') || 
            b.text.includes('Copiar') || 
            b.text.includes('Adicionar') ||
            b.text.includes('Link')
          ));

          return {
            buttons: btns.slice(0, 20),
            bodySnippet: document.body.innerText.slice(0, 1000),
          };
        });

        console.log('Botões na lista de recomendações:', JSON.stringify(listContent.buttons, null, 2));
        console.log('\nTexto na lista:', listContent.bodySnippet);

        await page.screenshot({ path: 'scratch/minhas_recomendacoes_page.png' });
        console.log('Screenshot salva em scratch/minhas_recomendacoes_page.png');
      }
    }

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
