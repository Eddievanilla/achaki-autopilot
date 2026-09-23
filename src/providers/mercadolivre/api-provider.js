/**
 * ACHAki Autopilot — MercadoLivreApiProvider (Fase 4.2)
 *
 * Provedor para a API oficial do Mercado Livre Developers.
 * Suporta autenticação OAuth com Client ID, Client Secret e Access Token.
 *
 * Estados:
 *  - NOT_CONFIGURED : credenciais não informadas no .env
 *  - AUTH_ERROR     : credenciais inválidas ou token expirado
 *  - AVAILABLE      : autenticado com sucesso e apto para buscas
 *  - ERROR          : erro operacional na comunicação com a API
 *
 * Segurança:
 *  - CLIENT_SECRET e ACCESS_TOKEN NUNCA são expostos em logs.
 */

import BaseProvider from '../base-provider.js';
import logger from '../../utils/logger.js';
import MercadoLivreOAuthManager from './oauth-manager.js';

export class MercadoLivreApiProvider extends BaseProvider {
  constructor() {
    super({
      marketplace: 'mercadolivre',
      source: 'official_api',
      status: 'NOT_CONFIGURED',
    });

    this.baseUrl = 'https://api.mercadolibre.com';
    this.oauthManager = new MercadoLivreOAuthManager();
    this.reloadCredentials();
  }

  /**
   * Recarrega as credenciais do ambiente ou parâmetros.
   */
  reloadCredentials() {
    this.clientId = process.env.MERCADOLIVRE_CLIENT_ID || '';
    this.clientSecret = process.env.MERCADOLIVRE_CLIENT_SECRET || '';
    this.accessToken = process.env.MERCADOLIVRE_ACCESS_TOKEN || '';
    this.refreshToken = process.env.MERCADOLIVRE_REFRESH_TOKEN || '';

    this.oauthManager = new MercadoLivreOAuthManager({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
    });

    if (this.clientId && this.clientSecret && this.accessToken) {
      this.status = 'AVAILABLE';
      logger.debug('[MercadoLivreApiProvider] Credenciais completas detectadas no ambiente.');
    } else {
      this.status = 'NOT_CONFIGURED';
    }
  }

  /**
   * Tenta renovar o Access Token caso o refresh_token esteja disponível.
   */
  async tryRefreshToken() {
    if (!this.refreshToken || !this.clientSecret) {
      return false;
    }

    try {
      logger.info('[MercadoLivreApiProvider] Tentando renovar Access Token expirado...');
      const tokens = await this.oauthManager.refreshAccessToken(this.refreshToken);
      MercadoLivreOAuthManager.saveTokensToEnv(tokens);
      this.accessToken = tokens.accessToken;
      if (tokens.refreshToken) {
        this.refreshToken = tokens.refreshToken;
      }
      this.status = 'AVAILABLE';
      return true;
    } catch (err) {
      logger.warn(`[MercadoLivreApiProvider] Não foi possível renovar o token: ${err.message}`);
      return false;
    }
  }

  /**
   * Identifica quais variáveis obrigatórias ainda não foram configuradas.
   * @returns {string[]} Lista dos nomes das variáveis faltantes
   */
  getMissingCredentials() {
    const missing = [];
    if (!this.clientId) missing.push('MERCADOLIVRE_CLIENT_ID');
    if (!this.clientSecret) missing.push('MERCADOLIVRE_CLIENT_SECRET');
    if (!this.accessToken) missing.push('MERCADOLIVRE_ACCESS_TOKEN');
    return missing;
  }

