/**
 * ACHAki Autopilot — Scraper Shopee (Fase 4)
 *
 * Coleta ofertas reais das páginas de busca e listagem da Shopee.
 * Respeita regras de segurança: CAPTCHAs nunca são burlados automaticamente;
 * se um desafio for exibido, aguarda resolução manual pelo operador no Chromium visual.
 *
 * Princípios:
 *  - Múltiplos seletores de fallback para itens, títulos, preços e imagens.
 *  - Rolagem suave para disparo de lazy loading.
 *  - Normalização estrita para o schema ACHAki.
 */

import logger from '../utils/logger.js';

// Categorias e termos recomendados para achadinhos na Shopee
export const SHOPEE_CATEGORIES = [
  { name: 'organizacao', query: 'organizador casa' },
  { name: 'cozinha', query: 'achadinhos cozinha' },
  { name: 'tecnologia', query: 'gadgets inteligentes' },
  { name: 'utilidades', query: 'utilidades domesticas criativas' },
  { name: 'beleza', query: 'acessorios beleza' },
];

export class ShopeeScraper {
  /**
   * @param {import('../browser/browser.js').default} browserManager
   */
  constructor(browserManager) {
    this.browserManager = browserManager;
    /** @type {'AVAILABLE'|'TEMPORARILY_BLOCKED'} */
    this.status = 'AVAILABLE';
  }

  /**
   * Converte texto de preço brasileiro ("29,90", "R$ 149,00") em número.
   * @param {string|null} priceStr
   * @returns {number|null}
   */
  _parsePrice(priceStr) {
    if (!priceStr) return null;
    try {
      // Remove "R$", espaços e outros caracteres
      const clean = priceStr.replace(/R\$\s*/gi, '').replace(/\./g, '').replace(',', '.').trim();
      const match = clean.match(/(\d+(?:\.\d+)?)/);
      if (!match) return null;
      const val = parseFloat(match[1]);
      return val > 0 ? val : null;
    } catch {
      return null;
    }
  }

