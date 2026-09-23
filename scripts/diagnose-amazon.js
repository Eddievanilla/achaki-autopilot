/**
 * ACHAki Autopilot — Diagnóstico DOM Amazon BR + Associados
 *
 * Abre Amazon BR e Amazon Associados com o perfil persistente.
 * Extrai seletores reais presentes no DOM autenticado.
 *
 * USO (após login manual na Amazon):
 *   node scripts/diagnose-amazon.js
 */

import 'dotenv/config';
import BrowserManager from '../src/browser/browser.js';

async function inspectPage(page, url, label) {
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  DIAGNÓSTICO: ${label}`);
  console.log(`  URL: ${url}`);
  console.log('═'.repeat(64));

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(2000); // aguarda JS renderizar

  const title = await page.title();
  const finalUrl = page.url();
  console.log(`\n  Título  : ${title}`);
  console.log(`  URL     : ${finalUrl}`);

  // Seletores candidatos para Amazon BR (autenticado)
  const selectors = [
    // Nav — nome do usuário
    '#nav-link-accountList',
    '#nav-link-accountList-nav-line-1',
    '[data-nav-role="signin"]',
    '#nav-greeting-name',
    '.nav-greeting-name',
    '[class*="nav-line-1"]',
    // Links de conta autenticada
    'a[href*="gp/css/account"]',
    'a[href*="gp/yourstore"]',
    'a[href*="/gp/orders"]',
    'a[href*="gp/order"]',
    '#nav-orders',
    // Sinal negativo (login)
    '#ap_email',
    'input[name="email"]',
    '#signInSubmit',
    // Associados
    '.ac-logo-link',
    '#a-autoid-0',
    '[class*="associates"]',
    '[class*="affiliate"]',
    '#dashboard',
    '.dashboard',
    '[href*="associados"]',
    '[href*="affiliate"]',
    '#ac-header',
    '.ac-header',
  ];

  console.log('\n  Seletores testados:\n');
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      const text = el ? (await el.innerText().catch(() => '')).slice(0, 80).trim() : null;
      const exists = el !== null;
      console.log(`  ${exists ? '✔' : '✗'}  ${sel.padEnd(40)} ${text ? `"${text}"` : ''}`);
    } catch {
      console.log(`  ?  ${sel.padEnd(40)} (erro)`);
    }
  }

  // Links do header
  const links = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('header a, nav a, #navbar a, #nav-belt a')).slice(0, 20);
    return els.map(a => ({
      href: (a.href || '').slice(0, 100),
      text: (a.innerText || '').slice(0, 60).replace(/\n/g, ' '),
      id: a.id || '',
      cls: (a.className || '').toString().slice(0, 80),
    }));
  });

  console.log('\n  Links no header:\n');
  for (const l of links) {
    console.log(`    [${l.id || l.cls.slice(0, 30)}] "${l.text}" → ${l.href}`);
  }
}

async function inspectAssociatesDetailed(page) {
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  DETALHE AMAZON ASSOCIADOS: https://associados.amazon.com.br/`);
  console.log('═'.repeat(64));

  await page.goto('https://associados.amazon.com.br/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(3000);

  const finalUrl = page.url();
  console.log('Final URL:', finalUrl);

  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 1500));
  console.log('\n--- Texto visível da página (início) ---');
  console.log(bodyText);
  console.log('--- Fim do texto ---\n');

  const linksAndButtons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a, button, input[type=submit]'))
      .map(el => ({
        tag: el.tagName,
        id: el.id,
        className: el.className,
        text: (el.innerText || el.value || '').trim().replace(/\s+/g, ' '),
        href: el.href || ''
      }))
      .filter(item => item.text.length > 0 || item.href.length > 0)
      .slice(0, 40);
  });

  console.log('Elementos interativos encontrados:');
  for (const item of linksAndButtons) {
    console.log(`  <${item.tag}> id="${item.id}" class="${item.className}" text="${item.text}" href="${item.href}"`);
  }
}

async function main() {
  const browser = new BrowserManager();

  try {
    await browser.launch();
    const page = await browser.openPage();

    await inspectPage(page, 'https://www.amazon.com.br/', 'Amazon Brasil');
    await inspectAssociatesDetailed(page);

    console.log('\n[Diagnóstico] Concluído.\n');
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
