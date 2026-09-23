/**
 * ACHAki Autopilot — MercadoLivreOAuthManager (Fase 4.2.1)
 *
 * Gerencia o ciclo de vida OAuth 2.0 para a API oficial do Mercado Livre:
 *  - Geração da URL de autorização com a Redirect URI cadastrada
 *  - Troca de authorization_code por access_token e refresh_token
 *  - Renovação automática de tokens via refresh_token
 *  - Atualização segura do arquivo .env preservando demais variáveis
 *
 * Segurança:
 *  - NENHUM segredo (client_secret, access_token, refresh_token) é exibido em logs.
 */

import fs from 'node:fs';
import path from 'node:path';
import logger from '../../utils/logger.js';

export const DEFAULT_REDIRECT_URI = 'https://achaki-autopilot.vercel.app/achaki/oauth/callback';
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const AUTH_URL = 'https://auth.mercadolivre.com.br/authorization';

export class MercadoLivreOAuthManager {
  constructor(options = {}) {
    this.clientId = options.clientId || process.env.MERCADOLIVRE_CLIENT_ID || '';
    this.clientSecret = options.clientSecret || process.env.MERCADOLIVRE_CLIENT_SECRET || '';
    this.redirectUri = options.redirectUri || process.env.MERCADOLIVRE_REDIRECT_URI || DEFAULT_REDIRECT_URI;
  }

  /**
   * Retorna se as credenciais de cliente necessárias para o OAuth estão presentes.
   */
  hasClientCredentials() {
    return Boolean(this.clientId?.trim() && this.clientSecret?.trim());
  }

  /**
   * Gera a URL para o usuário autorizar a aplicação no navegador.
   *
   * @returns {string} URL de autorização
   */
  getAuthorizationUrl() {
    if (!this.clientId) {
      throw new Error('MERCADOLIVRE_CLIENT_ID não configurado.');
    }
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId.trim(),
      redirect_uri: this.redirectUri.trim(),
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  /**
   * Extrai o código de autorização caso o usuário cole a URL completa de redirecionamento.
   *
   * @param {string} rawInput - Código puro (ex: TG-xxx) ou URL completa
   * @returns {string} Código limpo
   */
  static extractCode(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') return '';
    const trimmed = rawInput.trim();

    // Se o usuário colou a URL completa (ex: https://achaki-autopilot.vercel.app/achaki/oauth/callback?code=TG-...)
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      try {
        const parsed = new URL(trimmed);
        const code = parsed.searchParams.get('code');
        if (code) return code.trim();
      } catch {
        // Fallback caso a URL seja malformatada
      }
    }

    // Se foi passado algo como "code=TG-..."
    if (trimmed.includes('code=')) {
      const match = trimmed.match(/code=([^&\s]+)/);
      if (match && match[1]) return match[1].trim();
    }

    return trimmed;
  }

