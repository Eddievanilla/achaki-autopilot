/**
 * Click on Login do Facebook para Empresas -> Configuracoes
 */
import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';

async function main() {
  const browser = new BrowserManager();
  await browser.launch();
  const page = await browser.openPage();

  try {
    await page.goto('https://developers.facebook.com/apps/1129522265443857/dashboard/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Encontrar o botão ou link de Login do Facebook para Empresas
    const fbLoginMenu = await page.$('text="Login do Facebook para Empresas"');
    if (fbLoginMenu) {
      console.log('Menu encontrado, clicando...');
      await fbLoginMenu.click();
      await page.waitForTimeout(1500);

      // Procurar "Configurações" que apareceu
      const configItem = await page.$('text="Configurações"');
      if (configItem) {
        console.log('Submenu Configurações encontrado, clicando...');
        await configItem.click();
        await page.waitForTimeout(3000);

        console.log('URL após clicar:', page.url());
        console.log('Título:', await page.title());

        const text = await page.evaluate(() => document.body.innerText.slice(0, 2000).replace(/\n+/g, ' | '));
        console.log('Texto:', text);

        await page.screenshot({ path: 'scratch/fb_login_settings.png', fullPage: true });
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
