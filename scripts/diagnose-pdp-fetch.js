// Use native Node fetch

async function testFetch() {
  const url = 'https://www.mercadolivre.com.br/carrinho-organizador-multiuso-de-aco-carbono-com-3-prateleiras-e-rodinhas/p/MLB45605255';
  console.log('Fetching:', url);

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
    }
  });

  console.log('HTTP Status:', res.status);
  console.log('Final URL:', res.url);
  const html = await res.text();
  console.log('HTML size:', html.length);

  // Check title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  console.log('Title in HTML:', titleMatch ? titleMatch[1] : 'NONE');

  // Check prices
  const ariaMatches = [...html.matchAll(/aria-label="([^"]*reais[^"]*)"/gi)].map(m => m[1]);
  console.log('Aria prices in HTML:', ariaMatches);

  const metaPrice = html.match(/itemprop="price"\s+content="([^"]+)"/i);
  console.log('Meta price:', metaPrice ? metaPrice[1] : 'NONE');
}

testFetch().catch(console.error);
