/**
 * ACHAki Autopilot — PriceValidationEngine
 *
 * Motor de Validação Semântica e Matemática de Preços em Tempo Real.
 *
 * Princípios Inegociáveis:
 * 1. NUNCA inventar ou estimar preços (proibida sintetização reversa matemática).
 * 2. Distinguir rigorosamente todas as camadas semânticas do marketplace:
 *    - current_price: Preço à vista/efetivo de compra atual
 *    - original_price: Preço riscado anterior (de referência)
 *    - pix_price: Preço específico para pagamento via Pix
 *    - installment_price: Valor de cada parcela
 *    - installment_count: Número de parcelas
 *    - cashback: Crédito retornado (ex: Meli Dólar)
 *    - coupon_price: Preço após aplicação de cupom
 *    - subscription_price: Preço exclusivo para assinantes (ex: Meli+)
 *    - unit_price: Preço por unidade em kits
 *    - variant_price: Preço da variante ativa selecionada
 *    - shipping: Condição de frete (Full, Grátis, Pago)
 *    - discount_percent: Desconto percentual explicitamente exibido
 * 3. NUNCA interpretar parcelas, preço unitário, cashback ou produtos relacionados como current_price.
 * 4. Validação matemática estrita:
 *    discount = (original_price - current_price) / original_price (tolerância máxima de arredondamento: ±2.5%).
 * 5. Se o desconto exibido for incompatível ou o produto estiver indisponível/pausado:
 *    rejeita com código PRICE_VALIDATION_FAILED ou PRODUCT_UNAVAILABLE.
 */

import logger from '../utils/logger.js';

export class PriceValidationEngine {
  /**
   * @param {object} [options]
   * @param {import('../browser/browser.js').default} [options.browserManager]
   */
  constructor({ browserManager } = {}) {
    this.browserManager = browserManager;
  }

  /**
   * Normaliza texto com valor monetário brasileiro para float.
   * Trata "102", "102 , 80", "1.138,90", "R$ 45,00", etc.
   *
   * @param {string|number} raw
   * @returns {number|null}
   */
  parseMoneyValue(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') {
      return isNaN(raw) || raw <= 0 ? null : Number(raw.toFixed(2));
    }
    const cleanStr = String(raw).replace(/\s+/g, ' ').trim();
    // Procura padrão de moeda R$ ... ou apenas números com separador decimal
    const match = cleanStr.match(/(?:R\$\s*)?([\d.]+)(?:\s*[,.]\s*(\d{1,2}))?/i);
    if (!match) return null;

