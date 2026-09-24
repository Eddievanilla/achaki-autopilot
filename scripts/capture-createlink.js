/**
 * Capturar Payload e Headers exatos de createLink
 */
import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';

async function main() {
  const browser = new BrowserManager();
  await browser.launch();
  const page = await browser.openPage();

  let capturedRequest = null;
  let capturedResponse = null;

  page.on('request', (req) => {
    if (req.url().includes('createLink')) {
      capturedRequest = {
        url: req.url(),
        method: req.method(),
        headers: req.headers(),
        postData: req.postData(),
      };
    }
  });

  page.on('response', async (res) => {
    if (res.url().includes('createLink')) {
      try {
        capturedResponse = {
          status: res.status(),
          data: await res.json(),
        };
      } catch (e) {
        capturedResponse = { error: e.message };
      }
    }
  });

  try {
    const pilotProductUrl = 'https://produto.mercadolivre.com.br/MLB-4817578135-lampada-camera-de-seguranca-wi-fi-com-viso-noturna-para-casa-_JM';
    await page.goto('https://www.mercadolivre.com.br/afiliados/linkbuilder#hub', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const textarea = await page.$('#url-0, textarea');
    await textarea.fill(pilotProductUrl);
    await page.waitForTimeout(1000);

    const generateBtn = await page.$('button:has-text("Gerar"), .andes-button:has-text("Gerar")');
    await generateBtn.click();
    await page.waitForTimeout(4000);

    console.log('=== REQUEST CAPTURADO ===');
    console.log('URL:', capturedRequest?.url);
    console.log('Method:', capturedRequest?.method);
    console.log('Payload:', capturedRequest?.postData);
    console.log('Headers Relevantes:');
    const h = capturedRequest?.headers || {};
    console.log('  content-type:', h['content-type']);
    console.log('  x-csrf-token:', h['x-csrf-token']);
    console.log('  referer:', h['referer']);

    console.log('\n=== RESPONSE CAPTURADO ===');
    console.log(JSON.stringify(capturedResponse, null, 2));

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
