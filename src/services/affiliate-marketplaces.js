export function normalizeMarketplace(value = '') {
  return value.toLowerCase().replace(/[\s_-]/g, '');
}

export function officialHost(host, marketplace) {
  const domains = {
    mercadolivre: ['mercadolivre.com.br', 'mercadolivre.com', 'meli.la'],
    shopee: ['shopee.com.br', 'shope.ee'],
    amazon: ['amazon.com.br', 'amzn.to'],
  }[normalizeMarketplace(marketplace)] || [];
  return domains.some(d => host === d || host.endsWith(`.${d}`));
}

export function generatorUrl(product) {
  const marketplace = normalizeMarketplace(product.marketplace);
  if (marketplace === 'mercadolivre') return 'https://www.mercadolivre.com.br/afiliados/linkbuilder#hub';
  if (marketplace === 'shopee') return 'https://affiliate.shopee.com.br/offer/custom_link';
  // Amazon generates links with SiteStripe on the selected product page.
  if (marketplace === 'amazon') {
    const url = new URL(product.product_url);
    if (url.protocol === 'https:' && officialHost(url.hostname, marketplace) && !url.username && !url.password) return url.href;
  }
  throw new Error('Gerador oficial indisponível para este marketplace/produto.');
}

export function affiliatePattern(raw, marketplace) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const shortPath = /^\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname);
    switch (normalizeMarketplace(marketplace)) {
      case 'mercadolivre': return url.hostname === 'meli.la' && shortPath;
      case 'shopee': return ['s.shopee.com.br', 'shope.ee'].includes(url.hostname) && shortPath;
      case 'amazon': return (url.hostname === 'amzn.to' && shortPath) ||
        ((url.hostname === 'amazon.com.br' || url.hostname === 'www.amazon.com.br') && !!url.searchParams.get('tag') && /\/(?:dp|gp\/product)\/[A-Z0-9]{10}(?:\/|$)/i.test(url.pathname));
      default: return false;
    }
  } catch { return false; }
}

export function productIdentity(raw, marketplace) {
  try {
    const url = new URL(raw);
    if (!officialHost(url.hostname, marketplace)) return null;
    if (marketplace === 'mercadolivre') return url.pathname.match(/MLB-?\d+/i)?.[0].replace('-', '').toUpperCase() || null;
    if (marketplace === 'amazon') return url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1].toUpperCase() || null;
    if (marketplace === 'shopee') {
      const match = url.pathname.match(/(?:-i\.|\/product\/)(\d+)[./](\d+)/);
      return match ? `${match[1]}.${match[2]}` : null;
    }
  } catch {}
  return null;
}
