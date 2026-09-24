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
import CategoryClassifier from '../services/category-classifier.js';

// URLs e categorias do Mercado Livre confirmadas via inspecção DOM (2026-09-24)
// Fonte: www.mercadolivre.com.br/ofertas retorna 48 poly-cards sem bloqueio anti-bot
export const ML_CATEGORIES = [
  { name: 'cozinha',      query: 'cozinha',            searchQuery: 'utilidades+cozinha' },
  { name: 'organizacao',  query: 'casa',               searchQuery: 'organizadores+casa' },
  { name: 'tecnologia',   query: 'eletronicos',        searchQuery: 'gadgets+tecnologia' },
  { name: 'ferramentas',  query: 'ferramentas',        searchQuery: 'ferramentas+domesticas' },
  { name: 'automotivo',   query: 'automotivo',         searchQuery: 'acessorios+carro' },
  { name: 'bebe',         query: 'bebe',               searchQuery: 'produtos+bebe' },
  { name: 'esporte',      query: 'esportes',           searchQuery: 'artigos+esporte' },
];

// URL de ofertas real confirmada (48 poly-cards, sem login redirect, sem anti-bot)
// Fallback: busca por keyword no search normal do ML
const ML_OFFERS_URL = 'https://www.mercadolivre.com.br/ofertas';
const ML_SEARCH_URL = 'https://lista.mercadolivre.com.br'; // usado com keyword: /KEYWORD_p

export class MercadoLivreScraper {
  /**
   * @param {import('../browser/browser.js').default} browserManager
   */
  constructor(browserManager) {
    this.browserManager = browserManager;
    this.categoryClassifier = new CategoryClassifier();
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
   * Pesquisa ofertas no Mercado Livre.
   *
   * Estratégia de URL (confirmada via inspecção DOM em 2026-09-24):
   *   1. www.mercadolivre.com.br/ofertas — retorna 48 poly-cards sem bloqueio
   *   2. lista.mercadolivre.com.br/KEYWORD — busca por keyword (fallback)
   *
   * IMPORTANTE: lista.mercadolivre.com.br/SLUG bloqueia com anti-bot.
   * NUNCA usar lista.mercadolivre.com.br com slugs de categoria.
   *
   * @param {object} options
   * @param {string} [options.category='cozinha'] - Nome da categoria
   * @param {string} [options.query='cozinha'] - Nome da categoria para filtro ou keyword
   * @param {string} [options.searchQuery] - Keyword de busca alternativa (lista.ml)
   * @param {number} [options.limit=15] - Limite de itens a coletar
   * @returns {Promise<Array<object>>} Lista de produtos normalizados
   */
  async search({ category = 'cozinha', query = 'cozinha', searchQuery, limit = 15 } = {}) {
    logger.info(`[MercadoLivre] Pesquisando categoria "${category}" via Ofertas ML (limite: ${limit})...`);

    const page = await this.browserManager.openPage();

    // Tenta primeiro via /ofertas (sem bloqueio, 48 cards confirmados)
    let rawProducts = await this._scrapeOffersPage(page, category, limit * 2);

    // Se /ofertas não trouxe nada, tenta busca por keyword
    if (rawProducts.length === 0 && searchQuery) {
      logger.info(`[MercadoLivre] Fallback: buscando por keyword "${searchQuery}"...`);
      rawProducts = await this._scrapeSearchPage(page, searchQuery, category, limit * 2);
    }

    logger.info(`[MercadoLivre] Itens brutos extraídos do DOM: ${rawProducts.length}`);

    // Normaliza itens
    const normalizedList = [];
    for (const raw of rawProducts) {
      if (normalizedList.length >= limit) break;

      const currentPrice = this._parsePrice(raw.priceText, raw.centsText);
      if (!currentPrice || currentPrice <= 0) continue;

      let originalPrice = this._parsePrice(raw.oldPriceText);
      let discountPercent = this._parseDiscount(raw.discountText);

      if (!discountPercent && originalPrice && originalPrice > currentPrice) {
        discountPercent = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
      }
      if (originalPrice && originalPrice <= currentPrice) {
        originalPrice = null;
        discountPercent = null;
      }

      let rating = null;
      if (raw.ratingText) {
        const matchRating = raw.ratingText.match(/(\d+[.,]\d+)/);
        if (matchRating) rating = parseFloat(matchRating[1].replace(',', '.'));
      }

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
        soldCount: null,
        sellerName: raw.sellerText || null,
        sellerReputation: raw.sellerText?.includes('MercadoLíder') ? 'MercadoLíder' : null,
        shipping: raw.shipping || null,
        imageUrl: raw.imgUrl || null,
        productUrl,
        category: this.categoryClassifier.classify(raw.title, productUrl, category).category,
        collectedAt: new Date().toISOString(),
      });
    }

