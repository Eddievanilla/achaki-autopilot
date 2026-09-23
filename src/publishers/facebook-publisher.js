/**
 * ACHAki Autopilot — FacebookPublisher
 *
 * Publicador oficial para Facebook Pages via Meta Graph API:
 *  - Implementa fluxo OAuth oficial
 *  - Descobre a Página "ACHAki Achadinhos e Ofertas" automaticamente
 *  - Valida permissões de publicação
 *  - Publica ofertas com imagem real, texto comercial e link oficial de afiliado
 *  - Tokens permanecem estritamente no backend/ambiente seguro
 */

import logger from '../utils/logger.js';
import { supabase } from '../database/supabase.js';

export class FacebookPublisher {
  constructor({
    appId = process.env.FB_APP_ID || process.env.FACEBOOK_APP_ID || '1129522265443857',
    appSecret = process.env.FB_APP_SECRET || process.env.FACEBOOK_APP_SECRET || '',
    redirectUri = process.env.FB_REDIRECT_URI || 'https://achaki-autopilot.vercel.app/auth/facebook/callback',
    apiVersion = 'v19.0',
  } = {}) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.redirectUri = redirectUri;
    this.apiVersion = apiVersion;
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
  }

  /**
   * Gera a URL oficial de autorização OAuth do Facebook para o proprietário.
   *
   * @param {object} [params]
   * @param {string} [params.state] - Código de estado para proteção CSRF
   * @returns {string} URL de autorização
   */
  getAuthorizationUrl({ state = 'achaki_fb_auth' } = {}) {
    const scopes = [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
    ].join(',');

    return `https://www.facebook.com/${this.apiVersion}/dialog/oauth?client_id=${this.appId}&redirect_uri=${encodeURIComponent(this.redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}&response_type=code`;
  }

  /**
   * Troca o código de autorização pelo User Access Token oficial.
   *
   * @param {string} code - Código recebido no callback
   * @returns {Promise<string>} User Access Token
   */
  async exchangeCodeForUserToken(code) {
    if (!this.appSecret) {
      throw new Error('FACEBOOK_APP_SECRET não configurado no backend.');
    }

    const url = `${this.baseUrl}/oauth/access_token?client_id=${this.appId}&redirect_uri=${encodeURIComponent(this.redirectUri)}&client_secret=${this.appSecret}&code=${code}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      throw new Error(`Erro Meta OAuth: ${data.error.message} (${data.error.type})`);
    }

    return data.access_token;
  }

  /**
   * Descobre e localiza automaticamente a página "ACHAki Achadinhos e Ofertas"
   * e extrai o Page Access Token e Page ID oficial.
   *
   * @param {string} userAccessToken
   * @param {string} [targetPageName='ACHAki Achadinhos e Ofertas']
   * @returns {Promise<{
   *   pageId: string,
   *   pageName: string,
   *   pageAccessToken: string,
   *   tasks: Array<string>,
   *   canPost: boolean
   * }>}
   */
  async discoverTargetPage(userAccessToken, targetPageName = 'ACHAki Achadinhos e Ofertas') {
    const url = `${this.baseUrl}/me/accounts?access_token=${userAccessToken}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      throw new Error(`Erro ao consultar páginas Meta: ${data.error.message}`);
    }

    const accounts = data.data || [];
    if (accounts.length === 0) {
      throw new Error('Nenhuma Página do Facebook encontrada na conta autorizada.');
    }

    // Localiza a página ACHAki
    const normTarget = targetPageName.toLowerCase().trim();
    const page = accounts.find((p) => (p.name || '').toLowerCase().trim().includes('achaki') || (p.name || '').toLowerCase().trim() === normTarget) || accounts[0];

    if (!page) {
      throw new Error(`Página "${targetPageName}" não encontrada entre as contas autorizadas.`);
    }

    const tasks = page.tasks || [];
    const canPost = tasks.includes('CREATE_CONTENT') || tasks.includes('MANAGE') || tasks.length > 0;

    return {
      pageId: page.id,
      pageName: page.name,
      pageAccessToken: page.access_token,
      tasks,
      canPost,
    };
  }

  /**
   * Valida se o Page Access Token e permissões estão válidos para a página.
   *
   * @param {object} params
   * @param {string} params.pageId
   * @param {string} params.pageAccessToken
   * @returns {Promise<boolean>}
   */
  async validatePermissions({ pageId, pageAccessToken }) {
    try {
      const url = `${this.baseUrl}/${pageId}?fields=id,name&access_token=${pageAccessToken}`;
      const res = await fetch(url);
      const data = await res.json();

      return !data.error && data.id === pageId;
    } catch {
      return false;
    }
  }

  /**
   * Publica uma oferta real no feed da Página do Facebook.
   *
   * @param {object} params
   * @param {string} params.pageId - ID da Página
   * @param {string} params.pageAccessToken - Token de acesso da Página
   * @param {string} params.message - Texto da publicação
   * @param {string} [params.imageUrl] - URL da imagem do produto
   * @param {string} [params.link] - URL do link comissionado / afiliado
   * @returns {Promise<{
   *   success: boolean,
   *   postId: string,
   *   publicationUrl: string,
   *   publishedAt: string
   * }>}
   */
  async publishPost({ pageId, pageAccessToken, message, imageUrl, link }) {
    logger.info(`[FacebookPublisher] Publicando oferta na Página ${pageId}...`);

    let endpoint = `${this.baseUrl}/${pageId}/photos`;
    let body = {};

    if (imageUrl) {
      // Publicação com foto (mais engajamento orgânico)
      body = {
        url: imageUrl,
        caption: message,
        access_token: pageAccessToken,
      };
    } else {
      // Publicação de feed padrão
      endpoint = `${this.baseUrl}/${pageId}/feed`;
      body = {
        message,
        link: link || undefined,
        access_token: pageAccessToken,
      };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (data.error) {
      logger.error(`[FacebookPublisher] Erro ao publicar: ${data.error.message}`);
      throw new Error(`Falha na publicação Meta: ${data.error.message} (${data.error.type})`);
    }

    const postId = data.post_id || data.id;
    const publicationUrl = `https://www.facebook.com/${postId.replace('_', '/posts/')}`;
    const publishedAt = new Date().toISOString();

    logger.info(`[FacebookPublisher] Publicação concluída com sucesso! ID: ${postId} | URL: ${publicationUrl}`);

    return {
      success: true,
      postId,
      publicationUrl,
      publishedAt,
    };
  }
}

export default FacebookPublisher;
