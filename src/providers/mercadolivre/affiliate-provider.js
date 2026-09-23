/**
 * ACHAki Autopilot — MercadoLivreAffiliateProvider
 *
 * Mecanismo Oficial de Afiliados Mercado Livre:
 *  - Utiliza a sessão autenticada do perfil persistente (data/browser-profile)
 *  - Acessa o gerador oficial da Central de Afiliados
 *  - Gera link comissionado real vinculado à conta oficial
 *  - Retorna link encurtado oficial (meli.la) ou link comissionado completo
 *  - affiliateVerified = true apenas quando obtido pelo mecanismo oficial
 */

import BrowserManager from '../../browser/browser.js';
import logger from '../../utils/logger.js';

export class MercadoLivreAffiliateProvider {
  /**
   * @param {object} [params]
   * @param {BrowserManager} [params.browserManager]
   */
  constructor({ browserManager } = {}) {
    this.externalBrowser = !!browserManager;
    this.browserManager = browserManager || null;
  }

  /**
   * Gera o link de afiliado oficial para um produto do Mercado Livre.
   *
   * @param {object} params
   * @param {string} params.productUrl - URL do produto
   * @param {string} [params.productId] - ID do produto (ex: MLB4817578135)
   * @returns {Promise<{
   *   marketplace: "mercadolivre",
   *   productUrl: string,
   *   affiliateUrl: string | null,
   *   shortUrl?: string,
   *   longUrl?: string,
   *   tag?: string,
   *   listUrl?: string,
   *   affiliateVerified: boolean,
   *   generatedAt: string,
   *   error?: string
   * }>}
   */
  async generateAffiliateLink({ productUrl, productId }) {
    if (!productUrl) {
      return {
        marketplace: 'mercadolivre',
        productUrl: '',
        affiliateUrl: null,
        affiliateVerified: false,
        generatedAt: new Date().toISOString(),
        error: 'URL do produto ausente.',
      };
    }

    const browser = this.browserManager || new BrowserManager();
    let ownBrowser = !this.externalBrowser;

    try {
      if (ownBrowser) {
        await browser.launch();
      }

      const page = await browser.openPage();

      logger.info(`[MLAffiliateProvider] Acessando gerador de links oficial para: ${productId || productUrl}`);
      await page.goto('https://www.mercadolivre.com.br/afiliados/linkbuilder#hub', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Aguarda 1.5s para hidratação do cliente
      await page.waitForTimeout(1500);

      // Método 1: Chamada direta ao endpoint interno autenticado pela sessão
      const apiResult = await page.evaluate(async (urlToConvert) => {
        try {
          const res = await fetch('/affiliate-program/api/v2/affiliates/createLink', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              urls: [urlToConvert],
              tag: 'techlinecia',
            }),
          });

          if (!res.ok) {
            return { ok: false, status: res.status };
          }

          const json = await res.json();
          return { ok: true, data: json };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }, productUrl);

      if (apiResult?.ok && apiResult.data?.urls?.[0]) {
        const item = apiResult.data.urls[0];
        const affiliateUrl = item.short_url || item.long_url;

        logger.info(`[MLAffiliateProvider] Link oficial gerado com sucesso: ${affiliateUrl}`);

        return {
          marketplace: 'mercadolivre',
          productUrl,
          affiliateUrl,
          shortUrl: item.short_url,
          longUrl: item.long_url,
          tag: item.tag || 'techlinecia',
          listUrl: item.list_url,
          affiliateVerified: true,
          generatedAt: new Date().toISOString(),
        };
      }

      // Método 2 (Fallback via DOM): Preenche o formulário e clica em Gerar
      logger.info('[MLAffiliateProvider] Tentando fallback via formulário web do gerador...');
      const textarea = await page.$('#url-0, textarea');
      if (textarea) {
        await textarea.fill(productUrl);
        await page.waitForTimeout(600);

        const generateBtn = await page.$('button:has-text("Gerar"), .andes-button:has-text("Gerar")');
        if (generateBtn) {
          await generateBtn.click();
          await page.waitForTimeout(3500);

          const domLink = await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input, textarea, a, p')).map(el => el.value || el.innerText || el.href || '');
            const found = inputs.find(t => t.includes('meli.la/') || (t.includes('mercadolivre.com.br/') && t.includes('matt_tool')));
            return found ? found.trim() : null;
          });

          if (domLink) {
            logger.info(`[MLAffiliateProvider] Link capturado via DOM: ${domLink}`);
            return {
              marketplace: 'mercadolivre',
              productUrl,
              affiliateUrl: domLink,
              affiliateVerified: true,
              generatedAt: new Date().toISOString(),
            };
          }
        }
      }

      return {
        marketplace: 'mercadolivre',
        productUrl,
        affiliateUrl: null,
        affiliateVerified: false,
        generatedAt: new Date().toISOString(),
        error: 'Mecanismo oficial não retornou link comissionado.',
      };

    } catch (err) {
      logger.error(`[MLAffiliateProvider] Erro ao gerar link oficial: ${err.message}`);
      return {
        marketplace: 'mercadolivre',
        productUrl,
        affiliateUrl: null,
        affiliateVerified: false,
        generatedAt: new Date().toISOString(),
        error: err.message,
      };
    } finally {
      if (ownBrowser) {
        await browser.close().catch(() => {});
      }
    }
  }
}

export default MercadoLivreAffiliateProvider;
