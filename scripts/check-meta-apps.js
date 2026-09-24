/**
 * Inspect developers.facebook.com/apps
 */
import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';

async function main() {
  const browser = new BrowserManager();
  await browser.launch();
  const page = await browser.openPage();

  try {
    console.log('[1] Navegando para https://developers.facebook.com/apps ...');
    await page.goto('https://developers.facebook.com/apps', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const url = page.url();
    const title = await page.title();
    console.log(`URL: ${url} | Título: "${title}"`);

    const appsFound = await page.evaluate(() => {
      // Procurar por apps listados
      const text = document.body.innerText;
      const links = Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.innerText.trim(),
        href: a.href,
      })).filter(a => a.href.includes('/apps/') || a.href.includes('app_id='));

      return {
        textSnippet: text.slice(0, 1000).replace(/\n+/g, ' | '),
        links: links.slice(0, 20),
      };
    });

    console.log('Texto developers.facebook.com:', appsFound.textSnippet);
    console.log('Links de Apps encontrados:', JSON.stringify(appsFound.links, null, 2));

    await page.screenshot({ path: 'scratch/meta_apps.png' });
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
