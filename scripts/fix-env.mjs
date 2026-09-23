/**
 * fix-env.mjs — Corrige o .env do achaki-autopilot.
 *
 * Problema: a OPENROUTER_API_KEY foi inserida como valor solto na linha 24
 * em vez de ser atribuída à variável OPENROUTER_API_KEY=.
 *
 * Este script:
 *  1. Lê o .env atual
 *  2. Detecta o valor solto que parece uma API key do OpenRouter (sk-or-v1-...)
 *  3. Atribui esse valor à variável OPENROUTER_API_KEY= (se ela estiver vazia)
 *  4. Remove a linha solta
 *  5. Configura os modelos e parâmetros escolhidos
 *  6. Salva o arquivo
 *
 * SEGURANÇA: A chave NUNCA é impressa no console ou em log.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH  = path.resolve(__dirname, '../.env');

const raw   = fs.readFileSync(ENV_PATH, 'utf8');
const lines = raw.split(/\r?\n/);

// ── 1. Detecta linha com valor solto (chave OpenRouter sem var=)
const KEY_PATTERN = /^sk-or-v1-[a-f0-9]+$/;
let   orphanKey   = '';
const cleanLines  = lines.filter(line => {
  if (KEY_PATTERN.test(line.trim())) {
    orphanKey = line.trim();
    return false; // remove a linha solta
  }
  return true;
});

if (!orphanKey) {
  console.log('[fix-env] Nenhuma chave solta detectada. Verificando OPENROUTER_API_KEY...');
} else {
  console.log('[fix-env] Chave solta detectada e removida da posição incorreta.');
}

// ── 2. Constrói o novo .env com todas as variáveis corretas
const newEnv = `# Variáveis de ambiente locais — gerado automaticamente
# NÃO versionar este arquivo!

# ─── Fase 1: Browser ────────────────────────────────────────
BROWSER_HEADLESS=false
BROWSER_PROFILE_PATH=./data/browser-profile
LOG_LEVEL=info

# ─── Fase 2: OpenRouter ─────────────────────────────────────
# A chave é lida daqui — nunca exposta em logs ou código
OPENROUTER_API_KEY=${orphanKey}

# Modelo para decisões: rankear produtos, selecionar ofertas, analisar desempenho
# Escolhido em 2026-09-23 | $0.03/$0.13 por 1M tokens | JSON estruturado ✓
OPENROUTER_DECISION_MODEL=qwen/qwen3.7-flash

# Modelo para geração de conteúdo: títulos, legendas, hashtags
# Escolhido em 2026-09-23 | $0.019/$0.03 por 1M tokens | JSON estruturado ✓
OPENROUTER_CONTENT_MODEL=mistralai/mistral-nemo

# Limites de tokens e comportamento
OPENROUTER_MAX_TOKENS_DECISION=1000
OPENROUTER_MAX_TOKENS_CONTENT=500
OPENROUTER_TIMEOUT_MS=30000
OPENROUTER_MAX_RETRIES=2
`;

fs.writeFileSync(ENV_PATH, newEnv, 'utf8');

// ── 3. Valida sem exibir a chave
const written = fs.readFileSync(ENV_PATH, 'utf8');
const hasKey  = written.includes('OPENROUTER_API_KEY=sk-or-v1-');
const hasDecision = written.includes('OPENROUTER_DECISION_MODEL=qwen/qwen3.7-flash');
const hasContent  = written.includes('OPENROUTER_CONTENT_MODEL=mistralai/mistral-nemo');

console.log('');
console.log('[fix-env] .env reescrito com sucesso.');
console.log(`[fix-env] OPENROUTER_API_KEY:       ${hasKey       ? 'CONFIGURADA' : 'NÃO CONFIGURADA'}`);
console.log(`[fix-env] OPENROUTER_DECISION_MODEL: ${hasDecision  ? 'qwen/qwen3.7-flash'          : 'VAZIO'}`);
console.log(`[fix-env] OPENROUTER_CONTENT_MODEL:  ${hasContent   ? 'mistralai/mistral-nemo'      : 'VAZIO'}`);
console.log('');