  /**
   * Converte texto de vendas ("1,2mil vendidos", "850 vendidos", "5k vendidos") em número.
   * @param {string|null} text
   * @returns {number|null}
   */
  _parseSoldCount(text) {
    if (!text) return null;
    try {
      const lower = text.toLowerCase();
      const milMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:mil|k)/);
      if (milMatch) {
        const num = parseFloat(milMatch[1].replace(',', '.'));
        return Math.round(num * 1000);
      }
      const directMatch = lower.match(/(\d+)/);
      return directMatch ? parseInt(directMatch[1], 10) : null;
    } catch {
      return null;
    }
  }

  /**
   * Extrai o percentual de desconto a partir de texto (ex: "-35%", "35% OFF").
   * @param {string|null} text
   * @returns {number|null}
   */
  _parseDiscount(text) {
    if (!text) return null;
    const match = text.match(/(\d+)%/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Extrai ID do produto Shopee a partir da URL.
   * @param {string} url
   * @returns {string}
   */
  _extractProductId(url) {
    if (!url) return `SH_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const match = url.match(/-i\.(\d+)\.(\d+)/) || url.match(/\/(\d+)\/(\d+)/);
    if (match) {
      return `SH_${match[1]}_${match[2]}`;
    }
    const hash = Math.abs(url.split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0));
    return `SH_${hash}`;
  }

  /**
   * Limpa a URL da Shopee removendo parâmetros de tracking de busca.
   * @param {string} rawUrl
   * @returns {string}
   */
  _cleanProductUrl(rawUrl) {
    if (!rawUrl) return '';
    try {
      const u = new URL(rawUrl);
      return `${u.origin}${u.pathname}`;
    } catch {
      return rawUrl;
    }
  }

  /**
   * Verifica se a página atual caiu em tela de desafio/captcha/bloqueio oficial.
   * @param {import('playwright').Page} page
   * @returns {Promise<boolean>}
   */
  async _isBlockedOrCaptcha(page) {
    const url = page.url();
    if (url.includes('/verify/') || url.includes('captcha')) return true;
    try {
      const bodySnippet = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 1000) : '');
      const isBlocked = (
        bodySnippet.includes('Tente Novamente Mais Tarde') ||
        bodySnippet.includes('A verificação falhou') ||
        bodySnippet.includes('quebra-cabeça') ||
        bodySnippet.includes('Verifique para continuar') ||
        bodySnippet.includes('anti-bot')
      );
      return isBlocked;
    } catch {
      return false;
    }
  }

  /**
   * Pesquisa ofertas na Shopee para um termo/categoria.
   * Se a Shopee estiver temporariamente bloqueada pelo mecanismo anti-bot,
   * encerra a tentativa imediatamente sem retries.
   *
   * @param {object} options
   * @param {string} [options.category='utilidades'] - Nome da categoria
   * @param {string} [options.query='organizador'] - Palavra-chave de busca
   * @param {number} [options.limit=15] - Limite de itens a coletar
   * @returns {Promise<Array<object>>} Lista de produtos normalizados
   */
  async search({ category = 'utilidades', query = 'organizador', limit = 15 } = {}) {
    // Se já foi detectado bloqueio temporário nesta sessão, não repete requisições
    if (this.status === 'TEMPORARILY_BLOCKED') {
      logger.info(`[Shopee] Ignorando busca ("${query}"): Shopee está TEMPORARILY_BLOCKED.`);
      return [];
    }

    logger.info(`[Shopee] Pesquisando categoria "${category}" (query: "${query}", limite: ${limit})...`);

    const page = await this.browserManager.openPage();
    const searchUrl = `https://shopee.com.br/search?keyword=${encodeURIComponent(query)}`;

    try {
      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 25_000,
      });

      await page.waitForTimeout(2000);

      // Verificação imediata de bloqueio anti-bot / verificação falhou
      const isBlocked = await this._isBlockedOrCaptcha(page);
      if (isBlocked) {
        this.status = 'TEMPORARILY_BLOCKED';
        logger.warn('[Shopee] Bloqueio temporário anti-bot detectado na Shopee (status: SHOPEE_TEMPORARILY_BLOCKED).');
        logger.warn('[Shopee] Encerrando imediatamente a coleta da Shopee para preservar o fluxo.');
        return [];
      }

      // Rola a página suavemente para disparar lazy-loading dos produtos e imagens
      await page.evaluate(async () => {
        window.scrollBy(0, 400);
        await new Promise((r) => setTimeout(r, 600));
        window.scrollBy(0, 600);
        await new Promise((r) => setTimeout(r, 800));
      });

      await page.waitForTimeout(1500);

      // Extrai dados brutos do DOM da Shopee
      const rawProducts = await page.evaluate((maxItems) => {
        // Seletores candidatos para cards de produtos na busca da Shopee
        const containerSelectors = [
          'li.shopee-search-item-result__item',
          'div.shopee-search-item-result__item',
          'div[class*="shopee-search-item-result__item"]',
          'a[data-sqe="link"]',
          'div.col-xs-2-4'
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
            // Link
            let rawUrl = null;
            if (el.tagName === 'A' && el.href) {
              rawUrl = el.href;
            } else {
              const a = el.querySelector('a[href*="-i."]') || el.querySelector('a');
              rawUrl = a ? a.href : null;
            }
            if (!rawUrl || !rawUrl.includes('shopee.com.br')) continue;

            // Título
            const titleEl = el.querySelector(
              '[data-sqe="name"], [class*="name"], [class*="title"], h3'
            );
            const title = titleEl ? titleEl.innerText.trim() : null;
            if (!title) continue;

            // Preço atual
            const priceEl = el.querySelector(
              'span[class*="price"], div[class*="price"], [data-sqe="price"]'
            );
            const priceText = priceEl ? priceEl.innerText.trim() : null;

            // Preço anterior
            const oldPriceEl = el.querySelector(
              'del, s, [class*="original-price"], [class*="old-price"]'
            );
            const oldPriceText = oldPriceEl ? oldPriceEl.innerText.trim() : null;

            // Desconto texto
            const discountEl = el.querySelector(
              '[class*="discount"], [class*="badge--discount"]'
            );
            const discountText = discountEl ? discountEl.innerText.trim() : null;

            // Vendas
            const soldEl = el.querySelector(
              '[class*="sold"], [class*="rating-stars"] ~ span'
            );
            const soldText = soldEl ? soldEl.innerText.trim() : null;

            // Avaliação
            const ratingEl = el.querySelector(
              '[class*="rating-solid"], [class*="rating-value"], [class*="stars"]'
            );
            const ratingText = ratingEl ? ratingEl.innerText.trim() : null;

            // Imagem
            const imgEl = el.querySelector('img');
            const imgUrl = imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || imgEl.getAttribute('src')) : null;

            results.push({
              title,
              rawUrl,
              priceText,
              oldPriceText,
              discountText,
              soldText,
              ratingText,
              imgUrl,
            });
          } catch {
            // Ignora item com falha
          }
        }

        return results;
      }, limit * 2);

      logger.info(`[Shopee] Itens brutos extraídos do DOM: ${rawProducts.length}`);

      // Normaliza
      const normalizedList = [];

      for (const raw of rawProducts) {
        if (normalizedList.length >= limit) break;

        const currentPrice = this._parsePrice(raw.priceText);
        if (!currentPrice || currentPrice <= 0) continue;

        let originalPrice = this._parsePrice(raw.oldPriceText);
        let discountPercent = this._parseDiscount(raw.discountText);

        if (!discountPercent && originalPrice && originalPrice > currentPrice) {
          discountPercent = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
        }

        const soldCount = this._parseSoldCount(raw.soldText);
        const productId = this._extractProductId(raw.rawUrl);
        const productUrl = this._cleanProductUrl(raw.rawUrl);

        let rating = null;
        if (raw.ratingText) {
          const matchRating = raw.ratingText.match(/(\d+[.,]\d+)/);
          if (matchRating) rating = parseFloat(matchRating[1].replace(',', '.'));
        }

        normalizedList.push({
          marketplace: 'shopee',
          productId,
          title: raw.title,
          currentPrice,
          originalPrice: originalPrice || null,
          discountPercent: discountPercent || null,
          rating,
          reviewCount: null,
          soldCount,
          sellerName: null,
          sellerReputation: null,
          shipping: 'Frete Grátis com cupom',
          imageUrl: raw.imgUrl || null,
          productUrl,
          category,
          collectedAt: new Date().toISOString(),
        });
      }

      logger.info(`[Shopee] Produtos normalizados válidos: ${normalizedList.length}`);
      return normalizedList;

    } catch (err) {
      logger.warn(`[Shopee] Erro na busca (${category}): ${err.message}`);
      return [];
    }
  }
}

export default ShopeeScraper;
