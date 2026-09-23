/**
 * ACHAki Autopilot — Diagnóstico DOM do AliExpress
 *
 * Abre o AliExpress com o perfil persistente autenticado e extrai
 * os elementos reais do header para identificar seletores estáveis.
 *
 * USO (após login manual no AliExpress):
 *   node scripts/diagnose-aliexpress.js
 *
 * Uso único para calibração — execute se check:sessions retornar
 * falso negativo para o AliExpress.
 */

import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';

async function main() {
  const browser = new BrowserManager();

  try {
    await browser.launch();
    const page = await browser.openPage();

    console.log('\n[Diagnóstico AliExpress] Navegando...');
    await page.goto('https://www.aliexpress.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    const title    = await page.title();
    const finalUrl = page.url();
    console.log(`\n  Título  : ${title}`);
    console.log(`  URL     : ${finalUrl}`);

    // ── Seletores candidatos ──────────────────────────────────────────────────
    const selectors = [
      // Conta / usuário autenticado
      '[class*="user-name"]',
      '[class*="account-nav"]',
      '[class*="my-account"]',
      '[class*="avatar"]',
      '[class*="user-avatar"]',
      '[class*="header-account"]',
      '[class*="nav-account"]',
      '[data-spm*="account"]',
      '[data-spm*="user"]',
      // Links de área autenticada
      'a[href*="/profile"]',
      'a[href*="/order/list"]',
      'a[href*="/account"]',
      'a[href*="wishlist"]',
      'a[href*="message"]',
      // Sinal negativo (login)
      'a[href*="login.aliexpress"]',
      '[class*="sign-in"]',
      '[class*="signin"]',
      '[class*="login-btn"]',
    ];

    console.log('\n  Seletores testados:\n');
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        const text = el
          ? (await el.innerText().catch(() => '')).slice(0, 80).trim().replace(/\n/g, ' ')
          : null;
        console.log(`  ${el ? '✔' : '✗'}  ${sel.padEnd(40)} ${text ? `"${text}"` : ''}`);
      } catch {
        console.log(`  ?  ${sel.padEnd(40)} (erro)`);
      }
    }

    // ── Header / nav — links reais ────────────────────────────────────────────
    console.log('\n  Links no header (até 25):\n');
    const links = await page.evaluate(() => {
      const header =
        document.querySelector('header') ||
        document.querySelector('[class*="header"]') ||
        document.querySelector('nav') ||
        document.body;
      return Array.from(header.querySelectorAll('a'))
        .slice(0, 25)
        .map((a) => ({
          href    : (a.href || '').slice(0, 100),
          text    : (a.innerText || '').slice(0, 60).replace(/\n/g, ' ').trim(),
          id      : a.id || '',
          cls     : (a.className || '').toString().slice(0, 80),
          dataSpm : a.getAttribute('data-spm') || '',
        }));
    });
    for (const l of links) {
      console.log(`    [id="${l.id}" spm="${l.dataSpm}"] "${l.text}" → ${l.href}`);
    }

    // ── Elementos com classe user/account/avatar ──────────────────────────────
    console.log('\n  Elementos [class*=user|account|avatar] (até 10):\n');
    const userEls = await page.evaluate(() => {
      const els = Array.from(
        document.querySelectorAll('[class*="user"],[class*="account"],[class*="avatar"]')
      ).slice(0, 10);
      return els.map((el) => ({
        tag     : el.tagName,
        cls     : (el.className || '').toString().slice(0, 100),
        dataSpm : el.getAttribute('data-spm') || '',
        text    : (el.innerText || '').slice(0, 60).replace(/\n/g, ' ').trim(),
      }));
    });
    for (const e of userEls) {
      console.log(`    <${e.tag} class="${e.cls}" spm="${e.dataSpm}"> "${e.text}"`);
    }

    console.log('\n[Diagnóstico AliExpress] Concluído.\n');

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