  /**
   * Testa e valida as credenciais contra o endpoint oficial de usuário (/users/me).
   *
   * @returns {Promise<{
   *   valid: boolean,
   *   status: 'AVAILABLE'|'NOT_CONFIGURED'|'AUTH_ERROR'|'ERROR',
   *   user?: string,
   *   message?: string
   * }>}
   */
  async validateCredentials() {
    const missing = this.getMissingCredentials();
    if (missing.length > 0) {
      this.status = 'NOT_CONFIGURED';
      return {
        valid: false,
        status: 'NOT_CONFIGURED',
        message: `Credenciais ausentes: ${missing.join(', ')}`,
      };
    }

    try {
      logger.info('[MercadoLivreApiProvider] Validando Access Token com /users/me...');
      const response = await fetch(`${this.baseUrl}/users/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        this.status = 'AVAILABLE';
        logger.info(`[MercadoLivreApiProvider] Autenticação válida. Usuário: ${data.nickname || data.id}`);
        return {
          valid: true,
          status: 'AVAILABLE',
          user: data.nickname || String(data.id),
        };
      }

      if (response.status === 401) {
        // Tenta renovar o token se possuir refresh_token
        const refreshed = await this.tryRefreshToken();
        if (refreshed) {
          logger.info('[MercadoLivreApiProvider] Retestando /users/me com token renovado...');
          const retryRes = await fetch(`${this.baseUrl}/users/me`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
              Accept: 'application/json',
            },
          });
          if (retryRes.ok) {
            const data = await retryRes.json();
            this.status = 'AVAILABLE';
            return {
              valid: true,
              status: 'AVAILABLE',
              user: data.nickname || String(data.id),
            };
          }
        }

        this.status = 'AUTH_ERROR';
        const errData = await response.json().catch(() => ({}));
        const msg = errData.message || `Token rejeitado (HTTP ${response.status})`;
        logger.warn(`[MercadoLivreApiProvider] Falha de autenticação: ${msg}`);
        return {
          valid: false,
          status: 'AUTH_ERROR',
          message: msg,
        };
      }

      if (response.status === 403) {
        this.status = 'AUTH_ERROR';
        const errData = await response.json().catch(() => ({}));
        const msg = errData.message || 'Permissão negada (HTTP 403)';
        logger.warn(`[MercadoLivreApiProvider] Permissão negada: ${msg}`);
        return {
          valid: false,
          status: 'AUTH_ERROR',
          message: msg,
        };
      }

      this.status = 'ERROR';
      return {
        valid: false,
        status: 'ERROR',
        message: `HTTP ${response.status} ${response.statusText}`,
      };

    } catch (err) {
      this.status = 'ERROR';
      logger.error(`[MercadoLivreApiProvider] Erro de rede ao validar credenciais: ${err.message}`);
      return {
        valid: false,
        status: 'ERROR',
        message: err.message,
      };
    }
  }

  /**
   * Executa busca de produtos na API oficial do Mercado Livre.
   *
   * @param {object} options
   * @param {string} options.category - Nome da categoria
   * @param {string} options.query - Termo de busca
   * @param {number} [options.limit=15] - Limite de itens
   * @returns {Promise<Array<object>>}
   */
  async search({ category, query, limit = 15 }) {
    if (this.status === 'NOT_CONFIGURED') {
      logger.debug('[MercadoLivreApiProvider] Ignorando busca: provider NOT_CONFIGURED.');
      return [];
    }

    if (this.status === 'AUTH_ERROR') {
      logger.warn('[MercadoLivreApiProvider] Ignorando busca: provider em AUTH_ERROR.');
      return [];
    }

    try {
      logger.info(`[MercadoLivreApiProvider] Buscando na API oficial: "${query}" (limite: ${limit})...`);

      const url = `${this.baseUrl}/sites/MLB/search?q=${encodeURIComponent(query)}&limit=${limit}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/json',
        },
      });

      let currentRes = response;
      if (currentRes.status === 401) {
        const refreshed = await this.tryRefreshToken();
        if (refreshed) {
          logger.info('[MercadoLivreApiProvider] Retentando busca com token renovado...');
          currentRes = await fetch(url, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
              Accept: 'application/json',
            },
          });
        }
      }

      if (!currentRes.ok) {
        if (currentRes.status === 401 || currentRes.status === 403) {
          this.status = 'AUTH_ERROR';
        }
        logger.warn(`[MercadoLivreApiProvider] Erro na busca (HTTP ${currentRes.status})`);
        return [];
      }

      const data = await currentRes.json();
      const results = Array.isArray(data.results) ? data.results : [];

      const normalizedList = results.map((item) => {
        let discountPercent = null;
        if (item.original_price && item.original_price > item.price) {
          discountPercent = Math.round(((item.original_price - item.price) / item.original_price) * 100);
        }

        return this.normalizeProduct({
          productId: item.id,
          title: item.title,
          currentPrice: item.price,
          originalPrice: item.original_price || null,
          discountPercent,
          rating: null,
          reviewCount: null,
          soldCount: item.sold_quantity || null,
          sellerName: item.seller?.nickname || null,
          sellerReputation: null,
          shipping: item.shipping?.free_shipping ? 'Frete Grátis' : null,
          imageUrl: item.thumbnail ? item.thumbnail.replace('-I.jpg', '-O.jpg') : null,
          productUrl: item.permalink || `https://produto.mercadolivre.com.br/MLB-${item.id.replace(/[^\d]/g, '')}`,
          category,
          collectedAt: new Date().toISOString(),
        });
      });

      logger.info(`[MercadoLivreApiProvider] Produtos normalizados da API: ${normalizedList.length}`);
      return normalizedList;

    } catch (err) {
      logger.error(`[MercadoLivreApiProvider] Exceção na busca: ${err.message}`);
      return [];
    }
  }
}

export default MercadoLivreApiProvider;
