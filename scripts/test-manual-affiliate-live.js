// Scoped live test: existing selected opportunity, one card, manual marketplace generation.
// Does not start the worker, creative factory, publication queue or analytics.
import http from 'node:http';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { supabase } from '../src/database/supabase.js';
import BrowserManager from '../src/browser/browser.js';
import ManualAffiliateFlow from '../src/services/manual-affiliate-flow.js';

const { data, error } = await supabase.from('offer_candidates')
  .select('ai_score, products(id,title,marketplace,marketplace_product_id,product_url,product_prices(current_price,collected_at))')
  .eq('status', 'selected').order('ai_score', { ascending: false }).limit(1);
if (error || !data?.[0]?.products) throw new Error(error?.message || 'Nenhuma oportunidade real selecionada.');
const product = data[0].products;
product.current_price = [...product.product_prices].sort((a, b) => b.collected_at.localeCompare(a.collected_at))[0]?.current_price;
product.score = data[0].ai_score;
const flow = new ManualAffiliateFlow();
const request = await flow.selectProduct(product);
console.log(JSON.stringify({ product: product.title, marketplace: product.marketplace, requestId: request.id, notification: 'OK' }));

const browser = new BrowserManager();
browser.headless = false;
let capture;
let resolveCapture;
const completed = new Promise(resolve => { resolveCapture = resolve; });
const ui = await fs.readFile(new URL('../public/affiliate-flow-ui.js', import.meta.url), 'utf8');
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/affiliate-flow-ui.js') {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8'); res.end(ui); return;
    }
    if (req.url === '/request') {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await flow.getRequest(request.id))); return;
    }
    if (req.url === '/api/controls' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const action = JSON.parse(body);
      if (action.action !== 'OPEN_AFFILIATE_GENERATOR' || action.interventionId !== request.id) throw new Error('Ação fora do teste.');
      // Dedicated dispatch for this test only: do not run any existing worker commands.
      capture ||= flow.captureInSession(request.id, browser, { timeoutMs: 5 * 60 * 1000 })
        .then(resolveCapture, error => resolveCapture({ success: false, error: error.message }));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, message: 'Gerador aberto na sessão integrada. Gere o link manualmente.' }));
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><meta charset="utf-8"><title>ACHAki — teste de link afiliado</title>
      <style>body{font:18px system-ui;background:#101827;color:white;max-width:750px;margin:40px auto}button{padding:14px;margin:10px 8px 10px 0}div{margin:10px 0}</style>
      <script src="/affiliate-flow-ui.js"></script><h1>Produto → link afiliado</h1><main id="card"></main>
      <p>URL do produto: <span id="productUrl"></span></p>
      <script>async function refresh(){const r=await(await fetch('/request')).json();document.querySelector('#card').innerHTML=renderAffiliateLinkCard(r);document.querySelector('#productUrl').textContent=r.metadata.productUrl;}refresh();setInterval(refresh,3000);</script>`);
  } catch (error) {
    res.statusCode = 500; res.end(JSON.stringify({ error: error.message }));
  }
});
try {
  await browser.launch();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const page = await browser.context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button', { name: '🔗 GERAR LINK', exact: true }).click();
  console.log('BOTAO_GERAR_LINK: OK. Aguardando geração MANUAL na janela do marketplace.');
  const outcome = await completed;
  if (!page.isClosed()) await page.reload();
  if (outcome.success) {
    await page.getByRole('button', { name: '🎬 GERAR CRIATIVO', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '🎬 GERAR CRIATIVO', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '🚀 PUBLICAR AGORA', exact: true }).isDisabled(), true);
  }
  const final = await flow.getRequest(request.id);
  console.log(JSON.stringify({ outcome, generatorOpened: !!final.metadata.generatorOpenedAt,
    generatorReached: final.metadata.generatorReached,
    intervention: final.metadata.interventionRequired, step: final.metadata.step }));
} finally {
  server.close();
  await browser.close();
}
