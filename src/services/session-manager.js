/**
 * ACHAki Autopilot — SessionManager (Fase 3)
 *
 * Responsável por verificar se as sessões das contas configuradas
 * ainda são válidas após login manual.
 *
 * REGRAS:
 *  - Login SEMPRE é feito manualmente pelo usuário.
 *  - Este módulo NUNCA automatiza login, CAPTCHA ou 2FA.
 *  - Apenas verifica se a sessão existente ainda está autenticada.
 *  - Cookies/sessões são preservados no perfil persistente do Chromium.
 *
 * Plataformas suportadas:
 *  - Facebook          (publisher de posts)
 *  - Shopee            (marketplace de pesquisa)
 *  - Mercado Livre     (marketplace de pesquisa)
 *  - Amazon Brasil     (marketplace de pesquisa)
 *  - Amazon Associados (programa de afiliados)
 *  - AliExpress        (marketplace de pesquisa)
 */

import logger from '../utils/logger.js';

// ─── Definição das contas ─────────────────────────────────────────────────────

/**
 * @typedef {Object} AccountConfig
 * @property {string} id         - Identificador interno da conta
 * @property {string} name       - Nome amigável para logs/UI
 * @property {string} loginUrl   - URL da página de login (para abertura manual)
 * @property {string} checkUrl   - URL para verificar se está autenticado
 * @property {Function} isLoggedIn - Função que recebe (page) e retorna boolean
 */

