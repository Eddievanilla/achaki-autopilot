import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import handler from '../api/dashboard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function runStage1Test() {
  console.log('\n===============================================================');
  console.log('  🧪 TESTE OBRIGATÓRIO: ETAPA 1 — REVISÃO VISUAL DO CRIATIVO');
  console.log('===============================================================\n');

  // 1. Inicia um servidor HTTP local simulando Vercel (serve public/index.html e /api/dashboard)
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost:3456');

    if (url.pathname === '/api/dashboard') {
      const mockReq = { method: req.method, query: Object.fromEntries(url.searchParams) };
      const mockRes = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        setHeader(name, val) { res.setHeader(name, val); },
        json(data) {
          res.writeHead(this.statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        }
      };
      return handler(mockReq, mockRes);
    }

    // Serve public static files
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

  await new Promise(resolve => server.listen(3456, resolve));
  console.log('✓ Servidor local rodando em http://localhost:3456');

  // 2. Inicia o browser Playwright
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('   [PAGE LOG]', msg.text()));
  page.on('pageerror', err => console.error('   [PAGE ERROR]', err.message));

  let openedNewTabUrl = null;
  context.on('page', (newPage) => {
    openedNewTabUrl = newPage.url();
  });

  console.log('1️⃣ Navegando para http://localhost:3456...');
  await page.goto('http://localhost:3456', { waitUntil: 'networkidle' });

  // 3. Aguarda carregamento do dashboard e da intervenção CREATIVE_REVIEW
  console.log('2️⃣ Aguardando carregamento dos dados reais do dashboard...');
  await page.waitForTimeout(2000);

  // Verifica cards de intervenção existentes
  const interventionBanners = await page.$$('.intervention-banner');
  console.log(`   Intervenções carregadas na UI: ${interventionBanners.length}`);

  // Localiza o botão "Revisar Criativo 9:16"
  const reviewBtn = await page.$('button:has-text("Revisar Criativo 9:16")');
  if (!reviewBtn) {
    throw new Error('Botão "Revisar Criativo 9:16" não foi encontrado na interface.');
  }
  const btnText = (await reviewBtn.textContent()).trim();
  console.log(`   ✓ Botão encontrado: "${btnText}"`);

  // 4. Clica no botão "Revisar Criativo 9:16"
  console.log('3️⃣ Clicando no botão "Revisar Criativo 9:16"...');
  await reviewBtn.click();
  await page.waitForTimeout(1000);

  // 5. Verifica se o modal abriu
  console.log('4️⃣ Inspecionando estado do Modal de Revisão...');
  const modal = await page.$('#creativeVideoPlayerModal');
  const isModalOpen = await modal.evaluate(el => el.classList.contains('open'));
  console.log(`   Modal aberto (classe 'open'): ${isModalOpen ? 'SIM' : 'NÃO'}`);

  // 6. Inspeciona o elemento de vídeo 9:16
  const videoEl = await page.$('#playerVideoEl');
  const videoSrc = await videoEl.evaluate(el => el.src || el.currentSrc);
  console.log(`   URL do vídeo carregado no Player: ${videoSrc}`);

  // 7. Inspeciona o título do produto exibido no modal
  const titleEl = await page.$('#playerProductTitle');
  const productTitle = (await titleEl.textContent()).trim();
  console.log(`   Nome do produto no modal: "${productTitle}"`);

  // 8. Inspeciona os três botões no modal
  const btnRecusar = await page.$('#playerActionButtons button:has-text("RECUSAR")');
  const btnRefazer = await page.$('#playerActionButtons button:has-text("REFAZER")');
  const btnAprovar = await page.$('#playerActionButtons button:has-text("APROVAR")');

  const buttonsOk = Boolean(btnRecusar && btnRefazer && btnAprovar);
  console.log(`   Botões [❌ RECUSAR], [♻️ REFAZER], [✅ APROVAR] presentes: ${buttonsOk ? 'OK' : 'ERRO'}`);

  // 9. Confirma que NENHUM link de marketplace foi aberto
  const marketplaceOpened = openedNewTabUrl !== null && openedNewTabUrl.includes('mercadolivre.com');
  console.log(`   Anúncio do Marketplace aberto em nova aba: ${marketplaceOpened ? 'SIM' : 'NÃO'}`);

  const isRealMp4 = Boolean(videoSrc && videoSrc.includes('final.mp4'));
  const isCorrectCreative = Boolean(videoSrc && videoSrc.includes('e1186171-6880-4c73-8d18-d0cb9116a4a7'));

  await browser.close();
  server.close();

  console.log('\n===============================================================');
  console.log('  RESULTADOS ETAPA 1');
  console.log('===============================================================');
  console.log(`MODAL: ${isModalOpen ? 'OK' : 'ERRO'}`);
  console.log(`VÍDEO REAL CARREGADO: ${isRealMp4 ? 'SIM' : 'NÃO'}`);
  console.log(`VÍDEO CORRESPONDE AO CRIATIVO: ${isCorrectCreative ? 'SIM' : 'NÃO'}`);
  console.log(`BOTÕES RECUSAR/REFAZER/APROVAR: ${buttonsOk ? 'OK' : 'ERRO'}`);
  console.log(`ANÚNCIO DO MARKETPLACE ABERTO: ${marketplaceOpened ? 'SIM' : 'NÃO'}`);
  console.log('===============================================================\n');
}

runStage1Test().catch((err) => {
  console.error('❌ Erro no teste da Etapa 1:', err);
  process.exit(1);
});