  /**
   * Troca o authorization_code pelos tokens de acesso e renovação.
   *
   * @param {string} rawCode - Código ou URL completa de callback
   * @returns {Promise<{
   *   accessToken: string,
   *   refreshToken: string,
   *   expiresIn: number,
   *   userId: number|string,
   *   scope: string
   * }>}
   */
  async exchangeCodeForTokens(rawCode) {
    const code = MercadoLivreOAuthManager.extractCode(rawCode);
    if (!code) {
      throw new Error('Código de autorização inválido ou vazio.');
    }

    if (!this.hasClientCredentials()) {
      throw new Error('CLIENT_ID ou CLIENT_SECRET ausentes no ambiente.');
    }

    logger.info('[MercadoLivreOAuth] Solicitando troca do authorization_code por tokens...');

    const bodyParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.clientId.trim(),
      client_secret: this.clientSecret.trim(),
      code,
      redirect_uri: this.redirectUri.trim(),
    });

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: bodyParams.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.message || data.error_description || data.error || `HTTP ${response.status}`;
      logger.error(`[MercadoLivreOAuth] Falha na troca do código: ${errMsg}`);
      throw new Error(`Falha ao obter tokens: ${errMsg}`);
    }

    logger.info('[MercadoLivreOAuth] Tokens obtidos com sucesso da API oficial.');

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      userId: data.user_id,
      scope: data.scope,
    };
  }

  /**
   * Renova o access_token utilizando o refresh_token.
   *
   * @param {string} [refreshToken] - Refresh token (opcional, usa process.env se não passado)
   * @returns {Promise<{
   *   accessToken: string,
   *   refreshToken: string,
   *   expiresIn: number,
   *   userId: number|string
   * }>}
   */
  async refreshAccessToken(refreshToken) {
    const tokenToUse = refreshToken || process.env.MERCADOLIVRE_REFRESH_TOKEN;
    if (!tokenToUse) {
      throw new Error('MERCADOLIVRE_REFRESH_TOKEN não disponível para renovação.');
    }

    if (!this.hasClientCredentials()) {
      throw new Error('CLIENT_ID ou CLIENT_SECRET ausentes para renovação de token.');
    }

    logger.info('[MercadoLivreOAuth] Renovando Access Token com Refresh Token...');

    const bodyParams = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId.trim(),
      client_secret: this.clientSecret.trim(),
      refresh_token: tokenToUse.trim(),
    });

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: bodyParams.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.message || data.error_description || data.error || `HTTP ${response.status}`;
      logger.error(`[MercadoLivreOAuth] Falha ao renovar token: ${errMsg}`);
      throw new Error(`Falha ao renovar token: ${errMsg}`);
    }

    logger.info('[MercadoLivreOAuth] Access Token renovado com sucesso.');

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      userId: data.user_id,
    };
  }

  /**
   * Grava os tokens no arquivo .env com segurança, preservando todas as demais linhas e variáveis.
   *
   * @param {object} tokens
   * @param {string} tokens.accessToken
   * @param {string} [tokens.refreshToken]
   * @param {string} [envFilePath] - Caminho do arquivo .env (opcional)
   */
  static saveTokensToEnv({ accessToken, refreshToken }, envFilePath) {
    const targetPath = envFilePath || path.resolve(process.cwd(), '.env');

    let currentContent = '';
    if (fs.existsSync(targetPath)) {
      currentContent = fs.readFileSync(targetPath, 'utf8');
    }

    const lines = currentContent.split(/\r?\n/);
    let hasAccessToken = false;
    let hasRefreshToken = false;

    const updatedLines = lines.map((line) => {
      if (line.startsWith('MERCADOLIVRE_ACCESS_TOKEN=')) {
        hasAccessToken = true;
        return `MERCADOLIVRE_ACCESS_TOKEN=${accessToken}`;
      }
      if (refreshToken && line.startsWith('MERCADOLIVRE_REFRESH_TOKEN=')) {
        hasRefreshToken = true;
        return `MERCADOLIVRE_REFRESH_TOKEN=${refreshToken}`;
      }
      return line;
    });

    if (!hasAccessToken) {
      updatedLines.push(`MERCADOLIVRE_ACCESS_TOKEN=${accessToken}`);
    }

    if (refreshToken && !hasRefreshToken) {
      updatedLines.push(`MERCADOLIVRE_REFRESH_TOKEN=${refreshToken}`);
    }

    fs.writeFileSync(targetPath, updatedLines.join('\n'), 'utf8');

    // Atualiza também no ambiente de processo ativo
    process.env.MERCADOLIVRE_ACCESS_TOKEN = accessToken;
    if (refreshToken) {
      process.env.MERCADOLIVRE_REFRESH_TOKEN = refreshToken;
    }

    logger.info('[MercadoLivreOAuth] Arquivo .env atualizado com novos tokens com sucesso.');
  }
}

export default MercadoLivreOAuthManager;
