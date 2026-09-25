import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
import ManualAffiliateFlow, { LINK_READY } from '../src/services/manual-affiliate-flow.js';
import AffiliateLinkValidator from '../src/services/affiliate-link-validator.js';
import PublicationOrchestrator from '../src/services/publication-orchestrator.js';
import { generatorUrl } from '../src/services/affiliate-marketplaces.js';

// Isolated database: any attempt to create a creative/publication fails the test.
function database(products) {
  const rows = { products: structuredClone(products), operator_interventions: [], robot_commands: [], affiliate_link_events: [] };
  const db = { rows, failTable: null, from(table) {
    assert.ok(table in rows, `Unexpected side effect: ${table}`);
    let op = 'select', payload, one = false, filters = [], limit = Infinity;
    const q = {
      select() { return q; }, eq(key, val) { filters.push(row => row[key] === val); return q; },
      in(key, vals) { filters.push(row => vals.includes(row[key])); return q; },
      filter(key, _operator, val) { filters.push(row => row.metadata?.[key.split('->>')[1]] === val); return q; },
      or(expression) { const val = expression.split('.eq.')[1].split(',')[0]; filters.push(row => row.product_id === val || row.metadata?.productId === val); return q; },
      order() { return q; }, limit(n) { limit = n; return q; },
      single() { one = true; return q; }, maybeSingle() { one = true; return q; },
      insert(value) { op = 'insert'; payload = structuredClone(value); return q; },
      update(value) { op = 'update'; payload = structuredClone(value); return q; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (db.failTable === table && op !== 'select') return { data: null, error: { message: 'Storage unavailable' } };
          let result = rows[table].filter(row => filters.every(f => f(row))).slice(0, limit);
          if (op === 'insert') {
            if (payload.id && rows[table].some(row => row.id === payload.id)) return { error: { code: '23505' }, data: null };
            payload.id ||= `${table}-${rows[table].length}`;
            rows[table].push(payload); result = [payload];
          }
          if (op === 'update') result.forEach(row => Object.assign(row, payload));
          return { data: structuredClone(one ? result[0] : result), error: null };
        }).then(resolve, reject);
      },
    };
    return q;
  } };
  return db;
}

const product = { id: 'product-1', title: 'Produto de teste', marketplace: 'mercadolivre',
  marketplace_product_id: 'MLB4817578135', product_url: 'https://produto.mercadolivre.com.br/MLB-4817578135',
  current_price: 350.67, score: 94 };
const link = 'https://meli.la/testlink';
const response = (url, status = 200) => ({ ok: status === 200, status,
  headers: { get: () => url }, body: { cancel: async () => {} } });
function fixture(products = [product]) {
  const db = database(products);
  const validator = new AffiliateLinkValidator({ supabaseClient: db, fetchImpl: async url =>
    url === link ? response(product.product_url, 302) : response(null) });
  return { db, validator, flow: new ManualAffiliateFlow({ supabaseClient: db, validator }) };
}
const window = {};
vm.runInNewContext(fs.readFileSync(new URL('../public/affiliate-flow-ui.js', import.meta.url), 'utf8'),
  { window, document: { addEventListener() {} } });

test('selected product -> one notification -> generator -> captured/validated/saved -> inert buttons', async () => {
  const { db, flow } = fixture();
  const requests = await Promise.all([flow.selectProduct(product), flow.selectProduct(product)]);
  assert.equal(requests[0].id, requests[1].id);
  assert.equal(db.rows.operator_interventions.length, 1);
  const request = requests[0];
  let html = window.renderAffiliateLinkCard(request);
  assert.match(html, /🛒 Produto selecionado/);
  assert.match(html, /🔗 GERAR LINK/);
  assert.doesNotMatch(html, /GERAR CRIATIVO|PUBLICAR AGORA|SECURITY_CHALLENGE|LOGIN/);
  await flow.requestOpen(request.id);
  await flow.requestOpen(request.id);
  assert.equal(db.rows.robot_commands.length, 1);
  assert.equal(db.rows.robot_commands[0].command, 'OPEN_AFFILIATE_GENERATOR');

  // A fixture stands in for the administrator's generated output. No generation automation.
  let opened = 'about:blank', navigated = false;
  const page = { on() {}, off() {}, goto: async url => { opened = url; }, bringToFront: async () => {},
    isClosed: () => false, url: () => opened,
    locator: () => ({ count: async () => 0, evaluateAll: async () => {
      if (!navigated) { navigated = true; throw new Error('Execution context was destroyed, most likely because of a navigation'); }
      return [link];
    } }), waitForTimeout: async () => {} };
  const result = await flow.captureInSession(request.id, { context: { pages: () => [], newPage: async () => page } });
  assert.equal(opened, generatorUrl(product));
  assert.equal(result.status, LINK_READY);
  assert.equal(db.rows.products[0].affiliate_url, link);
  const ready = await flow.getRequest(request.id);
  html = window.renderAffiliateLinkCard(ready);
  assert.match(html, /disabled>🎬 GERAR CRIATIVO/);
  assert.match(html, /disabled>🚀 PUBLICAR AGORA/);
  assert.doesNotMatch(html, /data-affiliate-open=/);
  await flow.selectProduct(product);
  assert.equal(db.rows.operator_interventions.length, 1);
  assert.equal(db.rows.operator_interventions[0].metadata.step, LINK_READY);
});

