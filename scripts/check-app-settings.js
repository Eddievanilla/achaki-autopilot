/**
 * Inspect App 1129522265443857 settings
 */
import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';

async function main() {
  const browser = new BrowserManager();
  await browser.launch();
  const page = await browser.openPage();

  try {
    console.log('[1] Navegando para Configurações Básicas do App 1129522265443857...');
    await page.goto('https://developers.facebook.com/apps/1129522265443857/settings/basic/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    console.log(`URL: ${page.url()} | Título: "${await page.title()}"`);

    const settingsInfo = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, textarea')).map(i => ({
        id: i.id,
        name: i.name,
        type: i.type,
        value: i.type === 'password' ? '***SECRET***' : (i.value || '').slice(0, 100),
        placeholder: i.placeholder,
      }));

      const body = document.body.innerText.slice(0, 1500).replace(/\n+/g, ' | ');

      return { inputs, body };
    });

    console.log('Inputs encontrados:');
    console.log(JSON.stringify(settingsInfo.inputs, null, 2));
    console.log('\nTexto da Página:');
    console.log(settingsInfo.body);

    await page.screenshot({ path: 'scratch/app_settings.png' });

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
