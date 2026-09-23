/**
 * ACHAki Autopilot — Diagnóstico DOM do Mercado Livre
 *
 * Abre o ML com o perfil persistente e extrai os elementos do cabeçalho
 * para identificar seletores reais de autenticação.
 *
 * USO: node scripts/diagnose-ml.js
 * Uso único — apagar após corrigir session-manager.js
 */

import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';

async function main() {
  const browser = new BrowserManager();

  try {
    await browser.launch();
    const page = await browser.openPage();

    console.log('\n[Diagnóstico] Navegando para https://www.mercadolivre.com.br/ ...');
    await page.goto('https://www.mercadolivre.com.br/', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    console.log('[Diagnóstico] Página carregada. Extraindo DOM do header...\n');

    // ── Extrai o HTML completo do header para análise ─────────────────────────
    const headerHTML = await page.evaluate(() => {
      const candidates = [
        document.querySelector('header'),
        document.querySelector('nav'),
        document.querySelector('[class*="nav"]'),
        document.querySelector('[id*="nav"]'),
        document.querySelector('[class*="header"]'),
      ].filter(Boolean);

      return candidates.map(el => ({
        tag: el.tagName,
        id: el.id || '',
        className: el.className?.toString().slice(0, 200) || '',
        innerText: el.innerText?.slice(0, 500) || '',
        innerHTML: el.innerHTML?.slice(0, 1000) || '',
      }));
    });

    console.log('=== HEADER ELEMENTS ENCONTRADOS ===');
    for (const el of headerHTML) {
      console.log(`\n--- <${el.tag}> id="${el.id}" class="${el.className}" ---`);
      console.log('TEXT:', el.innerText.replace(/\n/g, ' | '));
      console.log('HTML (primeiros 500):', el.innerHTML.slice(0, 500));
    }

    // ── Tenta seletores candidatos ────────────────────────────────────────────
    console.log('\n=== TESTES DE SELETORES ===\n');

    const selectors = [
      // Seletores genéricos de menu autenticado
      '[class*="nav-menu-account"]',
      '[class*="nav-menu-item--profile"]',
      '.nav-menu-item--profile',
      '[class*="user"]',
      '[class*="account"]',
      '[class*="profile"]',
      // Links de área logada
      'a[href*="/compras"]',
      'a[href*="myml"]',
      'a[href*="perfil"]',
      'a[href*="minha-conta"]',
      'a[href*="favoritos"]',
      // Seletores de avatar/nome
      '[data-testid*="account"]',
      '[data-testid*="user"]',
      '[aria-label*="conta"]',
      '[aria-label*="perfil"]',
      // Input de login (não deve existir se autenticado)
      'input[name="user_id"]',
      'input[id="user_id"]',
      '.login-form',
      '[class*="login"]',
    ];

    for (const sel of selectors) {
      const found = await page.$(sel);
      const text = found ? await found.innerText().catch(() => '') : null;
      const exists = found !== null;
      console.log(`${exists ? '✔' : '✗'}  ${sel.padEnd(40)} ${text ? `| "${text.slice(0, 60)}"` : ''}`);
    }

    // ── Extrai todos os links do cabeçalho ────────────────────────────────────
    console.log('\n=== LINKS NO HEADER ===\n');
    const links = await page.evaluate(() => {
      const header = document.querySelector('header') || document.querySelector('nav') || document.body;
      return Array.from(header.querySelectorAll('a')).slice(0, 30).map(a => ({
        href: a.href?.slice(0, 100) || '',
        text: a.innerText?.slice(0, 80) || '',
        ariaLabel: a.getAttribute('aria-label') || '',
        dataTestId: a.getAttribute('data-testid') || '',
        className: a.className?.toString().slice(0, 80) || '',
      }));
    });

    for (const link of links) {
      console.log(`  href="${link.href}" | text="${link.text}" | aria="${link.ariaLabel}" | testid="${link.dataTestId}"`);
    }

    // ── Título da página ──────────────────────────────────────────────────────
    const title = await page.title();
    const url   = page.url();
    console.log(`\n=== PÁGINA ATUAL ===`);
    console.log(`  URL   : ${url}`);
    console.log(`  TÍTULO: ${title}`);

    console.log('\n[Diagnóstico] Concluído. Use os dados acima para corrigir o seletor.\n');

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