/** @type {AccountConfig[]} */
export const ACCOUNTS = [
  {
    id: 'facebook',
    name: 'Facebook',
    loginUrl: 'https://www.facebook.com/login',
    checkUrl: 'https://www.facebook.com/',
    /**
     * Verifica sessão: usuário autenticado não vê o form de login.
     * @param {import('playwright').Page} page
     * @returns {Promise<boolean>}
     */
    isLoggedIn: async (page) => {
      try {
        await page.goto('https://www.facebook.com/', {
          waitUntil: 'domcontentloaded',
          timeout: 20_000,
        });
        // Se estiver logado, não existirá input de email na tela inicial
        const loginInput = await page.$('input[name="email"]');
        return loginInput === null;
      } catch {
        return false;
      }
    },
  },
  {
    id: 'shopee',
    name: 'Shopee',
    loginUrl: 'https://shopee.com.br/buyer/login',
    checkUrl: 'https://shopee.com.br/',
    /**
     * Verifica sessão: usuário autenticado vê ícone de perfil/usuário.
     * @param {import('playwright').Page} page
     * @returns {Promise<boolean>}
     */
    isLoggedIn: async (page) => {
      try {
        await page.goto('https://shopee.com.br/', {
          waitUntil: 'domcontentloaded',
          timeout: 20_000,
        });

        // Sinal negativo: redirecionamento para verificação / captcha anti-bot
        const currentUrl = page.url();
        if (currentUrl.includes('/verify/') || currentUrl.includes('captcha')) {
          return false;
        }

        // Shopee logado: ausência do botão "Entrar" visível no header
        const loginBtn = await page.$('a[href*="/buyer/login"]');
        return loginBtn === null;
      } catch {
        return false;
      }
    },
  },
  {
    id: 'mercadolivre',
    name: 'Mercado Livre',
    loginUrl: 'https://www.mercadolivre.com.br/login',
    checkUrl: 'https://www.mercadolivre.com.br/',
    /**
     * Verifica sessão com múltiplos sinais positivos reais do DOM autenticado.
     *
     * Sinais coletados por inspeção real (2026-09-23):
     *  - [class*="user"] → exibe o nome do usuário no header
     *  - [aria-label*="conta"] → menu de conta presente
     *  - [aria-label*="perfil"] → ícone de perfil presente
     *  - a[href*="myaccount.mercadolivre"] → link "Minhas compras"
     *  - Ausência de input de login (input[name="user_id"])
     *
     * Lógica: 2 ou mais sinais positivos → ATIVA
     *         Presença clara de tela de login → NÃO AUTENTICADA
     *         Caso contrário → considera INDETERMINADO (retorna false)
     *
     * @param {import('playwright').Page} page
     * @returns {Promise<boolean>}
     */
    isLoggedIn: async (page) => {
      try {
        await page.goto('https://www.mercadolivre.com.br/', {
          waitUntil: 'domcontentloaded',
          timeout: 20_000,
        });

        // Sinal negativo: tela de login carregada
        const loginInput = await page.$('input[name="user_id"], input[id="user_id"], .login-form');
        if (loginInput) return false;

        // Sinais positivos encontrados no DOM real autenticado
        const signals = await Promise.all([
          page.$('[class*="user"]'),                              // nome do usuário no header
          page.$('[aria-label*="conta"]'),                       // menu de conta
          page.$('[aria-label*="perfil"]'),                      // ícone de perfil
          page.$('a[href*="myaccount.mercadolivre"]'),           // link Minhas compras
          page.$('a[href*="purchases"]'),                        // link compras (variante)
          page.$('a[href*="addresses/v3/navigation"]'),          // link endereço de entrega
        ]);

        const positiveCount = signals.filter(Boolean).length;

        // 2 ou mais sinais positivos → sessão ativa
        return positiveCount >= 2;

      } catch {
        return false;
      }
    },
  },

  // ─── Amazon Brasil ────────────────────────────────────────────────────────────
  {
    id: 'amazon',
    name: 'Amazon',
    loginUrl: 'https://www.amazon.com.br/ap/signin',
    checkUrl: 'https://www.amazon.com.br/',
    /**
     * Verifica sessão Amazon BR com múltiplos sinais positivos.
     *
     * Sinais positivos (Amazon autenticada):
     *  - #nav-link-accountList           → bloco de conta no nav
     *  - #nav-orders                     → link "Pedidos"
     *  - a[href*="gp/css/account"]       → link "Sua conta"
     *  - a[href*="gp/order"]             → link de pedidos
     *
     * Sinal negativo (não autenticada):
     *  - #ap_email ou #signInSubmit      → tela de login
     *
     * Lógica: 2+ sinais positivos → ATIVA
     *         Presença de tela de login → NÃO AUTENTICADA
     *
     * NOTA: seletores verificados/refinados pelo diagnóstico pós-login.
     * Se falso negativo ocorrer, executar: node scripts/diagnose-amazon.js
     *
     * @param {import('playwright').Page} page
     * @returns {Promise<boolean>}
     */
    isLoggedIn: async (page) => {
      try {
        await page.goto('https://www.amazon.com.br/', {
          waitUntil: 'domcontentloaded',
          timeout: 20_000,
        });
        await page.waitForTimeout(1500);

        // Sinal negativo: tela de login
        const loginForm = await page.$('#ap_email, #signInSubmit, input[name="email"][id="ap_email"]');
        if (loginForm) return false;

        // Sinais positivos
        const signals = await Promise.all([
          page.$('#nav-link-accountList'),          // bloco de conta no nav
          page.$('#nav-orders'),                    // link "Pedidos"
          page.$('a[href*="gp/css/account"]'),      // link "Sua conta"
          page.$('a[href*="gp/order"]'),            // link de pedidos
          page.$('[data-nav-role="signin"]'),        // seletor alternativo de conta
          page.$('a[href*="sign-out"]'),             // link de logout (só existe autenticado)
        ]);

        const positiveCount = signals.filter(Boolean).length;
        return positiveCount >= 2;

      } catch {
        return false;
      }
    },
  },

  // ─── Amazon Associados ───────────────────────────────────────────────────────
  {
    id: 'amazon-associates',
    name: 'Amazon Associados',
    loginUrl: 'https://associados.amazon.com.br/login',
    checkUrl: 'https://associados.amazon.com.br/',
    /**
     * Verifica acesso ao Portal Amazon Associados.
     *
     * Sinais negativos confirmados por diagnóstico real (2026-09-23)
     * na página pública (não autenticada):
     *  - .ac-creatorhub-header-item-login-button → botão "Iniciar a sessão"
     *  - a[href*="/login"][href*="associados"]    → link de login no header
     *  - a[href*="/signup"] com texto "Inscreva-se" → página pública
     *
     * Sinais positivos (painel autenticado — dashboard do associado):
     *  - a[href*="/home"] dentro de associados.amazon.com.br
     *  - a[href*="/earnings"]    → relatório de ganhos
     *  - a[href*="/reporting"]   → relatórios
     *  - a[href*="/tools"]       → ferramentas de links
     *  - a[href*="/product-links"] → links de produto
     *  - [class*="ac-sidebar"]   → sidebar do painel
     *  - [id*="ac-dashboard"]    → elemento do dashboard
     *
     * Lógica:
     *  - Botão login presente              → NÃO AUTENTICADA
     *  - URL fora de associados.amazon.com.br → NÃO AUTENTICADA
     *  - 1+ sinal positivo + sem login     → ATIVA
     *  - Nenhum sinal + sem login          → INDETERMINADA (false)
     *
     * NOTA: Requer login SEPARADO do amazon.com.br.
     * Após login manual: node scripts/diagnose-amazon.js para calibrar.
     *
     * @param {import('playwright').Page} page
     * @returns {Promise<boolean>}
     */
    isLoggedIn: async (page) => {
      try {
        await page.goto('https://associados.amazon.com.br/', {
          waitUntil: 'domcontentloaded',
          timeout: 20_000,
        });
        await page.waitForTimeout(1500);

        const finalUrl = page.url();

        // Sinal negativo: redirecionou para login da Amazon
        if (finalUrl.includes('/ap/signin')) return false;

        // Sinal negativo confirmado por DOM real: botão "Iniciar a sessão"
        const loginButton = await page.$(
          '.ac-creatorhub-header-item-login-button, a[href*="associados.amazon.com.br/login"]'
        );
        if (loginButton) return false;

        // Sinal negativo: links de signup visíveis (página pública)
        const signupLinks = await page.$$('a[href*="/signup"]');
        for (const link of signupLinks) {
          const txt = (await link.innerText().catch(() => '')).toLowerCase();
          if (txt.includes('inscreva') || txt.includes('cadastre')) return false;
        }

        // Sinais positivos do painel autenticado
        const signals = await Promise.all([
          page.$('a[href*="associados.amazon.com.br/home"]'),
          page.$('a[href*="/earnings"]'),
          page.$('a[href*="/reporting"]'),
          page.$('a[href*="/tools"]'),
          page.$('a[href*="/product-links"]'),
          page.$('[class*="ac-sidebar"]'),
          page.$('[id*="ac-dashboard"]'),
        ]);

        const onAssociatesPage = finalUrl.includes('associados.amazon.com.br');
        const positiveCount = signals.filter(Boolean).length;

        return onAssociatesPage && positiveCount >= 1;

      } catch {
        return false;
      }
    },
  },


  // ─── AliExpress ───────────────────────────────────────────────────────────────
  {
    id: 'aliexpress',
    name: 'AliExpress',
    loginUrl: 'https://login.aliexpress.com/',
    checkUrl: 'https://www.aliexpress.com/',
    /**
     * Verifica sessão AliExpress com múltiplos sinais positivos.
     *
     * Sinais positivos (usuário autenticado):
     *  - [class*="user-name"]         → nome de usuário no header
     *  - [class*="account-nav"]       → barra de conta
     *  - a[href*="/profile"]          → link de perfil
     *  - a[href*="/order/list"]       → link de pedidos
     *  - a[href*="/account"]          → link de conta geral
     *  - [class*="my-account"]        → área "Minha Conta"
     *  - [data-spm*="account"]        → elemento de conta (tracking)
     *
     * Sinal negativo (não autenticado):
     *  - a[href*="login.aliexpress"]  → botão/link de login visível
     *  - [class*="sign-in"]           → botão de sign-in
     *
     * Lógica: 2+ sinais positivos → ATIVA
     *         Sinal negativo presente → NÃO AUTENTICADA
     *
     * NOTA: Se falso negativo, execute: node scripts/diagnose-aliexpress.js
     * Os seletores serão refinados com o DOM real autenticado.
     *
     * @param {import('playwright').Page} page
     * @returns {Promise<boolean>}
     */
    isLoggedIn: async (page) => {
      try {
        await page.goto('https://www.aliexpress.com/', {
          waitUntil: 'domcontentloaded',
          timeout: 25_000,
        });
        await page.waitForTimeout(2000); // AliExpress usa JS pesado

        // Sinal negativo: botão de login visível
        const loginLink = await page.$(
          'a[href*="login.aliexpress"], [class*="sign-in"], [class*="signin"]'
        );
        // Apenas retorna false se o botão de login for claramente visível e com texto
        if (loginLink) {
          const loginText = (await loginLink.innerText().catch(() => '')).toLowerCase();
          if (loginText.includes('sign') || loginText.includes('entrar') || loginText.includes('login')) {
            return false;
          }
        }

        // Sinais positivos
        const signals = await Promise.all([
          page.$('[class*="user-name"]'),          // nome de usuário
          page.$('[class*="account-nav"]'),        // barra de conta
          page.$('a[href*="/profile"]'),           // link perfil
          page.$('a[href*="/order/list"]'),        // link pedidos
          page.$('a[href*="/account"]'),           // link conta
          page.$('[class*="my-account"]'),         // área minha conta
          page.$('[data-spm*="account"]'),         // elemento de conta (tracking attr)
          page.$('[class*="avatar"]'),             // avatar de usuário autenticado
        ]);

        const positiveCount = signals.filter(Boolean).length;
        return positiveCount >= 2;

      } catch {
        return false;
      }
    },
  },
];

