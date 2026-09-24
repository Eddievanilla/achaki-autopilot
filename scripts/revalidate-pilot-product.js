/**
 * Revalidar oferta piloto em tempo real diretamente no Mercado Livre
 */
import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';

async function main() {
  console.log('=== REVALIDAÇÃO EM TEMPO REAL DA OFERTA PILOTO ===\n');
  const browser = new BrowserManager();
  await browser.launch();
  const page = await browser.openPage();

  try {
    const url = 'https://produto.mercadolivre.com.br/MLB-4817578135-lampada-camera-de-seguranca-wi-fi-com-viso-noturna-para-casa-_JM';
    console.log(`Acessando: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const priceData = await page.evaluate(() => {
      // Extrair título
      const titleEl = document.querySelector('h1.ui-pdp-title');
      const title = titleEl ? titleEl.innerText.trim() : document.title;

      // Extrair preço atual
      const priceFraction = document.querySelector('.ui-pdp-price__second-line .andes-money-amount__fraction, .ui-pdp-price--size-large .andes-money-amount__fraction, .andes-money-amount--price .andes-money-amount__fraction');
      const priceCents = document.querySelector('.ui-pdp-price__second-line .andes-money-amount__cents, .ui-pdp-price--size-large .andes-money-amount__cents');

      // Preço original (riscado)
      const originalFraction = document.querySelector('.ui-pdp-price__original-value .andes-money-amount__fraction, s .andes-money-amount__fraction');
      const originalCents = document.querySelector('.ui-pdp-price__original-value .andes-money-amount__cents, s .andes-money-amount__cents');

      // Desconto
      const discountEl = document.querySelector('.ui-pdp-price__second-line .ui-pdp-price__discount, .ui-pdp-price--size-large .ui-pdp-price__discount');

      // Estoque / Disponibilidade
      const isAvailable = !document.body.innerText.includes('Publicação finalizada') && !document.body.innerText.includes('Estoque esgotado');

      return {
        title,
        priceStr: priceFraction ? priceFraction.innerText.trim() : null,
        centsStr: priceCents ? priceCents.innerText.trim() : '00',
        origPriceStr: originalFraction ? originalFraction.innerText.trim() : null,
        origCentsStr: originalCents ? originalCents.innerText.trim() : '00',
        discountStr: discountEl ? discountEl.innerText.trim() : null,
        isAvailable,
      };
    });

    const currentPrice = priceData.priceStr ? parseFloat(priceData.priceStr.replace(/\./g, '') + '.' + priceData.centsStr) : null;
    const originalPrice = priceData.origPriceStr ? parseFloat(priceData.origPriceStr.replace(/\./g, '') + '.' + priceData.origCentsStr) : null;
    const discountPercent = priceData.discountStr ? parseInt(priceData.discountStr.replace(/[^\d]/g, ''), 10) : 0;

    console.log(`Título: ${priceData.title}`);
    console.log(`Disponível em Estoque: ${priceData.isAvailable ? 'SIM' : 'NÃO'}`);
    console.log(`Preço Atual Revalidado: R$ ${currentPrice}`);
    console.log(`Preço Original: R$ ${originalPrice || 'N/A'}`);
    console.log(`Desconto Revalidado: ${discountPercent}%`);

    const isPriceConsistent = currentPrice && currentPrice > 0 && (!originalPrice || currentPrice <= originalPrice);
    console.log(`Preço Consistente: ${isPriceConsistent ? 'SIM' : 'NÃO'}`);

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
