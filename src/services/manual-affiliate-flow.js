import crypto from 'node:crypto';
import { supabase } from '../database/supabase.js';
import AffiliateLinkValidator from './affiliate-link-validator.js';
import { generatorUrl, normalizeMarketplace, affiliatePattern, officialHost } from './affiliate-marketplaces.js';

export const LINK_READY = 'AFFILIATE_LINK_READY';
const REQUEST_TYPE = 'AFFILIATE_LINK_REQUIRED';
function checked(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
function stableId(value) {
  const hex = crypto.createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export default class ManualAffiliateFlow {
  constructor({ supabaseClient = supabase, validator } = {}) {
    this.db = supabaseClient;
    this.validator = validator || new AffiliateLinkValidator({ supabaseClient });
  }

  async selectProduct(product) {
    if (!product.id || !product.product_url) throw new Error('Produto persistido e URL obrigatórios.');
    const marketplace = normalizeMarketplace(product.marketplace);
    const target = generatorUrl({ ...product, marketplace });
    const existing = checked(await this.db.from('operator_interventions').select('*')
      .eq('type', REQUEST_TYPE).or(`product_id.eq.${product.id},metadata->>productId.eq.${product.id}`)
      .order('created_at', { ascending: true }));
    const record = existing.find(row => row.status === 'PENDING') || existing[0];
    // Preserve a validated ready card, including across selection retries.
    if (record?.metadata?.step === LINK_READY) return record;
    const id = record?.id || stableId(`affiliate-link:${product.id}`);
    const payload = {
      id, product_id: product.id, type: REQUEST_TYPE, marketplace, status: 'PENDING', resolved_at: null,
      title: '🛒 Produto selecionado',
      message: `${product.title}\n${marketplace}\nPreço: R$ ${Number(product.current_price ?? product.price).toFixed(2)}\nScore: ${product.score ?? product.ai_score ?? 'Não informado'}`,
      target_url: target, action_label: '🔗 GERAR LINK',
      metadata: { ...record?.metadata, productId: product.id, productTitle: product.title,
        productUrl: product.product_url, marketplaceProductId: product.marketplace_product_id,
        price: product.current_price ?? product.price, score: product.score ?? product.ai_score ?? null,
        step: 'WAITING_AFFILIATE_LINK' },
    };
    if (record) {
      checked(await this.db.from('operator_interventions').update(payload).eq('id', id));
      // Consolidate legacy duplicates into the same visible card.
      for (const duplicate of existing.filter(row => row.id !== id && row.status === 'PENDING')) {
        checked(await this.db.from('operator_interventions').update({ status: 'RESOLVED', resolved_at: new Date().toISOString() }).eq('id', duplicate.id));
      }
    } else {
      const result = await this.db.from('operator_interventions').insert(payload);
      if (result.error?.code === '23505') return this.getRequest(id);
      checked(result);
    }
    return payload;
  }

  async getRequest(id) {
    const record = checked(await this.db.from('operator_interventions').select('*').eq('id', id).single());
    if (!record || record.type !== REQUEST_TYPE) throw new Error('Solicitação de link não encontrada.');
    return record;
  }

  async getProduct(record) {
    const product = checked(await this.db.from('products').select('*').eq('id', record.metadata.productId).single());
    if (!product) throw new Error('Produto não encontrado.');
    return { ...product, marketplace: normalizeMarketplace(product.marketplace) };
  }

  async requestOpen(id) {
    const record = await this.getRequest(id);
    if (record.metadata.step === LINK_READY) return { success: true, status: LINK_READY };
    if (record.status !== 'PENDING') throw new Error('Solicitação não está pendente.');
    const product = await this.getProduct(record);
    const target = generatorUrl(product);
    const pending = checked(await this.db.from('robot_commands').select('id').eq('command', 'OPEN_AFFILIATE_GENERATOR')
      .in('status', ['PENDING', 'CLAIMED', 'RUNNING']).filter('metadata->>interventionId', 'eq', id).limit(1));
    if (!pending.length) checked(await this.db.from('robot_commands').insert({
      command: 'OPEN_AFFILIATE_GENERATOR', status: 'PENDING', metadata: { interventionId: id },
    }));
    return { success: true, status: 'QUEUED', generatorUrl: target, productUrl: product.product_url,
      message: 'O ACHAki abrirá o gerador na sessão integrada e preencherá a URL. Clique apenas em Gerar no marketplace.' };
  }

  async prepareGenerator(page, product) {
    const expected = new URL(generatorUrl(product));
    const current = new URL(page.url());
    // Never fill a login, challenge or unrelated page, including redirects from the generator.
    if (current.origin !== expected.origin || current.pathname !== expected.pathname) return false;
    if (product.marketplace === 'amazon') return true; // SiteStripe uses the current product page.
    let input = product.marketplace === 'mercadolivre'
      ? page.locator('#url-0')
      : page.getByRole('textbox', { name: /URL|link original|link do produto/i });
    if (await input.count() !== 1 && product.marketplace === 'mercadolivre') {
      input = page.locator('textarea');
    }
    if (await input.count() !== 1 || !await input.isVisible() || !await input.isEditable()) return false;
    await input.fill(product.product_url, { timeout: 4000 });
    return await input.inputValue() === product.product_url;
  }

  async saveDetectedLink(id, rawLink, captureEvidence = null) {
    const now = new Date().toISOString();
    const record = await this.getRequest(id);
    const product = await this.getProduct(record);
    if (record.metadata.step === LINK_READY && record.metadata.affiliateLinkStatus === 'VERIFIED' &&
      record.metadata.savedAt && affiliatePattern(product.affiliate_url, product.marketplace) &&
      record.metadata.affiliateUrl === product.affiliate_url) {
      return { success: true, status: LINK_READY, affiliateUrl: product.affiliate_url };
    }
    if (record.status !== 'PENDING') throw new Error('Solicitação não está pendente.');
    const validation = await this.validator.validateLink({ rawLink, expectedProduct: product, captureEvidence });
    if (!validation.valid) return { success: false, status: validation.status, reason: validation.reason };
    const saved = checked(await this.db.from('products').update({ affiliate_url: validation.validatedUrl })
      .eq('id', product.id).select('id, affiliate_url').single());
    if (saved?.affiliate_url !== validation.validatedUrl) throw new Error('Gravação do link não confirmada.');
    checked(await this.db.from('operator_interventions').update({
      metadata: { ...record.metadata, step: LINK_READY, affiliateUrl: saved.affiliate_url,
        affiliateLinkStatus: 'VERIFIED', validatedAt: now, savedAt: now, captureStatus: 'COMPLETE',
        interventionRequired: null, captureError: null },
      message: 'Link afiliado validado e salvo.',
    }).eq('id', id));

    // Enfileira produção do vídeo vertical 9:16 na fábrica local (creative_jobs)
    try {
      const jobKey = `job_${product.id}_v1`;
      await this.db.from('creative_jobs').upsert({
        product_id: product.id,
        creative_version: 1,
        job_type: 'VIDEO_9_16',
        priority: 'HIGH',
        status: 'PENDING',
        prompt: product.title,
        aspect_ratio: '9:16',
        duration_target: 15,
        idempotency_key: jobKey,
        metadata: {
          productTitle: product.title,
          marketplace: product.marketplace,
          affiliateUrl: saved.affiliate_url,
          trigger: 'AFFILIATE_LINK_READY',
          enqueuedAt: now,
        }
      }, { onConflict: 'idempotency_key' });
    } catch (_) {
      // Ignora erro de duplicação
    }

    return { success: true, status: LINK_READY, affiliateUrl: saved.affiliate_url };
  }

  async captureInSession(id, browser, { timeoutMs = 15 * 60 * 1000, pollMs = 1500 } = {}) {
    let record = await this.getRequest(id);
    if (record.metadata.step === LINK_READY) return { success: true, status: LINK_READY };
    const product = await this.getProduct(record);
    const target = generatorUrl(product);
    // Reuse an existing generator tab in this integrated session when it is already open.
    const expectedTarget = new URL(target);
    const page = browser.context.pages().find(candidate => {
      try {
        const url = new URL(candidate.url());
        return !candidate.isClosed() && url.origin === expectedTarget.origin && url.pathname === expectedTarget.pathname;
      } catch { return false; }
    }) || await browser.context.newPage();
    checked(await this.db.from('operator_interventions').update({ metadata: { ...record.metadata,
      generatorOpenedAt: null, generatorReached: false, productUrlPreparedAt: null,
      interventionRequired: null, captureStatus: 'OPENING',
    } }).eq('id', id));
    const candidates = [];
    // Observe the official response to the ADMIN's click. Never call the generation API.
    const onResponse = async response => {
      try {
        const url = new URL(response.url());
        if (product.marketplace !== 'mercadolivre' || !officialHost(url.hostname, product.marketplace) ||
          url.pathname !== '/affiliate-program/api/v2/affiliates/createLink' || !response.ok()) return;
        const request = response.request().postDataJSON();
        if (request?.urls?.length !== 1 || request.urls[0] !== product.product_url) return;
        const data = await response.json();
        if (data.urls?.length !== 1) return;
        const link = data.urls[0].short_url;
        if (affiliatePattern(link, product.marketplace)) candidates.push({ link, evidence: {
          sourceProductUrl: request.urls[0], generatorUrl: target, affiliateUrl: link,
        } });
      } catch { /* An unrelated response is not proof of an affiliate link. */ }
    };
    page.on('response', onResponse);
    try {
      const existingUrl = new URL(page.url());
      if (existingUrl.origin !== expectedTarget.origin || existingUrl.pathname !== expectedTarget.pathname) {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }
      await page.bringToFront();
      const deadline = Date.now() + timeoutMs;
      const attempted = new Set();
      let prepared = false;
      let previousLinks = new Set();
      while (!page.isClosed() && Date.now() < deadline) {
        record = await this.getRequest(id);
        if (record.metadata.step === LINK_READY) return { success: true, status: LINK_READY };
        if (record.status !== 'PENDING') return { success: false, status: 'CANCELLED' };
        const current = new URL(page.url());
        if (officialHost(current.hostname, product.marketplace)) {
          const challenge = /\/(?:login|signin|ap\/signin)(?:\/|$)/i.test(current.pathname) ? 'LOGIN' :
            /\/(?:captcha|checkpoint|challenge|verification)(?:\/|$)/i.test(current.pathname) ? 'SECURITY_CHALLENGE' : null;
          const expectedGenerator = new URL(target);
          const reached = !challenge && current.origin === expectedGenerator.origin && current.pathname === expectedGenerator.pathname;
          if (record.metadata.interventionRequired !== challenge || record.metadata.generatorReached !== reached || !record.metadata.generatorOpenedAt) {
            checked(await this.db.from('operator_interventions').update({ metadata: { ...record.metadata,
              generatorOpenedAt: record.metadata.generatorOpenedAt || new Date().toISOString(),
              generatorReached: reached, interventionRequired: challenge, captureStatus: 'OBSERVING',
            } }).eq('id', id));
          }
          if (!challenge) {
            let values;
            try {
              if (reached && !prepared) {
                const previousValues = await page.locator('input, textarea, a').evaluateAll(elements =>
                  elements.map(el => el.value || el.href || '').filter(Boolean));
                prepared = await this.prepareGenerator(page, product);
                if (prepared) {
                  previousLinks = new Set(previousValues.filter(value => affiliatePattern(value, product.marketplace)));
                  record = await this.getRequest(id);
                  checked(await this.db.from('operator_interventions').update({ metadata: {
                    ...record.metadata, productUrlPreparedAt: new Date().toISOString(),
                    captureStatus: 'WAITING_ADMIN_GENERATE',
                  } }).eq('id', id));
                }
              }
              values = await page.locator('input, textarea, a').evaluateAll(elements =>
                elements.map(el => el.value || el.href || '').filter(Boolean));
            } catch (error) {
              // Logging in and generating a link can navigate while the DOM is being read.
              if (page.isClosed()) break;
              if (!/Execution context was destroyed|Cannot find context|navigation/i.test(error.message)) throw error;
              await page.waitForTimeout(pollMs);
              continue;
            }
            for (const value of values) {
              if (!previousLinks.has(value) && affiliatePattern(value, product.marketplace)) candidates.push({ link: value });
            }
            for (const candidate of candidates.splice(0)) {
              const key = `${candidate.link}:${!!candidate.evidence}`;
              if (attempted.has(key)) continue;
              attempted.add(key);
              const result = await this.saveDetectedLink(id, candidate.link, candidate.evidence);
              if (result.success) return result;
            }
          }
        }
        await page.waitForTimeout(pollMs);
      }
      record = await this.getRequest(id);
      checked(await this.db.from('operator_interventions').update({ metadata: { ...record.metadata,
        captureStatus: 'TIMED_OUT',
      } }).eq('id', id));
      return { success: false, status: 'WAITING_AFFILIATE_LINK' };
    } catch (error) {
      record = await this.getRequest(id);
      if (record.metadata.step !== LINK_READY) checked(await this.db.from('operator_interventions').update({
        metadata: { ...record.metadata, captureStatus: page.isClosed() ? 'CLOSED' : 'ERROR', captureError: error.message },
      }).eq('id', id));
      if (page.isClosed()) return { success: false, status: 'WAITING_AFFILIATE_LINK' };
      throw error;
    } finally {
      page.off('response', onResponse);
      // Session lifecycle belongs to the worker; no login/CAPTCHA/2FA interaction occurs here.
    }
  }
}
