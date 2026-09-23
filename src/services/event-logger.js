/**
 * ACHAki Autopilot — EventLogger (Central de Telemetria e Logs em Tempo Real)
 *
 * Responsável por emitir eventos de log com:
 *  - Formatação visual no terminal / PowerShell
 *  - Sanitização estrita de tokens, segredos e credenciais
 *  - Persistência assíncrona na tabela `system_events` do Supabase
 *  - Distribuição automática em tempo real para o painel via Supabase Realtime
 *  - Proteção contra falhas (não bloqueia nem interrompe o ciclo do robô)
 */

import { supabase } from '../database/supabase.js';

// Lista de palavras e chaves sensíveis que devem ser mascaradas
const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /senha/i,
  /auth/i,
  /cookie/i,
  /key/i,
  /credential/i,
  /fb_dtsg/i,
  /service_role/i,
  /bearer/i,
];

// Expressões regulares para detecção de valores sensíveis em strings
const SENSITIVE_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /EAAB[A-Za-z0-9]+/g, // Facebook User / Page Token
  /APP_USR-[A-Za-z0-9\-_]+/g, // Mercado Livre Token
  /sk-or-v1-[a-f0-9]{64}/gi, // OpenRouter Key
  /ey[A-Za-z0-9\-_=]+\.ey[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_.+/=]+/g, // JWT Tokens (Supabase)
  /[0-9a-f]{32}/gi, // 32-char Hex App Secret
  /NAfz[A-Za-z0-9\-._:]+/g, // fb_dtsg
];

/**
 * Sanitiza valores de texto removendo segredos conhecidos ou padrões de tokens.
 * @param {string} str
 * @returns {string}
 */
export function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  let sanitized = str;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '***PROTEGIDO***');
  }
  return sanitized;
}

/**
 * Sanitiza recursivamente objetos e metadados antes de persistir ou exibir.
 * @param {*} data
 * @param {number} [depth=0]
 * @returns {*}
 */
export function sanitizeMetadata(data, depth = 0) {
  if (depth > 6) return '[MAX_DEPTH]';
  if (!data) return data;

  if (typeof data === 'string') {
    return sanitizeString(data);
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeMetadata(item, depth + 1));
  }

  if (typeof data === 'object') {
    const clean = {};
    for (const [key, value] of Object.entries(data)) {
      const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pat) => pat.test(key));
      if (isSensitiveKey) {
        clean[key] = '***PROTEGIDO***';
      } else {
        clean[key] = sanitizeMetadata(value, depth + 1);
      }
    }
    return clean;
  }

  return data;
}

// Cores ANSI para o terminal / PowerShell
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

const ICONS = {
  INFO: 'ℹ',
  SUCCESS: '✓',
  WARNING: '⚠',
  ERROR: '✖',
  DEBUG: '⚙',
};

class EventLogger {
  constructor() {
    this.currentRunId = null;
  }

  /**
   * Define o ID da execução atual do robô para correlacionar eventos.
   * @param {string} runId
   */
  setRunId(runId) {
    this.currentRunId = runId;
  }

  /**
   * Formata e imprime o evento no console / PowerShell.
   */
  _printToConsole({ timestamp, level, category, message, durationMs }) {
    const timeStr = timestamp.toLocaleTimeString('pt-BR', { hour12: false });
    const icon = ICONS[level] || '●';
    
    let color = COLORS.cyan;
    if (level === 'SUCCESS') color = COLORS.green;
    if (level === 'WARNING') color = COLORS.yellow;
    if (level === 'ERROR') color = COLORS.red;
    if (level === 'DEBUG') color = COLORS.dim;

    const catBadge = `[${category.padEnd(12)}]`;
    const durStr = durationMs !== undefined && durationMs !== null ? `${COLORS.dim} (${durationMs}ms)${COLORS.reset}` : '';

    console.log(
      `${COLORS.dim}${timeStr}${COLORS.reset} ${color}${COLORS.bold}${icon} ${level.padEnd(7)}${COLORS.reset} ${COLORS.magenta}${catBadge}${COLORS.reset} ${message}${durStr}`
    );
  }

  /**
   * Registra um evento completo com envio ao Supabase.
   * @param {object} params
   * @returns {Promise<object|null>}
   */
  async log({
    level = 'INFO',
    category = 'SYSTEM',
    message = '',
    source = 'ACHAki-Autopilot',
    action = null,
    status = null,
    metadata = {},
    runId = null,
    productId = null,
    publicationId = null,
    durationMs = null,
  }) {
    const timestamp = new Date();
    const cleanLevel = (level || 'INFO').toUpperCase();
    const cleanCategory = (category || 'SYSTEM').toUpperCase();
    const cleanMessage = sanitizeString(message || '');
    const cleanMetadata = sanitizeMetadata(metadata || {});
    const cleanAction = action ? sanitizeString(action) : null;
    const cleanSource = source ? sanitizeString(source) : 'ACHAki-Autopilot';
    const effectiveRunId = runId || this.currentRunId || null;

    // 1. Exibir imediatamente no Console / PowerShell
    this._printToConsole({
      timestamp,
      level: cleanLevel,
      category: cleanCategory,
      message: cleanMessage,
      durationMs,
    });

    // 2. Persistir no Supabase em segundo plano (sem bloquear o robô)
    try {
      const payload = {
        level: cleanLevel,
        category: cleanCategory,
        message: cleanMessage,
        source: cleanSource,
        action: cleanAction,
        status: status || cleanLevel,
        metadata: cleanMetadata,
        run_id: effectiveRunId,
        product_id: productId,
        publication_id: publicationId,
        duration_ms: durationMs,
        created_at: timestamp.toISOString(),
      };

      // Inserção assíncrona não impeditiva
      const { data, error } = await supabase
        .from('system_events')
        .insert(payload)
        .select('id')
        .maybeSingle();

      if (error) {
        // Falha no log não deve interromper o robô
        // Silencioso ou aviso de baixo nível
      }

      return data;
    } catch {
      // Falha de rede não pode quebrar o fluxo
      return null;
    }
  }

  info(category, message, options = {}) {
    return this.log({ level: 'INFO', category, message, ...options });
  }

  success(category, message, options = {}) {
    return this.log({ level: 'SUCCESS', category, message, ...options });
  }

  warning(category, message, options = {}) {
    return this.log({ level: 'WARNING', category, message, ...options });
  }

  error(category, message, options = {}) {
    return this.log({ level: 'ERROR', category, message, ...options });
  }

  debug(category, message, options = {}) {
    return this.log({ level: 'DEBUG', category, message, ...options });
  }
}

export const eventLogger = new EventLogger();
export default eventLogger;
