/**
 * ACHAki Autopilot — Scraper Mercado Livre (Fase 4)
 *
 * Coleta ofertas reais das páginas de busca e listagem do Mercado Livre.
 * Usa seletores baseados no DOM real inspecionado (2026-09-23).
 *
 * Princípios:
 *  - Múltiplos seletores de fallback (resiliente a variações de layout poly-card / ui-search).
 *  - Normalização estrita para o schema ACHAki.
 *  - Sem mocks: dados reais extraídos diretamente do DOM renderizado.
 */

import logger from '../utils/logger.js';

// Categorias e termos recomendados para achadinhos
export const ML_CATEGORIES = [
  { name: 'cozinha', query: 'utilidades-cozinha' },
  { name: 'organizacao', query: 'organizadores-casa' },
  { name: 'tecnologia', query: 'gadgets-utilidades' },
  { name: 'ferramentas', query: 'ferramentas-praticas' },
  { name: 'automotivo', query: 'acessorios-carro-utilidades' },
];

export class MercadoLivreScraper {
  /**
   * @param {import('../browser/browser.js').default} browserManager
   */
  constructor(browserManager) {
    this.browserManager = browserManager;
  }

  /**
   * Converte texto de preço brasileiro ("29", "29,90", "1.249,00") em número flutuante.
   * @param {string|null} priceStr
   * @param {string|null} centsStr
   * @returns {number|null}
   */
  _parsePrice(priceStr, centsStr = null) {
    if (!priceStr) return null;
    try {
      const clean = priceStr.replace(/\./g, '').replace(/[^\d]/g, '').trim();
      if (!clean) return null;
      let val = parseInt(clean, 10);
      if (centsStr) {
        const cents = parseInt(centsStr.replace(/[^\d]/g, ''), 10) || 0;
        val += cents / 100;
      }
      return val > 0 ? val : null;
    } catch {
      return null;
    }
  }

  /**
   * Extrai o percentual de desconto a partir de texto (ex: "15% OFF" -> 15).
   * @param {string|null} text
   * @returns {number|null}
   */
  _parseDiscount(text) {
    if (!text) return null;
    const match = text.match(/(\d+)%\s*OFF/i);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Extrai o ID do produto MLB a partir da URL.
   * @param {string} url
   * @returns {string}
   */
  _extractProductId(url) {
    if (!url) return `ML_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const mlbMatch = url.match(/(MLB-?\d+)/i) ||
                     url.match(/item_id%3A(MLB\d+)/i) ||
                     url.match(/wid=(MLB\d+)/i);
    if (mlbMatch) {
      return mlbMatch[1].replace('-', '').toUpperCase();
    }
    const hash = Math.abs(url.split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0));
    return `ML_${hash}`;
  }

  /**
   * Limpa e padroniza a URL do produto, garantindo que seja um link direto e específico de produto.
   * Rejeita homepages, buscas e URLs genéricas.
   * @param {string} rawUrl
   * @returns {string|null} Retorna a URL limpa ou null se for genérica/inválida
   */
  _cleanProductUrl(rawUrl) {
    if (!rawUrl) return null;
    try {
      const u = new URL(rawUrl);
      const path = u.pathname.trim();

      // Rejeita raiz / homepage genérica
      if (!path || path === '/' || path === '') return null;

      // Rejeita páginas de busca ou listagem
      if (u.hostname.includes('lista.mercadolivre') || path.includes('/lista') || path.includes('/search')) {
        return null;
      }

      // Se for link direto de produto com rota específica (/p/MLB..., /up/MLB..., /MLB-...)
      if (u.hostname.includes('mercadolivre.com.br') && !u.pathname.includes('/mclics/')) {
        if (path.length > 5 && (path.includes('/p/') || path.includes('/up/') || path.includes('/MLB-') || path.includes('/MLB'))) {
          return `${u.origin}${u.pathname}`;
        }
      }

      // Se for link patrocinado mclics, extrai o MLB ID e gera o link direto canônico
      const mlbMatch = rawUrl.match(/item_id%3A(MLB\d+)/i) ||
                       rawUrl.match(/wid=(MLB\d+)/i) ||
                       rawUrl.match(/(MLB-?\d+)/i);
      if (mlbMatch) {
        const idNum = mlbMatch[1].replace(/[^\d]/g, '');
        if (idNum.length >= 6) {
          return `https://produto.mercadolivre.com.br/MLB-${idNum}`;
        }
      }

