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
import interventionManager from '../../services/intervention-manager.js';
import { supabase } from '../../database/supabase.js';

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
    const needLaunch = !browser.context;

    try {
      if (needLaunch) {
        await browser.launch();
      }

      const page = await browser.openPage();

      logger.info(`[MLAffiliateProvider] Acessando gerador de links oficial para: ${productId || productUrl}`);
      await page.goto('https://www.mercadolivre.com.br/afiliados/linkbuilder#hub', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      const currentUrl = page.url();
      if (currentUrl.includes('login') || currentUrl.includes('checkpoint') || currentUrl.includes('challenge')) {
        logger.warn(`[MLAffiliateProvider] Desafio/Login detectado ao acessar gerador: ${currentUrl}`);
        const intervention = await interventionManager.requestIntervention({
          type: currentUrl.includes('login') ? 'LOGIN' : 'SECURITY_CHALLENGE',
          marketplace: 'mercadolivre',
          title: currentUrl.includes('login') ? 'Login Necessário no Mercado Livre Afiliados' : 'Desafio de Segurança no Mercado Livre Afiliados',
          message: 'O gerador de links de afiliados requer que você acesse e confirme sua sessão para gerar links comissionados (meli.la).',
          targetUrl: currentUrl || 'https://www.mercadolivre.com.br/afiliados/linkbuilder#hub',
          actionLabel: 'Abrir Página do Desafio ↗',
          metadata: { currentUrl, productUrl },
        }).catch(() => null);

        // Aguarda resolução humana ativa (via painel/celular ou diretamente no navegador)
        await interventionManager.waitForResolution(
          intervention?.id,
          180000, // Aguarda até 3 minutos
          async () => {
            const nowUrl = page.url();
            return !nowUrl.includes('login') && !nowUrl.includes('checkpoint') && !nowUrl.includes('challenge');
          }
        );

        if (intervention?.id) {
          try {
            const { data: invData } = await supabase
              .from('operator_interventions')
              .select('metadata')
              .eq('id', intervention.id)
              .maybeSingle();

            if (invData?.metadata?.manual_affiliate_url) {
              const manUrl = invData.metadata.manual_affiliate_url;
              logger.info(`[MLAffiliateProvider] ✓ Link comissionado manual informado pelo operador: ${manUrl}`);
              return {
                marketplace: 'mercadolivre',
                productUrl,
                affiliateUrl: manUrl,
                shortUrl: manUrl,
                affiliateVerified: true,
                generatedAt: new Date().toISOString(),
              };
            }
          } catch (e) {
            logger.warn(`[MLAffiliateProvider] Falha ao verificar link manual: ${e.message}`);
          }
        }

        // Recarrega a página do gerador com a sessão recém-validada
        await page.goto('https://www.mercadolivre.com.br/afiliados/linkbuilder#hub', {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
      }

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
        try {
          await textarea.fill(productUrl, { timeout: 4000 });
          await page.waitForTimeout(600);

          const generateBtn = await page.$('button:has-text("Gerar"), .andes-button:has-text("Gerar")');
          if (generateBtn) {
            await generateBtn.click();
            await page.waitForTimeout(3000);

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
        } catch (fillErr) {
          logger.warn(`[MLAffiliateProvider] Fallback formulário falhou: ${fillErr.message}`);
        }
      }

      // Se não conseguiu gerar link oficial por nenhum método, registra intervenção humana
      await interventionManager.requestIntervention({
        type: 'SECURITY_CHALLENGE',
        marketplace: 'mercadolivre',
        title: 'Verificação / Sessão no Mercado Livre Afiliados',
        message: 'O gerador de links de afiliados requer verificação ou sessão no navegador para gerar links comissionados (meli.la).',
        targetUrl: 'https://www.mercadolivre.com.br/afiliados/linkbuilder#hub',
        actionLabel: 'Abrir Gerador Mercado Livre ↗',
        metadata: { productUrl, currentUrl: page.url() },
      }).catch(() => {});

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
      await interventionManager.requestIntervention({
        type: 'SECURITY_CHALLENGE',
        marketplace: 'mercadolivre',
        title: 'Verificação / Sessão no Mercado Livre Afiliados',
        message: 'O gerador oficial de links de afiliados requer verificação no navegador para gerar links comissionados (meli.la).',
        targetUrl: 'https://www.mercadolivre.com.br/afiliados/linkbuilder#hub',
        actionLabel: 'Abrir Gerador Mercado Livre ↗',
        metadata: { productUrl, error: err.message },
      }).catch(() => {});

      return {
        marketplace: 'mercadolivre',
        productUrl,
        affiliateUrl: null,
        affiliateVerified: false,
        generatedAt: new Date().toISOString(),
        error: err.message,
      };
    } finally {
      if (needLaunch) {
        await browser.close().catch(() => {});
      }
    }
  }
}

export default MercadoLivreAffiliateProvider;
