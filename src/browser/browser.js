/**
 * ACHAki Autopilot — BrowserManager
 *
 * Gerencia o ciclo de vida do Chromium via Playwright.
 * Usa contexto persistente para preservar sessões autenticadas
 * em fases futuras (cookies, localStorage, etc.).
 *
 * REGRAS DE SEGURANÇA (aplicam-se a todas as fases):
 *  - Nunca contornar CAPTCHA
 *  - Nunca burlar autenticação ou 2FA
 *  - Nunca executar compras ou movimentar dinheiro
 *  - Nunca evitar bloqueios de segurança dos sites
 *
 * Perfil separado em data/browser-profile para não contaminar
 * o perfil pessoal do usuário.
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class BrowserManager {
  constructor() {
    /** @type {import('playwright').BrowserContext|null} */
    this.context = null;

    /** @type {import('playwright').Page|null} */
    this.page = null;

    // Resolução do caminho do perfil a partir da raiz do projeto
    const profilePath = process.env.BROWSER_PROFILE_PATH || './data/browser-profile';
    this.profileDir = path.resolve(__dirname, '../../', profilePath);

    this.headless = process.env.BROWSER_HEADLESS === 'true';
  }

  /**
   * Inicializa o contexto persistente do Chromium.
   * O contexto persistente permite manter sessões autenticadas
   * entre execuções (cookies, tokens, localStorage).
   *
   * @returns {Promise<void>}
   */
  async launch() {
    logger.info('Iniciando BrowserManager...');
    logger.info(`Perfil do browser: ${this.profileDir}`);
    logger.info(`Modo headless: ${this.headless}`);

    // Garante que o diretório do perfil existe
    if (!fs.existsSync(this.profileDir)) {
      fs.mkdirSync(this.profileDir, { recursive: true });
      logger.info('Diretório de perfil criado.');
    }

    this.context = await chromium.launchPersistentContext(this.profileDir, {
      headless: this.headless,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      viewport: { width: 1280, height: 800 },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    logger.info('[ACHAki] Browser iniciado');
  }

  /**
   * Abre uma nova aba (página) no contexto atual.
   * Reutiliza a primeira aba se já existir.
   *
   * @returns {Promise<import('playwright').Page>}
   */
  async openPage() {
    if (!this.context) {
      throw new Error('BrowserManager não inicializado. Chame launch() primeiro.');
    }

    const pages = this.context.pages();
    if (pages.length > 0) {
      this.page = pages[0];
      logger.debug('Reutilizando aba existente.');
    } else {
      this.page = await this.context.newPage();
      logger.debug('Nova aba criada.');
    }

    return this.page;
  }

  /**
   * Navega para uma URL na página ativa.
   *
   * @param {string} url - URL completa para navegar
   * @returns {Promise<void>}
   */
  async navigate(url) {
    if (!this.page) {
      throw new Error('Nenhuma página aberta. Chame openPage() primeiro.');
    }

    logger.info(`Navegando para: ${url}`);

    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const title = await this.page.title();
    logger.info(`Página carregada: "${title}"`);
  }

  /**
   * Aguarda um tempo em milissegundos.
   * Útil para observar o browser antes de fechar.
   *
   * @param {number} ms - Milissegundos para aguardar
   * @returns {Promise<void>}
   */
  async wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Fecha o contexto do browser e libera recursos.
   * Sempre chame no bloco finally para garantir limpeza.
   *
   * @returns {Promise<void>}
   */
  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page = null;
      logger.info('Browser encerrado corretamente.');
    }
  }
}

export default BrowserManager;