      if (path.length > 10 && !path.includes('/mclics/')) {
        return `${u.origin}${u.pathname}`;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Pesquisa ofertas no Mercado Livre para um termo/categoria.
   *
   * @param {object} options
   * @param {string} [options.category='utilidades'] - Nome da categoria
   * @param {string} [options.query='utilidades-domesticas'] - Termo ou slug de busca
   * @param {number} [options.limit=15] - Limite de itens a coletar nesta busca
   * @returns {Promise<Array<object>>} Lista de produtos normalizados
   */
  async search({ category = 'utilidades', query = 'utilidades-domesticas', limit = 15 } = {}) {
    logger.info(`[MercadoLivre] Pesquisando categoria "${category}" (query: "${query}", limite: ${limit})...`);

    const page = await this.browserManager.openPage();
    const searchUrl = `https://lista.mercadolivre.com.br/${encodeURIComponent(query)}`;

    try {
      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });

      // Aguarda renderização dos cards
      await page.waitForTimeout(2500);

      // Extrai dados diretamente do DOM
      const rawProducts = await page.evaluate((maxItems) => {
        // Seletores candidatos para contêiner de produto
        const containerSelectors = [
          '.ui-search-layout__item',
          'li.ui-search-layout__item',
          '.ui-search-result',
          '[class*="ui-search-layout__item"]'
        ];

        let itemNodes = [];
        for (const sel of containerSelectors) {
          const found = document.querySelectorAll(sel);
          if (found.length > 0) {
            itemNodes = Array.from(found);
            break;
          }
        }

        const results = [];

        for (const el of itemNodes) {
          if (results.length >= maxItems) break;

          try {
            // Título
            const titleEl = el.querySelector(
              '.poly-component__title, .ui-search-item__title, a.ui-search-link, h2'
            );
            const title = titleEl ? titleEl.innerText.trim() : null;
            if (!title) continue;

            // Link do produto
            const linkEl = el.querySelector(
              'a.poly-component__title, a.ui-search-link, a[href*="MLB"], a'
            );
            const rawUrl = linkEl ? linkEl.href : null;
            if (!rawUrl || !rawUrl.startsWith('http')) continue;

            // Preço atual
            const priceEl = el.querySelector(
              '.poly-price__current .andes-money-amount__fraction, .ui-search-price__part--medium .andes-money-amount__fraction, .andes-money-amount__fraction'
            );
            const centsEl = el.querySelector(
              '.poly-price__current .andes-money-amount__cents, .andes-money-amount__cents'
            );
            const priceText = priceEl ? priceEl.innerText.trim() : null;
            const centsText = centsEl ? centsEl.innerText.trim() : null;

            // Preço anterior / original
            const oldPriceEl = el.querySelector(
              '.andes-money-amount--previous .andes-money-amount__fraction, s .andes-money-amount__fraction'
            );
            const oldPriceText = oldPriceEl ? oldPriceEl.innerText.trim() : null;

            // Desconto texto
            const discountEl = el.querySelector(
              '.ui-search-price__discount, .poly-price__discount, [class*="discount"]'
            );
            const discountText = discountEl ? discountEl.innerText.trim() : null;

            // Imagem
            const imgEl = el.querySelector(
              '.poly-component__picture img, img.ui-search-result-image__element, img'
            );
            const imgUrl = imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || imgEl.getAttribute('src')) : null;

            // Avaliação e reviews
            const ratingEl = el.querySelector(
              '.poly-component__review-compacted, .ui-search-reviews__rating-number, [aria-label*="estrelas"]'
            );
            const ratingText = ratingEl ? (ratingEl.getAttribute('aria-label') || ratingEl.innerText).trim() : null;

            const reviewsEl = el.querySelector(
              '.ui-search-reviews__amount, [class*="reviews__amount"]'
            );
            const reviewsText = reviewsEl ? reviewsEl.innerText.trim() : null;

            // Vendedor
            const sellerEl = el.querySelector('.poly-component__seller, [class*="seller"]');
            const sellerText = sellerEl ? sellerEl.innerText.trim() : null;

            // Frete
            const cardText = el.innerText || '';
            const shipping = cardText.includes('FULL') ? 'Full' :
                             cardText.includes('Frete grátis') ? 'Frete Grátis' : null;

            results.push({
              title,
              rawUrl,
              priceText,
              centsText,
              oldPriceText,
              discountText,
              imgUrl,
              ratingText,
              reviewsText,
              sellerText,
              shipping,
            });
          } catch {
            // Ignora item com falha de parse
          }
        }

        return results;
      }, limit * 2);

