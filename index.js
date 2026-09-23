/**
 * ACHAki Autopilot — Fase 1: Base do Operador Local
 *
 * Ponto de entrada do operador.
 * Esta fase valida que o browser Chromium é iniciado corretamente,
 * navega para uma URL e registra os eventos em log.
 *
 * Próximas fases adicionarão:
 *  - Agentes JEV/TypeSafe (src/agents/jev-agent.js)
 *  - Scrapers Shopee/ML   (src/marketplaces/)
 *  - Publicação Facebook  (src/publishers/facebook.js)
 *  - Histórico            (src/database/history.js)
 *
 * REGRAS DE SEGURANÇA PERMANENTES:
 *  - Nunca contornar CAPTCHA
 *  - Nunca burlar autenticação ou 2FA
 *  - Nunca executar compras ou movimentar dinheiro
 *  - Nunca evitar bloqueios de segurança
 */

import 'dotenv/config';
import BrowserManager from './src/browser/browser.js';
import logger from './src/utils/logger.js';

// ─── Constantes ────────────────────────────────────────────────────────────────

const FASE = 1;
const URL_TESTE = 'https://www.google.com';
const PAUSA_APOS_CARGA_MS = 5_000; // 5 segundos para observar o browser

// ─── Função principal ─────────────────────────────────────────────────────────

async function main() {
  logger.info('='.repeat(60));
  logger.info(`ACHAki Autopilot — Fase ${FASE} iniciando`);
  logger.info('='.repeat(60));

  const browser = new BrowserManager();

  try {
    // 1. Iniciar o browser
    await browser.launch();

    // 2. Abrir página
    await browser.openPage();

    // 3. Navegar para o Google
    await browser.navigate(URL_TESTE);

    // 4. Confirmações no console (critério de conclusão da Fase 1)
    console.log('\x1b[32m[ACHAki] Browser iniciado\x1b[0m');
    console.log('\x1b[32m[ACHAki] Google carregado com sucesso\x1b[0m');
    console.log('\x1b[32m[ACHAki] Fase 1 funcionando\x1b[0m\n');

    logger.info('[ACHAki] Navegação concluída com sucesso');
    logger.info(`Aguardando ${PAUSA_APOS_CARGA_MS / 1000}s antes de encerrar...`);

    // 5. Manter aberto para observação
    await browser.wait(PAUSA_APOS_CARGA_MS);

  } catch (error) {
    logger.captureError('main', error);
    process.exitCode = 1;
  } finally {
    // 6. Sempre fechar corretamente
    await browser.close();
    logger.info('='.repeat(60));
    logger.info('ACHAki Autopilot — Encerrado');
    logger.info('='.repeat(60));
  }
}

// ─── Tratamento de erros não capturados ───────────────────────────────────────

process.on('unhandledRejection', (reason, promise) => {
  logger.error(
    `Rejeição não tratada em: ${promise}`,
    reason instanceof Error ? reason : new Error(String(reason))
  );
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.captureError('uncaughtException', error);
  process.exit(1);
});

// ─── Execução ─────────────────────────────────────────────────────────────────

main();