// ─── Classe SessionManager ────────────────────────────────────────────────────

class SessionManager {
  /**
   * @param {import('../browser/browser.js').default} browserManager
   */
  constructor(browserManager) {
    this.browser = browserManager;
  }

  /**
   * Verifica o status de sessão de uma conta específica.
   *
   * @param {AccountConfig} account
   * @returns {Promise<{id: string, name: string, loggedIn: boolean}>}
   */
  async checkAccount(account) {
    logger.info(`[Session] Verificando sessão: ${account.name}...`);

    const page = await this.browser.openPage();

    try {
      const loggedIn = await account.isLoggedIn(page);
      const status = loggedIn ? '✔ ATIVA' : '✘ NÃO AUTENTICADA';
      logger.info(`[Session] ${account.name}: ${status}`);
      return { id: account.id, name: account.name, loggedIn };
    } catch (err) {
      logger.warn(`[Session] Erro ao verificar ${account.name}: ${err.message}`);
      return { id: account.id, name: account.name, loggedIn: false };
    }
  }

  /**
   * Verifica todas as contas configuradas.
   *
   * @returns {Promise<Array<{id: string, name: string, loggedIn: boolean}>>}
   */
  async checkAllAccounts() {
    logger.info('[Session] Iniciando verificação de todas as contas...');
    const results = [];

    for (const account of ACCOUNTS) {
      const result = await this.checkAccount(account);
      results.push(result);
    }

    return results;
  }
}

export default SessionManager;