test('separate products do not share a card; existing pending request is reused', async () => {
  const other = { ...product, id: 'product-2' };
  const { db, flow } = fixture([product, other]);
  db.rows.operator_interventions.push({ id: 'legacy-request', type: 'AFFILIATE_LINK_REQUIRED', status: 'PENDING', metadata: { productId: product.id } });
  assert.equal((await flow.selectProduct(product)).id, 'legacy-request');
  assert.notEqual((await flow.selectProduct(other)).id, 'legacy-request');
  assert.equal(db.rows.operator_interventions.length, 2);
});

test('ordinary, spoofed, wrong-marketplace and wrong-product links never become ready', async () => {
  const { flow, db, validator } = fixture();
  const request = await flow.selectProduct(product);
  for (const invalid of [product.product_url, 'https://evil.example/meli.la/abc', 'https://meli.la.evil.example/a',
    'https://meli.la@evil.example/a', 'https://meli.la/', 'http://meli.la/abc', 'https://amzn.to/abc']) {
    assert.equal((await flow.saveDetectedLink(request.id, invalid)).success, false, invalid);
  }
  validator.fetch = async url => url === link ? response('https://produto.mercadolivre.com.br/MLB-999999', 302) : response(null);
  assert.equal((await flow.saveDetectedLink(request.id, link)).status, 'PRODUCT_MISMATCH');
  validator.fetch = async () => { throw new Error('challenge'); };
  assert.equal((await flow.saveDetectedLink(request.id, link)).status, 'UNVERIFIED');
  assert.equal(db.rows.products[0].affiliate_url, undefined);
  assert.equal(db.rows.operator_interventions[0].metadata.step, 'WAITING_AFFILIATE_LINK');
});

test('database failure does not expose buttons or mark ready; retry finishes the save', async () => {
  for (const table of ['products', 'operator_interventions']) {
    const { flow, db } = fixture();
    const request = await flow.selectProduct(product);
    db.failTable = table;
    await assert.rejects(flow.saveDetectedLink(request.id, link), /Storage unavailable/);
    assert.doesNotMatch(window.renderAffiliateLinkCard(await flow.getRequest(request.id)), /GERAR CRIATIVO|PUBLICAR AGORA/);
    db.failTable = null;
    assert.equal((await flow.saveDetectedLink(request.id, link)).status, LINK_READY);
  }
});

test('Shopee and Amazon use their official generator and reject ordinary product links', async () => {
  const { validator } = fixture();
  for (const [marketplace, url, expectedGenerator] of [
    ['shopee', 'https://shopee.com.br/product/123/456', 'https://affiliate.shopee.com.br/offer/custom_link'],
    ['amazon', 'https://www.amazon.com.br/dp/B012345678', 'https://www.amazon.com.br/dp/B012345678'],
  ]) {
    const item = { ...product, marketplace, product_url: url };
    assert.equal(generatorUrl(item), expectedGenerator);
    assert.equal((await validator.validateLink({ rawLink: url, expectedProduct: item })).valid, false);
  }
});

test('official response tied to exactly this product can confirm a manually generated ML link', async () => {
  const { flow, db, validator } = fixture();
  validator.fetch = async () => { throw new Error('No redirect evidence'); };
  const request = await flow.selectProduct(product);
  let listener, opened = 'about:blank';
  const page = { on: (_event, cb) => { listener = cb; }, off() {},
    goto: async url => { opened = url; await listener({ url: () => 'https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink',
      ok: () => true, request: () => ({ postDataJSON: () => ({ urls: [product.product_url] }) }),
      json: async () => ({ urls: [{ short_url: link }] }) }); },
    bringToFront: async () => {}, isClosed: () => false, url: () => opened,
    locator: () => ({ count: async () => 0, evaluateAll: async () => [] }), waitForTimeout: async () => {} };
  assert.equal((await flow.captureInSession(request.id, { context: { pages: () => [], newPage: async () => page } })).status, LINK_READY);
  assert.equal(db.rows.products[0].affiliate_url, link);
});