    const intPart = match[1].replace(/\./g, '');
    const centPart = match[2] ? match[2].padEnd(2, '0').slice(0, 2) : '00';
    const num = parseFloat(`${intPart}.${centPart}`);
    return isNaN(num) || num <= 0 ? null : Number(num.toFixed(2));
  }

  /**
   * Valida matematicamente a consistência do desconto exibido vs calculado.
   *
   * @param {object} params
   * @param {number} params.currentPrice
   * @param {number|null} params.originalPrice
   * @param {number|null} params.displayedDiscountPercent
   * @param {number} [params.tolerancePercent=2.5]
   * @returns {{
   *   isMathValid: boolean,
   *   calculatedDiscount: number|null,
   *   discountDiscrepancy: number|null,
   *   error?: string
   * }}
   */
  validatePriceMath({ currentPrice, originalPrice, displayedDiscountPercent, tolerancePercent = 2.5 }) {
    if (!currentPrice || currentPrice <= 0) {
      return {
        isMathValid: false,
        calculatedDiscount: null,
        discountDiscrepancy: null,
        error: 'Preço atual inválido ou não positivo.',
      };
    }

    // Se não há preço original informado pelo marketplace
    if (!originalPrice) {
      // Se não há preço original, mas há uma tag de desconto alegando desconto falso
      if (displayedDiscountPercent && displayedDiscountPercent > 0) {
        return {
          isMathValid: false,
          calculatedDiscount: null,
          discountDiscrepancy: displayedDiscountPercent,
          error: `Tag exibe ${displayedDiscountPercent}% OFF porém não existe preço anterior oficial comprovado.`,
        };
      }
      return {
        isMathValid: true,
        calculatedDiscount: null,
        discountDiscrepancy: 0,
      };
    }

    // Preço original deve ser estritamente maior que o preço atual
    if (originalPrice <= currentPrice) {
      return {
        isMathValid: false,
        calculatedDiscount: 0,
        discountDiscrepancy: displayedDiscountPercent || 0,
        error: `Preço original (R$ ${originalPrice}) menor ou igual ao preço atual (R$ ${currentPrice}).`,
      };
    }

    const calculatedDiscount = Number((((originalPrice - currentPrice) / originalPrice) * 100).toFixed(2));
    const roundedCalculated = Math.round(calculatedDiscount);

    if (displayedDiscountPercent !== null && displayedDiscountPercent !== undefined && displayedDiscountPercent > 0) {
      const discrepancy = Number(Math.abs(calculatedDiscount - displayedDiscountPercent).toFixed(2));
      if (discrepancy > tolerancePercent) {
        return {
          isMathValid: false,
          calculatedDiscount: roundedCalculated,
          discountDiscrepancy: discrepancy,
          error: `Desconto exibido (${displayedDiscountPercent}%) diverge do cálculo real (${roundedCalculated}%) além da tolerância permitida (±${tolerancePercent}%).`,
        };
      }
      return {
        isMathValid: true,
        calculatedDiscount: roundedCalculated,
        discountDiscrepancy: discrepancy,
      };
    }

    return {
      isMathValid: true,
      calculatedDiscount: roundedCalculated,
      discountDiscrepancy: 0,
    };
  }

  /**
   * Extrai com segurança todos os componentes semânticos de preço e disponibilidade do DOM da PDP.
   * Executa dentro do contexto do Playwright (page.evaluate).
   *
   * @param {import('playwright').Page} page
   * @returns {Promise<object>}
   */
  async extractSemanticPriceFromPage(page) {
    return await page.evaluate(() => {
      // 1. Título do Produto
      const titleEl = document.querySelector('h1.ui-pdp-title, h1');
      const title = titleEl ? titleEl.innerText.trim() : document.title;

      // 1.1 Detecção de Checkpoint de Segurança / Bloqueio / Account Verification
      if (
        window.location.href.includes('account-verification') ||
        title.includes('Por segurança') ||
        title.includes('complete esta etapa') ||
        document.title.includes('complete esta etapa') ||
        document.title.includes('Mercado Libre') && window.location.href.includes('/gz/')
      ) {
        return {
          title,
          isAvailable: false,
          isSecurityChallenge: true,
          error: 'SECURITY_CHALLENGE',
        };
      }

      // 2. Imagem Principal
      const imgEl = document.querySelector('.ui-pdp-gallery__figure img, img.ui-pdp-image, [data-zoom] img, img');
      const imageUrl = imgEl ? (imgEl.src || imgEl.getAttribute('data-zoom') || imgEl.getAttribute('src')) : null;

      // 3. Verificação Rigorosa de Disponibilidade e Estoque
      const bodyText = document.body.innerText || '';
      const unavailablePatterns = [
        'este produto está indisponível',
        'publicação pausada',
        'anúncio pausado',
        'produto finalizado',
        'sem estoque',
        'por favor, escolha outra variação',
        'escolha outra variação'
      ];
      const lowerBody = bodyText.toLowerCase();
      let isUnavailable = unavailablePatterns.some((pattern) => lowerBody.includes(pattern));

      if (document.querySelector('.ui-pdp-stock-information--out-of-stock')) {
        isUnavailable = true;
      }

      // 4. Localização do Contêiner Principal de Compra / Preço
      // Evita contêineres de carrossel ("poly-price", "promotions-carousel", "ui-recommendations")
      const priceContainer = document.querySelector(
        '.ui-pdp-price, .ui-pdp-price__main-container, [data-testid="price-block"], .ui-pdp-container__row--price'
      );

      if (!priceContainer) {
        return {
          title,
          imageUrl,
          isAvailable: !isUnavailable,
          error: 'PRICE_CONTAINER_NOT_FOUND',
        };
      }

      // Função auxiliar de extração de andes-money-amount
      function parseMoneyNode(node) {
        if (!node) return null;
        // Prioridade 1: meta[itemprop="price"]
        const metaPrice = node.querySelector('meta[itemprop="price"]')?.getAttribute('content');
        if (metaPrice) {
          const val = parseFloat(metaPrice);
          if (!isNaN(val) && val > 0) return Number(val.toFixed(2));
        }

        // Prioridade 2: aria-label (ex: "102 reais com 80 centavos")
        const aria = node.getAttribute('aria-label') || '';
        const ariaMatch = aria.match(/(\d+)\s*reais(?:\s*com\s*(\d+)\s*centavos)?/i);
        if (ariaMatch) {
          const intPart = parseInt(ariaMatch[1], 10);
          const centPart = ariaMatch[2] ? parseInt(ariaMatch[2], 10) : 0;
          return Number(`${intPart}.${centPart.toString().padStart(2, '0')}`);
        }

        // Prioridade 3: fração e centavos explícitos
        const fractionEl = node.querySelector('.andes-money-amount__fraction');
        const centsEl = node.querySelector('.andes-money-amount__cents');
        if (fractionEl) {
          const fractionStr = fractionEl.innerText.replace(/[^\d]/g, '');
          const centsStr = centsEl ? centsEl.innerText.replace(/[^\d]/g, '') : '00';
          if (fractionStr) {
            return parseFloat(`${fractionStr}.${centsStr.padEnd(2, '0').slice(0, 2)}`);
          }
        }
        return null;
      }

      // Extração Preço Original (<s>, .andes-money-amount--previous, .ui-pdp-price__original-value)
      const origEl = priceContainer.querySelector(
        '.ui-pdp-price__original-value, .andes-money-amount--previous, s.andes-money-amount, s .andes-money-amount'
      );
      const originalPrice = parseMoneyNode(origEl);

      // Extração Preço Atual Oficial de Compra
      // Deve estar dentro da linha principal (.ui-pdp-price__second-line ou itemprop="offers")
      let currentPriceEl = priceContainer.querySelector(
        '.ui-pdp-price__second-line .andes-money-amount[itemprop="offers"], ' +
        '.ui-pdp-price__second-line .andes-money-amount--weight-semibold, ' +
        '.ui-pdp-price__second-line .andes-money-amount'
      );

      if (!currentPriceEl) {
        // Fallback restrito: pega o primeiro andes-money-amount que NÃO seja tachado (<s> ou --previous)
        const allMoney = Array.from(priceContainer.querySelectorAll('.andes-money-amount'));
        currentPriceEl = allMoney.find(
          (m) => !m.classList.contains('andes-money-amount--previous') && !m.closest('s') && !m.closest('.ui-pdp-price__tags')
        );
      }
      const currentPrice = parseMoneyNode(currentPriceEl);

      // Desconto percentual explicitamente exibido
      let discountPercent = null;
      const discountEl = priceContainer.querySelector(
        '.andes-money-amount__discount, .ui-pdp-price__discount, [class*="discount"]'
      );
      if (discountEl) {
        const discMatch = discountEl.innerText.match(/(\d+)%/);
        if (discMatch) {
          discountPercent = parseInt(discMatch[1], 10);
        }
      }

      // Preço Pix (quando a página destaca preço promocional para Pix)
      let pixPrice = null;
      const breakdownEl = priceContainer.querySelector(
        '.ui-pdp-price-breakdown, .ui-pdp-price-breakdown__trigger-label'
      );
      if (breakdownEl && /pix/i.test(breakdownEl.innerText)) {
        pixPrice = currentPrice;
      }

      // Subtítulos e Parcelas
      const subtitlesEl = priceContainer.querySelector('.ui-pdp-price__subtitles');
      const subtitlesText = subtitlesEl ? subtitlesEl.innerText.replace(/\s+/g, ' ').trim() : '';

      // Parcelamento
      let installmentPrice = null;
      let installmentCount = null;
      const instMatch = subtitlesText.match(/(\d+)x\s*(?:de\s*)?R\$\s*([\d.]+)(?:\s*[,.]\s*(\d{1,2}))?/i) ||
                        bodyText.match(/(\d+)x\s*(?:de\s*)?R\$\s*([\d.]+)(?:\s*[,.]\s*(\d{1,2}))?\s*sem juros/i);
      if (instMatch) {
        installmentCount = parseInt(instMatch[1], 10);
        const intP = instMatch[2].replace(/\./g, '');
        const centP = instMatch[3] ? instMatch[3].padEnd(2, '0').slice(0, 2) : '00';
        installmentPrice = parseFloat(`${intP}.${centP}`);
      }

      // Preço por unidade (ex: "Preço por unidade: R$ 2,49")
      let unitPrice = null;
      const unitMatch = subtitlesText.match(/Preço por unidade:\s*R\$\s*([\d.]+)(?:\s*[,.]\s*(\d{1,2}))?/i);
      if (unitMatch) {
        const intP = unitMatch[1].replace(/\./g, '');
        const centP = unitMatch[2] ? unitMatch[2].padEnd(2, '0').slice(0, 2) : '00';
        unitPrice = parseFloat(`${intP}.${centP}`);
      }

      // Cashback (ex: "R$ 0,57 de cashback" ou "0,57 de cashback")
      let cashback = null;
      const tagText = priceContainer.querySelector('.ui-pdp-price__tags')?.innerText || '';
      const cashMatch = tagText.match(/(?:R\$\s*)?([\d.]+)(?:\s*[,.]\s*(\d{1,2}))?\s*de cashback/i);
      if (cashMatch) {
        const intP = cashMatch[1].replace(/\./g, '');
        const centP = cashMatch[2] ? cashMatch[2].padEnd(2, '0').slice(0, 2) : '00';
        cashback = parseFloat(`${intP}.${centP}`);
      }

      // Assinatura / Meli+
      let subscriptionPrice = null;
      if (tagText.includes('Meli+') || tagText.includes('assinante')) {
        const subMoney = priceContainer.querySelector('.ui-pdp-price__tags .andes-money-amount');
        if (subMoney) {
          subscriptionPrice = parseMoneyNode(subMoney);
        }
      }

      // Frete
      let shipping = null;
      if (bodyText.includes('Chegará grátis') || bodyText.includes('Frete grátis')) {
        shipping = 'Frete Grátis';
      }
      if (bodyText.includes('FULL') || document.querySelector('.ui-pdp-icon--full')) {
        shipping = shipping ? 'Full + Frete Grátis' : 'Full';
      }

      // Variantes
      const variantContainers = document.querySelectorAll('.ui-pdp-variations, [data-testid="variations"]');
      const hasVariations = variantContainers.length > 0;
      let selectedVariant = null;
      const selectedVariantEl = document.querySelector('.ui-pdp-variations__selected-label, .ui-pdp-variations__picker-default');
      if (selectedVariantEl) {
        selectedVariant = selectedVariantEl.innerText.replace(/\s+/g, ' ').trim();
      }

      // Identificador de produto do marketplace extraído do DOM
      let marketplaceProductId = null;
      const canonicalLink = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
      const idMatch = (canonicalLink || window.location.href).match(/(MLB-?\d+|MLBU\d+)/i);
      if (idMatch) {
        marketplaceProductId = idMatch[1].replace('-', '');
      }

      return {
        marketplaceProductId,
        title,
        imageUrl,
        isAvailable: !isUnavailable,
        currentPrice,
        originalPrice,
        pixPrice,
        installmentPrice,
        installmentCount,
        unitPrice,
        cashback,
        subscriptionPrice,
        discountPercent,
        shipping,
        hasVariations,
        selectedVariant,
        canonicalUrl: canonicalLink || window.location.href,
        rawSubtitles: subtitlesText,
      };
    });
  }

  /**
   * Executa a auditoria completa de uma página real de produto.
   * Abre a URL (ou usa página já ativa), extrai o DOM semântico e valida matematicamente.
   *
   * @param {object} params
   * @param {string} params.url
   * @param {number} [params.expectedPrice]
   * @param {number} [params.expectedOriginalPrice]
   * @param {number} [params.expectedDiscount]
   * @param {import('playwright').Page} [params.page]
   * @returns {Promise<{
   *   isValid: boolean,
   *   validationCode: 'OK' | 'PRICE_VALIDATION_FAILED' | 'PRODUCT_UNAVAILABLE' | 'PRICE_CHANGED' | 'DOM_PARSE_ERROR',
   *   reason?: string,
   *   data?: object
   * }>}
   */
  async validateProductPage({ url, expectedPrice, expectedOriginalPrice, expectedDiscount, page: providedPage } = {}) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return {
        isValid: false,
        validationCode: 'PRICE_VALIDATION_FAILED',
        reason: `URL inválida para validação: "${url}"`,
      };
    }

    let activePage = providedPage;
    let shouldClosePage = false;

    try {
      if (!activePage) {
        if (!this.browserManager) {
          throw new Error('BrowserManager não configurado para PriceValidationEngine');
        }
        activePage = await this.browserManager.openPage();
        shouldClosePage = false; // Reutiliza sessão persistente gerenciada pelo worker
      }

      logger.info(`[PriceValidationEngine] Acessando PDP real: ${url}`);
      await activePage.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 35_000,
      });

      // Aguarda renderização dos componentes dinâmicos do buybox
      await activePage.waitForTimeout(2000);

      // Extrai semântica
      const rawPdp = await this.extractSemanticPriceFromPage(activePage);

      return this._evaluateParsedPdp(rawPdp, { expectedPrice });
    } catch (err) {
      logger.error(`[PriceValidationEngine] Erro ao validar PDP: ${err.message}`);
      return {
        isValid: false,
        validationCode: 'DOM_PARSE_ERROR',
        reason: `Exceção durante validação: ${err.message}`,
      };
    }
  }

  /**
   * Validação de Preço Multi-Source com Consenso de Confiança (Fase 6).
   *
   * Hierarquia de Fontes:
   * A) API Oficial (quando disponível)
   * B) Dados estruturados registrados recentemente (Supabase / Memória)
   * C) Página/listagem/vitrine real já acessível pelo browser (ex: /ofertas poly-cards)
   * D) PDP real, somente quando acessível normalmente (SEM contorno de CAPTCHA)
   *
   * Níveis de Confiança:
   * - HIGH: 2 fontes recentes e compatíveis (diferença <= 2.5%)
   * - MEDIUM: 1 fonte real, recente e inequivocamente associada ao product_id
   * - LOW: preço ambíguo, divergente ou não confirmável (não publicável)
   *
   * @param {object} candidate - Candidato vindo da pesquisa/coleta
   * @param {object} [options]
   * @param {import('playwright').Page} [options.page]
   * @param {object} [options.supabase]
   * @param {number} [options.expectedPrice]
   * @returns {Promise<{
   *   isValid: boolean,
   *   confidence: 'HIGH' | 'MEDIUM' | 'LOW',
   *   validationCode: 'OK' | 'PRICE_CHANGED' | 'PRICE_VALIDATION_FAILED' | 'PRODUCT_UNAVAILABLE' | 'LOW_CONFIDENCE',
   *   reason: string,
   *   data: object
   * }>}
   */
  async validateCandidatePrice(candidate, { page: providedPage, supabase, expectedPrice } = {}) {
    if (!candidate) {
      return {
        isValid: false,
        confidence: 'LOW',
        validationCode: 'PRICE_VALIDATION_FAILED',
        reason: 'Candidato nulo ou inválido.',
      };
    }

    const productId = candidate.productId || candidate.marketplace_product_id || candidate.dbId || 'UNKNOWN';
    const sources = [];
    const sourceStatuses = {};
    let pdpNote = null;

    logger.info(`[PriceValidationEngine] 🛡️ Iniciando validação multi-source para #${productId} ("${candidate.title?.slice(0, 45)}")...`);

    // FONTE A: API Oficial (quando endpoint estiver disponível)
    sourceStatuses.official_api = 'SOURCE_UNAVAILABLE';

    // FONTE B: Dados estruturados obtidos legitimamente (Supabase)
    if (supabase) {
      try {
        const queryId = candidate.dbId || candidate.id;
        if (queryId) {
          const { data: priceRows } = await supabase
            .from('product_prices')
            .select('current_price, original_price, discount_percent, collected_at')
            .eq('product_id', queryId)
            .order('collected_at', { ascending: false })
            .limit(1);

          if (priceRows && priceRows.length > 0) {
            const row = priceRows[0];
            const pVal = this.parseMoneyValue(row.current_price);
            if (pVal && pVal > 0) {
              const diffHours = (Date.now() - new Date(row.collected_at).getTime()) / (1000 * 60 * 60);
              if (diffHours <= 24) {
                sources.push({
                  value: pVal,
                  original_value: this.parseMoneyValue(row.original_price),
                  discount: row.discount_percent ? Number(row.discount_percent) : null,
                  source: 'STRUCTURED_DATA',
                  captured_at: row.collected_at,
                  confidence: 'MEDIUM',
                  product_id: productId,
                });
                sourceStatuses.structured_data = 'AVAILABLE';
              }
            }
          }
        }
      } catch (err) {
        logger.debug(`[PriceValidationEngine] Fonte B (Supabase) indisponível: ${err.message}`);
      }
    }

    // FONTE C: Página / Vitrine / Listagem Real acessível pelo browser
    // Só é fonte independente se foi realmente coletada ao vivo no marketplace (não importada do próprio banco)
    const isLiveScrape = Boolean(candidate.isLiveScrape || candidate.source === 'live_scrape' || (!candidate.isCatalogCandidate && !candidate.fromDatabase && candidate.marketplace));
    const candidatePrice = this.parseMoneyValue(candidate.currentPrice);
    if (isLiveScrape && candidatePrice && candidatePrice > 0) {
      const origPrice = this.parseMoneyValue(candidate.originalPrice);
      const discPercent = candidate.discountPercent ? Number(candidate.discountPercent) : null;

      const mathCheck = this.validatePriceMath({
        currentPrice: candidatePrice,
        originalPrice: origPrice,
        displayedDiscountPercent: discPercent,
      });

      if (mathCheck.isMathValid) {
        sources.push({
          value: candidatePrice,
          original_value: origPrice,
          discount: mathCheck.calculatedDiscount ?? discPercent,
          source: 'STOREFRONT_LISTING',
          captured_at: candidate.collectedAt || new Date().toISOString(),
          confidence: 'MEDIUM',
          product_id: productId,
        });
        sourceStatuses.storefront_listing = 'AVAILABLE';
      } else {
        logger.warn(`[PriceValidationEngine] Fonte C (Vitrine) descartada por inconsistência matemática: ${mathCheck.error}`);
        sourceStatuses.storefront_listing = 'MATH_INVALID';
      }
    }

    // FONTE D: PDP Real (somente quando acessível normalmente - SEM BYPASS DE CAPTCHA)
    if (candidate.productUrl && typeof candidate.productUrl === 'string' && candidate.productUrl.startsWith('http')) {
      let activePage = providedPage;

      try {
        if (!activePage && this.browserManager) {
          activePage = await this.browserManager.openPage();
        }

        if (activePage) {
          logger.info(`[PriceValidationEngine] Tentando acesso legítimo à PDP: ${candidate.productUrl}`);
          await activePage.goto(candidate.productUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 15_000,
          });

          await activePage.waitForTimeout(1500);

          const rawPdp = await this.extractSemanticPriceFromPage(activePage);

          if (rawPdp.isSecurityChallenge || rawPdp.error === 'SECURITY_CHALLENGE') {
            logger.info('[PriceValidationEngine] ⚠️ PDP com desafio de segurança (CAPTCHA). SOURCE_UNAVAILABLE.');
            sourceStatuses.pdp = 'SOURCE_UNAVAILABLE';
            pdpNote = 'PDP indisponível por checkpoint; validação realizada por fonte alternativa.';
          } else if (!rawPdp.isAvailable) {
            sourceStatuses.pdp = 'PRODUCT_UNAVAILABLE';
            logger.warn(`[PriceValidationEngine] PDP acusa produto esgotado/pausado: "${rawPdp.title}"`);
            return {
              isValid: false,
              confidence: 'LOW',
              validationCode: 'PRODUCT_UNAVAILABLE',
              reason: 'Produto esgotado ou anúncio pausado na página oficial do vendedor.',
              data: { product_id: productId, title: candidate.title },
            };
          } else if (rawPdp.currentPrice && rawPdp.currentPrice > 0) {
            const mathPdp = this.validatePriceMath({
              currentPrice: rawPdp.currentPrice,
              originalPrice: rawPdp.originalPrice,
              displayedDiscountPercent: rawPdp.discountPercent,
            });

            if (mathPdp.isMathValid) {
              sources.push({
                value: rawPdp.currentPrice,
                original_value: rawPdp.originalPrice || null,
                discount: mathPdp.calculatedDiscount ?? rawPdp.discountPercent,
                source: 'PRODUCT_PAGE',
                captured_at: new Date().toISOString(),
                confidence: 'HIGH',
                product_id: productId,
              });
              sourceStatuses.pdp = 'AVAILABLE';
            }
          }
        }
      } catch (err) {
        logger.info(`[PriceValidationEngine] PDP inacessível (${err.message}). Marcada como SOURCE_UNAVAILABLE.`);
        sourceStatuses.pdp = 'SOURCE_UNAVAILABLE';
        pdpNote = pdpNote || `PDP indisponível (${err.message}); validação realizada por fonte alternativa.`;
      }
    }

    // REGRA DE SEGURANÇA MÁXIMA DE PREÇO:
    // Pelo menos UMA fonte AO VIVO (PRODUCT_PAGE ou STOREFRONT_LISTING ao vivo) deve estar presente.
    // É terminantemente proibido validar preço comparando dados em cache com eles mesmos.
    const hasLiveSource = sources.some(s => s.source === 'PRODUCT_PAGE' || (s.source === 'STOREFRONT_LISTING' && isLiveScrape));

    if (!hasLiveSource) {
      logger.warn(`[PriceValidationEngine] 🛑 Preço de #${productId} não pôde ser verificado ao vivo (sem acesso à PDP e sem vitrine recente). Validação REJEITADA por segurança.`);
      return {
        isValid: false,
        confidence: 'LOW',
        consensus: 'LOW',
        validationCode: 'LIVE_PRICE_UNVERIFIABLE',
        reason: 'Preço em tempo real não pôde ser confirmado no marketplace (PDP indisponível e sem fonte ao vivo). Publicação bloqueada para evitar divergência de preço.',
        data: { product_id: productId, title: candidate.title, sources },
      };
    }

    // CONSENSO DE PREÇO
    if (sources.length === 0) {
      return {
        isValid: false,
        confidence: 'LOW',
        validationCode: 'PRICE_VALIDATION_FAILED',
        reason: 'Nenhuma fonte confiável confirmou o preço do produto.',
        data: { product_id: productId, title: candidate.title },
      };
    }

    const priorityOrder = ['PRODUCT_PAGE', 'STOREFRONT_LISTING', 'STRUCTURED_DATA', 'OFFICIAL_API'];
    sources.sort((a, b) => priorityOrder.indexOf(a.source) - priorityOrder.indexOf(b.source));
    const primary = sources[0];

    let overallConfidence = 'MEDIUM';

    if (sources.length >= 2) {
      const prices = sources.map(s => s.value);
      const minP = Math.min(...prices);
      const maxP = Math.max(...prices);
      const diffPercent = ((maxP - minP) / minP) * 100;

      if (diffPercent <= 2.5) {
        overallConfidence = 'HIGH';
      } else {
        overallConfidence = 'LOW';
        const sourceDetails = sources.map(s => `${s.source}: R$ ${s.value}`).join(' vs ');
        logger.warn(`[PriceValidationEngine] Divergência entre fontes detectada para #${productId}: ${sourceDetails}`);
        return {
          isValid: false,
          confidence: 'LOW',
          consensus: 'LOW',
          validationCode: 'PRICE_VALIDATION_FAILED',
          reason: `Divergência de preços detectada entre fontes disponíveis (${sourceDetails}).`,
          data: { product_id: productId, sources },
        };
      }
    } else {
      overallConfidence = 'MEDIUM';
    }

    const expected = expectedPrice || candidate.currentPrice;
    let priceChanged = false;
    let priceDifference = 0;
    if (expected && expected > 0) {
      priceDifference = Number((primary.value - expected).toFixed(2));
      if (Math.abs(priceDifference) > 0.05) {
        priceChanged = true;
      }
    }

    const validatedResultData = {
      value: primary.value,
      original_value: primary.original_value,
      discount: primary.discount,
      source: primary.source,
      captured_at: primary.captured_at,
      confidence: overallConfidence,
      product_id: productId,
      currentPrice: primary.value,
      originalPrice: primary.original_value,
      discountPercent: primary.discount || 0,
      title: candidate.title,
      imageUrl: candidate.imageUrl,
      productUrl: candidate.productUrl,
      marketplaceProductId: productId,
      shipping: candidate.shipping,
      category: candidate.category,
      pdpNote,
      isPriceChanged: priceChanged,
      priceDifference,
      consensus: {
        confidence: overallConfidence,
        sourcesCount: sources.length,
        sources: sources.map(s => s.source),
        pdpStatus: sourceStatuses.pdp || 'NOT_CHECKED',
        note: pdpNote || (overallConfidence === 'HIGH' ? 'Consenso confirmado por múltiplas fontes.' : 'Validado com fonte real e inequívoca.'),
      },
      validatedAt: new Date().toISOString(),
    };

    if (pdpNote) {
      logger.info(`[PriceValidationEngine] ℹ️ ${pdpNote}`);
    }

    const origStr = primary.original_value ? ` (de R$ ${primary.original_value.toFixed(2)})` : '';
    logger.info(
      `[PriceValidationEngine] ✓ Preço validado via Consenso [${overallConfidence}]: ` +
      `R$ ${primary.value.toFixed(2)}${origStr} ` +
      `[Fonte: ${primary.source}, Fontes válidas: ${sources.length}]`
    );

    return {
      isValid: true,
      confidence: overallConfidence,
      consensus: overallConfidence,
      validationCode: priceChanged ? 'PRICE_CHANGED' : 'OK',
      reason: pdpNote || `Preço validado por consenso [${overallConfidence}].`,
      data: validatedResultData,
    };
  }

  /**
   * Valida semântica e matemática de uma página a partir de HTML completo no browser.
   *
   * @param {object} params
   * @param {string} params.html
   * @param {string} [params.url]
   * @param {number} [params.expectedPrice]
   * @param {import('playwright').Page} [params.page]
   * @returns {Promise<object>}
   */
  async validateProductHtml({ html, url = 'https://produto.mercadolivre.com.br/MLB-VALIDATION', expectedPrice, page: providedPage } = {}) {
    let activePage = providedPage;
    let shouldClose = false;

    try {
      if (!activePage) {
        if (!this.browserManager) {
          throw new Error('BrowserManager não configurado para PriceValidationEngine');
        }
        activePage = await this.browserManager.openPage();
      }

      await activePage.setContent(html, { waitUntil: 'domcontentloaded' });
      const rawPdp = await this.extractSemanticPriceFromPage(activePage);
      return this._evaluateParsedPdp(rawPdp, { expectedPrice });
    } catch (err) {
      logger.error(`[PriceValidationEngine] Erro ao validar HTML: ${err.message}`);
      return {
        isValid: false,
        validationCode: 'DOM_PARSE_ERROR',
        reason: `Exceção ao validar HTML: ${err.message}`,
      };
    }
  }

  /**
   * Avalia os dados brutos extraídos do DOM e aplica validações semânticas e matemáticas.
   *
   * @private
   * @param {object} rawPdp
   * @param {object} options
   * @param {number} [options.expectedPrice]
   * @returns {object}
   */
  _evaluateParsedPdp(rawPdp, { expectedPrice } = {}) {
    // 0. Checagem de checkpoint de segurança / CAPTCHA
    if (rawPdp.error === 'SECURITY_CHALLENGE' || rawPdp.isSecurityChallenge) {
      logger.warn(`[PriceValidationEngine] Checkpoint de segurança (CAPTCHA) detectado na PDP: "${rawPdp.title}"`);
      return {
        isValid: false,
        validationCode: 'SECURITY_CHALLENGE',
        reason: 'Página bloqueada por verificação de segurança (CAPTCHA) do marketplace.',
        data: rawPdp,
      };
    }

    // 1. Checagem de disponibilidade
    if (!rawPdp.isAvailable) {
      logger.warn(`[PriceValidationEngine] Produto indisponível/pausado: "${rawPdp.title}"`);
      return {
        isValid: false,
        validationCode: 'PRODUCT_UNAVAILABLE',
        reason: 'Produto pausado, finalizado ou sem estoque no marketplace.',
        data: rawPdp,
      };
    }

    // 2. Checagem de erro estrutural de contêiner
    if (rawPdp.error === 'PRICE_CONTAINER_NOT_FOUND' || !rawPdp.currentPrice) {
      logger.warn(`[PriceValidationEngine] Falha ao extrair contêiner de preço: "${rawPdp.title}"`);
      return {
        isValid: false,
        validationCode: 'DOM_PARSE_ERROR',
        reason: 'Não foi possível confirmar o preço no bloco oficial de compra do marketplace.',
        data: rawPdp,
      };
    }

    // 3. Validação Matemática Estrita
    const mathValidation = this.validatePriceMath({
      currentPrice: rawPdp.currentPrice,
      originalPrice: rawPdp.originalPrice,
      displayedDiscountPercent: rawPdp.discountPercent,
    });

    if (!mathValidation.isMathValid) {
      logger.warn(`[PriceValidationEngine] Validação matemática falhou: ${mathValidation.error}`);
      return {
        isValid: false,
        validationCode: 'PRICE_VALIDATION_FAILED',
        reason: mathValidation.error,
        data: {
          ...rawPdp,
          mathValidation,
        },
      };
    }

    // 4. Checagem de Divergência com Preço Esperado (se fornecido)
    let priceChanged = false;
    let priceDifference = 0;
    if (expectedPrice && expectedPrice > 0) {
      priceDifference = Number((rawPdp.currentPrice - expectedPrice).toFixed(2));
      if (Math.abs(priceDifference) > 0.05) {
        priceChanged = true;
      }
    }

    const consolidatedData = {
      marketplaceProductId: rawPdp.marketplaceProductId,
      title: rawPdp.title,
      currentPrice: rawPdp.currentPrice,
      originalPrice: rawPdp.originalPrice,
      pixPrice: rawPdp.pixPrice,
      installmentPrice: rawPdp.installmentPrice,
      installmentCount: rawPdp.installmentCount,
      unitPrice: rawPdp.unitPrice,
      cashback: rawPdp.cashback,
      subscriptionPrice: rawPdp.subscriptionPrice,
      discountPercent: mathValidation.calculatedDiscount || rawPdp.discountPercent || null,
      shipping: rawPdp.shipping,
      hasVariations: rawPdp.hasVariations,
      selectedVariant: rawPdp.selectedVariant,
      imageUrl: rawPdp.imageUrl,
      canonicalUrl: rawPdp.canonicalUrl,
      isPriceChanged: priceChanged,
      priceDifference,
      validatedAt: new Date().toISOString(),
    };

    if (priceChanged) {
      logger.info(
        `[PriceValidationEngine] Preço alterado: esperado R$ ${expectedPrice} -> real R$ ${rawPdp.currentPrice} (diff: R$ ${priceDifference})`
      );
      return {
        isValid: true,
        validationCode: 'PRICE_CHANGED',
        reason: `Preço divergiu de R$ ${expectedPrice} para R$ ${rawPdp.currentPrice}`,
        data: consolidatedData,
      };
    }

    return {
      isValid: true,
      validationCode: 'OK',
      data: consolidatedData,
    };
  }

  /**
   * Avalia se uma oferta cujo preço mudou continua comercialmente interessante.
   * Regra Autônoma:
   *  - Se o preço subiu mais de 25%: perde atratividade.
   *  - Se o desconto caiu abaixo de 10% (quando a estratégia era baseada em desconto): perde atratividade.
   *  - Se o novo preço for menor ou igual: ainda mais atraente!
   *  - Se mantiver boa margem de atratividade: autoriza publicação com novos valores atualizados.
   *
   * @param {object} params
   * @param {object} params.originalOffer
   * @param {object} params.validatedData
   * @returns {{
   *   isAttractive: boolean,
   *   action: 'CONTINUE_WITH_UPDATE' | 'DISCARD_AND_PICK_NEXT',
   *   reason: string,
   *   updatedOffer?: object
   * }}
   */
  evaluateOfferRelevanceAfterPriceChange({ originalOffer, validatedData }) {
    const oldPrice = Number(originalOffer.currentPrice);
    const newPrice = Number(validatedData.currentPrice);

    if (!newPrice || newPrice <= 0) {
      return {
        isAttractive: false,
        action: 'DISCARD_AND_PICK_NEXT',
        reason: 'Novo preço inválido ou zerado.',
      };
    }

    // Se o preço baixou: excelente notícia
    if (newPrice < oldPrice) {
      return {
        isAttractive: true,
        action: 'CONTINUE_WITH_UPDATE',
        reason: `Preço baixou de R$ ${oldPrice.toFixed(2)} para R$ ${newPrice.toFixed(2)}. Oferta ainda mais atraente.`,
        updatedOffer: {
          ...originalOffer,
          currentPrice: newPrice,
          originalPrice: validatedData.originalPrice || originalOffer.originalPrice,
          discountPercent: validatedData.discountPercent || originalOffer.discountPercent,
        },
      };
    }

    // Se o preço subiu:
    const increasePercent = ((newPrice - oldPrice) / oldPrice) * 100;
    if (increasePercent > 25) {
      return {
        isAttractive: false,
        action: 'DISCARD_AND_PICK_NEXT',
        reason: `Preço aumentou ${increasePercent.toFixed(1)}% (de R$ ${oldPrice.toFixed(2)} para R$ ${newPrice.toFixed(2)}). Oferta perdeu atratividade.`,
      };
    }

    // Se a estratégia era DESCONTO e o novo desconto ficou menor que 10%
    const currentDiscount = validatedData.discountPercent || 0;
    if (originalOffer.strategy?.code === 'DESCONTO' && currentDiscount < 10) {
      return {
        isAttractive: false,
        action: 'DISCARD_AND_PICK_NEXT',
        reason: `Desconto residual (${currentDiscount}%) insuficiente para estratégia de desconto comprovado.`,
      };
    }

    return {
      isAttractive: true,
      action: 'CONTINUE_WITH_UPDATE',
      reason: `Preço sofreu variação aceitável (+${increasePercent.toFixed(1)}%). Oferta permanece comercialmente viável.`,
      updatedOffer: {
        ...originalOffer,
        currentPrice: newPrice,
        originalPrice: validatedData.originalPrice || originalOffer.originalPrice,
        discountPercent: validatedData.discountPercent || originalOffer.discountPercent,
      },
    };
  }
}

export default PriceValidationEngine;
