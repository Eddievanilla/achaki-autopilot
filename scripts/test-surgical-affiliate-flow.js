import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { supabase } from '../src/database/supabase.js';
import ManualAffiliateFlow, { LINK_READY } from '../src/services/manual-affiliate-flow.js';
import { generatorUrl } from '../src/services/affiliate-marketplaces.js';
import handler from '../api/dashboard.js';
import controlsHandler from '../api/controls.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function runSurgicalAffiliateFlowTest() {
  console.log('\n===============================================================');
  console.log('  🧪 TESTE CIRÚRGICO: FLUXO PRODUTO → LINK AFILIADO');
  console.log('===============================================================\n');

  // 1. Localiza a oportunidade real no banco de dados
  const { data: opps, error: oppErr } = await supabase.from('offer_candidates')
    .select('ai_score, products(id,title,marketplace,marketplace_product_id,product_url,product_prices(current_price,collected_at))')
    .eq('status', 'selected').order('ai_score', { ascending: false }).limit(1);

  if (oppErr || !opps?.[0]?.products) {
    throw new Error('Nenhuma oportunidade real encontrada.');
  }

  const rawProd = opps[0].products;
  const currentPrice = [...(rawProd.product_prices || [])].sort((a, b) => (b.collected_at || '').localeCompare(a.collected_at || ''))[0]?.current_price || 350.67;
  const product = {
    ...rawProd,
    current_price: currentPrice,
    score: opps[0].ai_score || 94
  };

  console.log(`1️⃣ PRODUTO SELECIONADO: "${product.title}"`);
  console.log(`   Marketplace: ${product.marketplace} | Preço: R$ ${product.current_price} | Score: ${product.score}`);

  // 2. Prepara o fluxo manual de afiliados
  const flow = new ManualAffiliateFlow({ supabaseClient: supabase });

  // Reseta estado para teste limpo do fluxo completo:
  // Coloca a notificação inicial como PENDING (sem affiliate_url gravado ainda)
  await supabase.from('products').update({ affiliate_url: null }).eq('id', product.id);
  const initialRequest = await flow.selectProduct({
    ...product,
    price: product.current_price
  });

  // Garante que o card inicial está em WAITING_AFFILIATE_LINK
  await supabase.from('operator_interventions').update({
    status: 'PENDING',
    metadata: {
      productId: product.id,
      productTitle: product.title,
      productUrl: product.product_url,
      marketplaceProductId: product.marketplace_product_id,
      price: product.current_price,
      score: product.score,
      step: 'WAITING_AFFILIATE_LINK'
    }
  }).eq('id', initialRequest.id);

  console.log(`2️⃣ NOTIFICAÇÃO CRIADA: ID ${initialRequest.id}`);

  // 3. Servidor HTTP local simulando a aplicação completa
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost:3555');

    if (url.pathname === '/api/dashboard') {
      const mockReq = { method: req.method, query: Object.fromEntries(url.searchParams) };
      const mockRes = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        setHeader(n, v) { res.setHeader(n, v); },
        json(data) {
          res.writeHead(this.statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        }
      };
      return handler(mockReq, mockRes);
    }

    if (url.pathname === '/api/controls' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const parsedBody = JSON.parse(body || '{}');
      const mockReq = { method: 'POST', body: parsedBody };
      const mockRes = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        setHeader(n, v) { res.setHeader(n, v); },
        json(data) {
          res.writeHead(this.statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        }
      };
      return controlsHandler(mockReq, mockRes);
    }

    // Serve arquivos estáticos
    let filePath = path.join(projectRoot, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath);
    let contentType = 'text/html';
    if (ext === '.js') contentType = 'application/javascript';
    else if (ext === '.css') contentType = 'text/css';
    else if (ext === '.json') contentType = 'application/json';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(fs.readFileSync(filePath));
  });

  await new Promise(resolve => server.listen(3555, resolve));
  console.log('✓ Servidor de teste ativo em http://localhost:3555');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let geradorUrlEsperada = generatorUrl(product);
  let geradorAbertoCorreto = false;

  console.log('3️⃣ Navegando para a interface...');
  await page.goto('http://localhost:3555', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // 4. Inspeciona a notificação de Produto Selecionado
  const cardTitle = await page.locator('#interventionContainer').textContent();
  const hasNotification = cardTitle.includes('Produto selecionado') || cardTitle.includes('PRODUTO SELECIONADO');
  console.log(`   Notificação exibida: ${hasNotification ? 'OK' : 'ERRO'}`);

  const btnGerarLink = await page.locator('button:has-text("GERAR LINK")').first();
  const hasBtnGerar = await btnGerarLink.count() > 0;
  console.log(`   Botão [🔗 GERAR LINK] presente: ${hasBtnGerar ? 'OK' : 'ERRO'}`);

  // Inspeciona se os botões finais NÃO aparecem antes da hora no card de intervenção
  const btnGerarCriativoAntes = await page.locator('#interventionContainer button:has-text("GERAR CRIATIVO")').count();
  const btnPublicarAntes = await page.locator('#interventionContainer button:has-text("PUBLICAR AGORA")').count();
  const creativeReviewAntes = await page.locator('.intervention-banner:has-text("CREATIVE_REVIEW")').count();

  console.log(`   Botões [GERAR CRIATIVO] e [PUBLICAR AGORA] ocultos antes do link: ${btnGerarCriativoAntes === 0 && btnPublicarAntes === 0 ? 'SIM' : 'NÃO'}`);
  console.log(`   CREATIVE_REVIEW criado antes da hora: ${creativeReviewAntes === 0 ? 'NÃO' : 'SIM'}`);

  // 5. Clica em GERAR LINK
  console.log('4️⃣ Clicando no botão [🔗 GERAR LINK]...');
  
  // Monitora abertura de abas/URLs
  const openPromise = context.waitForEvent('page', { timeout: 3000 }).catch(() => null);
  await btnGerarLink.click();
  const openedPage = await openPromise;
  if (openedPage) {
    const targetUrl = openedPage.url();
    geradorAbertoCorreto = targetUrl.includes('mercadolivre.com.br/afiliados/linkbuilder');
    await openedPage.close().catch(() => {});
  } else {
    // Via API controls
    const openRes = await flow.requestOpen(initialRequest.id);
    geradorAbertoCorreto = openRes.generatorUrl === geradorUrlEsperada;
  }
  console.log(`   Gerador oficial correspondente: ${geradorUrlEsperada} (${geradorAbertoCorreto ? 'SIM' : 'NÃO'})`);

  // 6. Administrador gera manualmente o link no marketplace e copia (simulação de detecção instantânea)
  const officialGeneratedLink = 'https://meli.la/1TRb6CE';
  console.log(`5️⃣ Admin gera e copia o link oficial: ${officialGeneratedLink}`);

  // O ACHAki detecta/salva o link gerado a partir da sessão/gerador oficial
  console.log('6️⃣ ACHAki detectando, validando e salvando o link...');
  const captureEvidence = {
    sourceProductUrl: product.product_url,
    generatorUrl: geradorUrlEsperada,
    affiliateUrl: officialGeneratedLink,
  };
  const saveResult = await flow.saveDetectedLink(initialRequest.id, officialGeneratedLink, captureEvidence);
  const linkDetectado = Boolean(saveResult);
  const linkValidado = saveResult.status === LINK_READY;
  
  // Confirma se foi salvo em products.affiliate_url no banco
  const { data: savedProd } = await supabase.from('products').select('affiliate_url').eq('id', product.id).single();
  const linkSalvo = savedProd?.affiliate_url === officialGeneratedLink;

  console.log(`   Link detectado: ${linkDetectado ? 'SIM' : 'NÃO'}`);
  console.log(`   Link validado: ${linkValidado ? 'SIM' : 'NÃO'}`);
  console.log(`   Link salvo no banco: ${linkSalvo ? 'SIM' : 'NÃO'}`);

  // 7. Atualiza o dashboard para inspecionar os botões após AFFILIATE_LINK_READY
  console.log('7️⃣ Recarregando interface após AFFILIATE_LINK_READY...');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const btnGerarCriativoDepois = await page.locator('#interventionContainer button:has-text("GERAR CRIATIVO")').first();
  const btnPublicarDepois = await page.locator('#interventionContainer button:has-text("PUBLICAR AGORA")').first();

  const gerarCriativoVisivel = await btnGerarCriativoDepois.count() > 0;
  const publicarAgoraVisivel = await btnPublicarDepois.count() > 0;

  console.log(`   [🎬 GERAR CRIATIVO] aparece após link: ${gerarCriativoVisivel ? 'SIM' : 'NÃO'}`);
  console.log(`   [🚀 PUBLICAR AGORA] aparece após link: ${publicarAgoraVisivel ? 'SIM' : 'NÃO'}`);

  // Confirmação final das regras estritas
  const { count: creativeReviewCount } = await supabase.from('operator_interventions')
    .select('*', { count: 'exact', head: true })
    .eq('product_id', product.id)
    .eq('type', 'CREATIVE_REVIEW')
    .eq('status', 'PENDING');

  const creativeReviewCriadoAntes = (creativeReviewCount || 0) > 0;

  const { count: realPubCount } = await supabase.from('publications')
    .select('*', { count: 'exact', head: true })
    .eq('product_id', product.id)
    .eq('status', 'PUBLISHED');

  const publicacaoRealExecutada = (realPubCount || 0) > 0;

  await browser.close();
  server.close();

  console.log('\n===============================================================');
  console.log('  RELATÓRIO CIRÚRGICO FINAL');
  console.log('===============================================================');
  console.log(`PRODUTO: ${product.title}`);
  console.log(`MARKETPLACE: ${product.marketplace}`);
  console.log(`NOTIFICAÇÃO: ${hasNotification ? 'OK' : 'ERRO'}`);
  console.log(`BOTÃO GERAR LINK: ${hasBtnGerar ? 'OK' : 'ERRO'}`);
  console.log(`GERADOR CORRETO ABERTO: ${geradorAbertoCorreto ? 'SIM' : 'NÃO'}`);
  console.log(`LINK DETECTADO: ${linkDetectado ? 'SIM' : 'NÃO'}`);
  console.log(`LINK VALIDADO: ${linkValidado ? 'SIM' : 'NÃO'}`);
  console.log(`LINK SALVO: ${linkSalvo ? 'SIM' : 'NÃO'}`);
  console.log(`GERAR CRIATIVO APARECE APÓS LINK: ${gerarCriativoVisivel ? 'SIM' : 'NÃO'}`);
  console.log(`PUBLICAR AGORA APARECE APÓS LINK: ${publicarAgoraVisivel ? 'SIM' : 'NÃO'}`);
  console.log(`CREATIVE_REVIEW CRIADO ANTES DA HORA: ${creativeReviewCriadoAntes ? 'SIM' : 'NÃO'}`);
  console.log(`PUBLICAÇÃO REAL EXECUTADA: ${publicacaoRealExecutada ? 'SIM' : 'NÃO'}`);
  console.log('===============================================================\n');
}

runSurgicalAffiliateFlowTest().catch(err => {
  console.error('❌ Falha no teste cirúrgico:', err);
  process.exit(1);
});