test('an actual login redirect stays on the same pending card without generating or saving', async () => {
  const { flow, db } = fixture();
  const request = await flow.selectProduct(product);
  let closed = false;
  const page = { on() {}, off() {}, goto: async () => {}, bringToFront: async () => {},
    isClosed: () => closed, url: () => 'https://www.mercadolivre.com.br/login',
    locator: () => { throw new Error('Must not interact with login'); },
    waitForTimeout: async () => { assert.equal(db.rows.operator_interventions[0].metadata.interventionRequired, 'LOGIN'); closed = true; } };
  const result = await flow.captureInSession(request.id, { context: { pages: () => [], newPage: async () => page } });
  assert.equal(result.status, 'WAITING_AFFILIATE_LINK');
  assert.equal(db.rows.products[0].affiliate_url, undefined);
  assert.equal(db.rows.operator_interventions.length, 1);
});

test('closing the integrated browser leaves the same request available for retry', async () => {
  const { flow, db } = fixture();
  const request = await flow.selectProduct(product);
  let closed = false;
  const page = { on() {}, off() {}, goto: async () => {}, bringToFront: async () => {},
    isClosed: () => closed, url: () => 'https://www.mercadolivre.com.br/login',
    waitForTimeout: async () => { closed = true; throw new Error('Target page, context or browser has been closed'); } };
  const result = await flow.captureInSession(request.id, { context: { pages: () => [], newPage: async () => page } });
  assert.equal(result.status, 'WAITING_AFFILIATE_LINK');
  assert.equal(db.rows.operator_interventions[0].metadata.captureStatus, 'CLOSED');
  assert.equal((await flow.selectProduct(product)).id, request.id);
  assert.equal(db.rows.products[0].affiliate_url, undefined);
});

test('orchestrator entry and legacy link submission cannot create a creative or publish', async () => {
  const { db, validator } = fixture();
  const orchestrator = Object.create(PublicationOrchestrator.prototype);
  orchestrator.supabase = db;
  orchestrator.linkValidator = validator;
  orchestrator.creativeAgent = { produceCreative() { assert.fail('Creative generation is not authorized'); } };
  orchestrator.fbPublisher = { publishPost() { assert.fail('Publishing is not authorized'); } };
  const selected = await orchestrator.startPipelineForProduct({ product });
  assert.equal(selected.status, 'WAITING_AFFILIATE_LINK');
  db.rows.publication_approvals = [{ id: 'existing-approval', product_id: product.id, status: 'WAITING_AFFILIATE_LINK' }];
  const result = await orchestrator.submitAndValidateAffiliateLink({ approvalId: 'existing-approval', rawLink: link, dryRun: false });
  assert.equal(result.status, LINK_READY);
  assert.equal(db.rows.publication_approvals[0].status, LINK_READY);
  assert.equal(db.rows.operator_interventions.length, 1);
});

test('prefills the authenticated generator once, reuses its tab and waits for the admin result', async () => {
  const { db, flow } = fixture();
  const request = await flow.selectProduct(product);
  let value = '', fills = 0, adminGenerated = false, polls = 0;
  const input = { count: async () => 1, isVisible: async () => true, isEditable: async () => true,
    fill: async url => { value = url; fills++; }, inputValue: async () => value };
  const page = { on() {}, off() {}, url: () => generatorUrl(product), isClosed: () => false,
    goto() { assert.fail('An authenticated generator tab must not be reloaded'); },
    bringToFront: async () => {}, locator: selector => {
      if (selector === '#url-0') return input;
      assert.equal(selector, 'input, textarea, a');
      return { evaluateAll: async () => adminGenerated ? [value, link] : [value] };
    }, waitForTimeout: async () => {
      assert.equal(value, product.product_url);
      assert.equal(db.rows.products[0].affiliate_url, undefined);
      assert.equal(db.rows.operator_interventions[0].metadata.captureStatus, 'WAITING_ADMIN_GENERATE');
      if (++polls === 2) adminGenerated = true;
    } };
  const result = await flow.captureInSession(request.id, { context: {
    pages: () => [page], newPage() { assert.fail('Must reuse the open session tab'); },
  } });
  assert.equal(result.status, LINK_READY);
  assert.equal(fills, 1);
  assert.equal(db.rows.products[0].affiliate_url, link);
});

test('prefill never writes to a login, CAPTCHA, another origin or ambiguous input', async () => {
  const { flow } = fixture();
  for (const url of ['https://www.mercadolivre.com.br/login', 'https://www.mercadolivre.com.br/checkpoint',
    'https://example.com/afiliados/linkbuilder']) {
    const page = { url: () => url, locator() { assert.fail('Must not interact with authentication or another origin'); } };
    assert.equal(await flow.prepareGenerator(page, product), false);
  }
  assert.equal(await flow.prepareGenerator({ url: () => generatorUrl(product), locator: () => ({ count: async () => 2 }) }, product), false);
});