      logger.info(`[MercadoLivre] Itens brutos extraídos do DOM: ${rawProducts.length}`);

      // Normaliza itens
      const normalizedList = [];

      for (const raw of rawProducts) {
        if (normalizedList.length >= limit) break;

        const currentPrice = this._parsePrice(raw.priceText, raw.centsText);
        if (!currentPrice || currentPrice <= 0) continue;

        let originalPrice = this._parsePrice(raw.oldPriceText);
        let discountPercent = this._parseDiscount(raw.discountText);

        // Se tiver preço anterior mas não tiver desconto explícito
        if (!discountPercent && originalPrice && originalPrice > currentPrice) {
          discountPercent = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
        }

        // Se tiver desconto e preço atual, calcula original se ausente
        if (discountPercent && (!originalPrice || originalPrice <= currentPrice)) {
          originalPrice = Number((currentPrice / (1 - discountPercent / 100)).toFixed(2));
        }

        // Parse rating (ex: "4.7" ou "4.7 de 5 estrelas")
        let rating = null;
        if (raw.ratingText) {
          const matchRating = raw.ratingText.match(/(\d+[.,]\d+)/);
          if (matchRating) {
            rating = parseFloat(matchRating[1].replace(',', '.'));
          }
        }

        // Parse review count (ex: "(120)" -> 120)
        let reviewCount = null;
        if (raw.reviewsText) {
          const matchReviews = raw.reviewsText.replace(/[^\d]/g, '');
          if (matchReviews) reviewCount = parseInt(matchReviews, 10);
        }

        const productId = this._extractProductId(raw.rawUrl);
        const productUrl = this._cleanProductUrl(raw.rawUrl);
        if (!productUrl) continue;

        normalizedList.push({
          marketplace: 'mercadolivre',
          productId,
          title: raw.title,
          currentPrice,
          originalPrice: originalPrice || null,
          discountPercent: discountPercent || null,
          rating,
          reviewCount,
          soldCount: null, // Na listagem do ML vendas nem sempre estão no card; preservado como null
          sellerName: raw.sellerText || null,
          sellerReputation: raw.sellerText?.includes('MercadoLíder') ? 'MercadoLíder' : null,
          shipping: raw.shipping || null,
          imageUrl: raw.imgUrl || null,
          productUrl,
          category,
          collectedAt: new Date().toISOString(),
        });
      }

      logger.info(`[MercadoLivre] Produtos normalizados válidos: ${normalizedList.length}`);
      return normalizedList;

    } catch (err) {
      logger.warn(`[MercadoLivre] Erro na busca (${category}): ${err.message}`);
      return [];
    }
  }
}

export default MercadoLivreScraper;
