/**
 * Test Meta OAuth Dialog URL
 */
import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';

async function main() {
  const browser = new BrowserManager();
  await browser.launch();
  const page = await browser.openPage();

  const appId = '1129522265443857';
  const redirectUri = 'https://achaki-autopilot.vercel.app/auth/facebook/callback';
  const scope = 'pages_show_list,pages_read_engagement,pages_manage_posts';
  const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&response_type=code`;

  console.log(`URL de Autorização:\n${authUrl}\n`);

  try {
    await page.goto(authUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    const title = await page.title();
    console.log(`URL Atual: ${currentUrl}`);
    console.log(`Título: "${title}"`);

    const pageText = await page.evaluate(() => document.body.innerText.slice(0, 1500).replace(/\n+/g, ' | '));
    console.log(`Texto: ${pageText}`);

    await page.screenshot({ path: 'scratch/meta_oauth_dialog.png' });
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
