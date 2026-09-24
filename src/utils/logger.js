/**
 * ACHAki Autopilot — Logger
 * 
 * Logger simples com suporte a níveis (info, warn, error, debug).
 * Grava no console e em arquivo logs/achaki.log.
 * 
 * Formato: [YYYY-MM-DD HH:MM:SS] [LEVEL] mensagem
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Caminho do arquivo de log
const LOG_DIR = path.resolve(__dirname, '../../logs');
const LOG_FILE = path.join(LOG_DIR, 'achaki.log');

// Garante que o diretório de logs existe (ignora em ambientes serverless como Vercel)
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch {
  // Read-only filesystem no Vercel/AWS Lambda — logs permanecem no stdout/console
}

/**
 * Formata a data/hora atual no padrão brasileiro.
 * @returns {string} Ex.: "2026-09-23 10:30:00"
 */
function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

/**
 * Escreve a mensagem no arquivo de log (append).
 * @param {string} line - Linha formatada para gravar
 */
function writeToFile(line) {
  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (err) {
    // Nunca deixar o logger derrubar o programa
    console.error('[ACHAki Logger] Falha ao gravar log em disco:', err.message);
  }
}

/**
 * Função interna de log.
 * @param {string} level - INFO | WARN | ERROR | DEBUG
 * @param {string} message - Mensagem a registrar
 * @param {Error|null} error - Objeto de erro opcional
 */
function log(level, message, error = null) {
  const ts = getTimestamp();
  const tag = `[${ts}] [${level.padEnd(5)}]`;
  const line = `${tag} ${message}`;

  // Console com cores
  const colors = {
    INFO:  '\x1b[36m',  // cyan
    WARN:  '\x1b[33m',  // yellow
    ERROR: '\x1b[31m',  // red
    DEBUG: '\x1b[90m',  // gray
  };
  const reset = '\x1b[0m';
  const color = colors[level] || reset;

  console.log(`${color}${line}${reset}`);

  if (error) {
    const errLine = `${tag}   ↳ ${error.stack || error.message}`;
    console.error(`${colors.ERROR}${errLine}${reset}`);
    writeToFile(errLine);
  }

  writeToFile(line);
}

// ─── API pública ─────────────────────────────────────────────────────────────

const logger = {
  /** @param {string} message */
  info: (message) => log('INFO', message),

  /** @param {string} message */
  warn: (message) => log('WARN', message),

  /**
   * @param {string} message
   * @param {Error} [error]
   */
  error: (message, error = null) => log('ERROR', message, error),

  /** @param {string} message */
  debug: (message) => log('DEBUG', message),

  /**
   * Registra detalhes de um erro capturado com contexto de etapa.
   * @param {string} step - Nome da etapa onde ocorreu o erro
   * @param {Error} error - Objeto de erro
   */
  captureError: (step, error) => {
    log('ERROR', `[${step}] ${error.message}`, error);
  },
};

export default logger;