    logger.info(`[MercadoLivre] Produtos normalizados válidos: ${normalizedList.length}`);
    return normalizedList;
  }

  /**
   * Coleta ofertas da página /ofertas do ML (48 poly-cards confirmados, sem bloqueio).
   * Sem filtro de categoria — retorna a página geral de ofertas do dia.
   */
  async _scrapeOffersPage(page, category, maxItems) {
    try {
      await page.goto(ML_OFFERS_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2500);
      return await this._extractPolyCards(page, maxItems);
    } catch (err) {
      logger.warn(`[MercadoLivre] _scrapeOffersPage falhou: ${err.message}`);
      return [];
    }
  }

  /**
   * Fallback: coleta resultados de busca por keyword no lista.ml.
   * Usa a URL /KEYWORD_p para busca real por produto.
   */
  async _scrapeSearchPage(page, searchQuery, category, maxItems) {
    try {
      const keyword = searchQuery.replace(/\+/g, '-');
      const searchUrl = `${ML_SEARCH_URL}/${encodeURIComponent(keyword)}_p`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2500);
      return await this._extractPolyCards(page, maxItems);
    } catch (err) {
      logger.warn(`[MercadoLivre] _scrapeSearchPage falhou: ${err.message}`);
      return [];
    }
  }

  /**
   * Extrai poly-cards do DOM da página atual.
   * Seletores confirmados via inspecção real (2026-09-24):
   *   - .poly-card (container principal poly-card)
   *   - .andes-card (container alternativo)
   *   - .ui-search-layout__item (fallback — buscas antigas)
   */
  async _extractPolyCards(page, maxItems) {
    return await page.evaluate((maxItems) => {
      const containerSelectors = [
        '.poly-card',
        '.andes-card[id^="polycard"]',
        '[id^="polycard_client"]',
        '.ui-search-layout__item',
        'li.ui-search-layout__item',
        '[class*="ui-search-layout__item"]',
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
            '.poly-component__title, h2.poly-box, .ui-search-item__title, a.ui-search-link, h2'
          );
          const title = titleEl ? titleEl.innerText.trim() : null;
          if (!title || title.length < 5) continue;

          // Link
          const linkEl = el.querySelector(
            'a.poly-component__title, a[class*="poly-component__title"], a.ui-search-link, a[href*="MLB"], a'
          );
          const rawUrl = linkEl ? linkEl.href : null;
          if (!rawUrl || !rawUrl.startsWith('http')) continue;

          // Preço atual
          const priceContainer = el.querySelector(
            '.poly-price__current, .ui-search-price__second-line, .ui-search-price__part--medium'
          );
          const priceEl = priceContainer
            ? priceContainer.querySelector('.andes-money-amount__fraction')
            : el.querySelector('.andes-money-amount__fraction:not(.andes-money-amount--previous .andes-money-amount__fraction)');
          const centsEl = priceContainer
            ? priceContainer.querySelector('.andes-money-amount__cents')
            : null;

          // Preço original
          const oldPriceEl = el.querySelector(
            '.andes-money-amount--previous .andes-money-amount__fraction, s .andes-money-amount__fraction'
          );

          // Desconto
          const discountEl = el.querySelector(
            '.poly-price__discount, .ui-search-price__discount, [class*="discount"]'
          );

          // Imagem
          const imgEl = el.querySelector(
            '.poly-component__picture img, .poly-card__portada img, img.ui-search-result-image__element, img'
          );

          // Avaliação
          const ratingEl = el.querySelector(
            '.poly-reviews__rating, .poly-component__review-compacted, [aria-label*="estrelas"], [aria-label*="rating"]'
          );

          // Reviews
          const reviewsEl = el.querySelector(
            '.poly-reviews__total, .ui-search-reviews__amount, [class*="reviews__total"], [class*="reviews__amount"]'
          );

          // Vendedor
          const sellerEl = el.querySelector(
            '.poly-component__seller, .poly-attributes-list .poly-attributes-list__item, [class*="seller"]'
          );

          // Frete
          const cardText = el.innerText || '';
          const shipping = cardText.includes('FULL') ? 'Full' :
                           cardText.includes('Frete grátis') ? 'Frete Grátis' :
                           cardText.includes('Grátis') ? 'Frete Grátis' : null;

          results.push({
            title,
            rawUrl,
            priceText: priceEl ? priceEl.innerText.trim() : null,
            centsText: centsEl ? centsEl.innerText.trim() : null,
            oldPriceText: oldPriceEl ? oldPriceEl.innerText.trim() : null,
            discountText: discountEl ? discountEl.innerText.trim() : null,
            imgUrl: imgEl ? (imgEl.src || imgEl.getAttribute('data-src')) : null,
            ratingText: ratingEl ? (ratingEl.getAttribute('aria-label') || ratingEl.innerText).trim() : null,
            reviewsText: reviewsEl ? reviewsEl.innerText.trim() : null,
            sellerText: sellerEl ? sellerEl.innerText.trim() : null,
            shipping,
          });
        } catch {
          // Ignora item com falha de parse
        }
      }
      return results;
    }, maxItems);
  }
}

export default MercadoLivreScraper;
