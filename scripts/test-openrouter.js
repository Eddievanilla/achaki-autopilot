/**
 * ACHAki Autopilot — Teste OpenRouter (Fase 2)
 *
 * Envia produtos fictícios de exemplo ao OpenRouter e valida
 * que a integração com a API está funcionando corretamente.
 *
 * Dados de entrada: SOMENTE fictícios (fins de teste).
 * A resposta vem DIRETAMENTE da API — sem mock ou simulação.
 *
 * Uso:
 *   npm run test:openrouter
 */

import 'dotenv/config';
import OpenRouterAgent from '../src/agents/openrouter-agent.js';
import logger from '../src/utils/logger.js';

// ─── Dados fictícios de teste ──────────────────────────────────────────────────

const PRODUTOS_TESTE = [
  {
    id: 'A',
    name: 'Mini Aspirador Portátil USB',
    price: 39.90,
    stars: 4.7,
    sales: 8400,
  },
  {
    id: 'B',
    name: 'Air Fryer Digital 4L',
    price: 249.00,
    stars: 4.8,
    sales: 12000,
  },
  {
    id: 'C',
    name: 'Kit Ferramentas 72 peças',
    price: 89.00,
    stars: 4.9,
    sales: 3200,
  },
];

// ─── Helpers de exibição ───────────────────────────────────────────────────────

function printSection(title) {
  console.log('\n' + '─'.repeat(60));
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

function printJSON(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

// ─── Validações pré-execução ───────────────────────────────────────────────────

function validateEnv() {
  const key   = process.env.OPENROUTER_API_KEY   || '';
  const model = process.env.OPENROUTER_DECISION_MODEL || '';

  if (!key.trim()) {
    console.error('\n\x1b[33m[ACHAki] OPENROUTER_API_KEY não configurada.\x1b[0m');
    console.error('Insira sua chave no arquivo .env e execute novamente:');
    console.error('  npm run test:openrouter\n');
    process.exit(0); // saída limpa, não erro confuso
  }

  if (!model.trim()) {
    console.error('\n\x1b[33m[ACHAki] OPENROUTER_DECISION_MODEL não configurado.\x1b[0m');
    console.error('Defina o modelo no arquivo .env. Exemplos:');
    console.error('  OPENROUTER_DECISION_MODEL=openai/gpt-4o-mini');
    console.error('  OPENROUTER_DECISION_MODEL=google/gemini-flash-1.5');
    console.error('  OPENROUTER_DECISION_MODEL=meta-llama/llama-3.1-8b-instruct\n');
    process.exit(0);
  }
}

// ─── Teste principal ───────────────────────────────────────────────────────────

async function runTest() {
  console.log('\n\x1b[36m╔══════════════════════════════════════════════════════════╗');
  console.log('║     ACHAki Autopilot — Teste OpenRouter (Fase 2)         ║');
  console.log('╚══════════════════════════════════════════════════════════╝\x1b[0m\n');

  validateEnv();

  // Mostra configuração (SEM expor a chave)
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  const maskedKey = apiKey.slice(0, 6) + '...' + apiKey.slice(-4);
  console.log(`  API Key      : ${maskedKey}`);
  console.log(`  Decision     : ${process.env.OPENROUTER_DECISION_MODEL}`);
  console.log(`  Content      : ${process.env.OPENROUTER_CONTENT_MODEL || '(não configurado — não usado neste teste)'}`);
  console.log(`  Max Tokens D : ${process.env.OPENROUTER_MAX_TOKENS_DECISION || 1000}`);
  console.log(`  Timeout      : ${process.env.OPENROUTER_TIMEOUT_MS || 30000}ms`);
  console.log(`  Max Retries  : ${process.env.OPENROUTER_MAX_RETRIES || 2}`);

  const agent = new OpenRouterAgent();

  // ── Teste 1: selectBestOffers ──────────────────────────────────────────────

  printSection('TESTE 1 — selectBestOffers (decisão)');
  console.log('Produtos enviados:\n');
  printJSON(PRODUTOS_TESTE);

  console.log('\n\x1b[36mChamando OpenRouter API...\x1b[0m');

  let selectResult;
  try {
    selectResult = await agent.selectBestOffers(PRODUTOS_TESTE, 2);

    console.log('\n\x1b[32m✔ Resposta recebida:\x1b[0m\n');
    printJSON(selectResult);

    // Validação básica do schema esperado
    if (!Array.isArray(selectResult.selected)) {
      throw new Error('Campo "selected" ausente ou inválido na resposta.');
    }
    if (typeof selectResult.reasoning !== 'object') {
      throw new Error('Campo "reasoning" ausente ou inválido na resposta.');
    }

    console.log('\n\x1b[32m✔ Schema validado: { selected: [...], reasoning: {...} }\x1b[0m');

  } catch (err) {
    logger.captureError('test:openrouter:selectBestOffers', err);
    process.exitCode = 1;
    return;
  }

  // ── Resultado final ────────────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(60));
  console.log('\x1b[32m  ✔ FASE 2 — OPENROUTER FUNCIONANDO\x1b[0m');
  console.log('═'.repeat(60));
  console.log(`\n  Produtos selecionados: ${selectResult.selected.join(', ')}`);
  console.log('\n  Próximo passo:');
  console.log('  Configure OPENROUTER_CONTENT_MODEL e teste generatePost()');
  console.log();

  logger.info('Teste OpenRouter concluído com sucesso.');
}

// ─── Tratamento global de erros ───────────────────────────────────────────────

process.on('unhandledRejection', (reason) => {
  logger.error(
    'Rejeição não tratada',
    reason instanceof Error ? reason : new Error(String(reason))
  );
  process.exit(1);
});

runTest();
