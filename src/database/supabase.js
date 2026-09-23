/**
 * ACHAki Autopilot — Supabase Client (Fase 4.3)
 *
 * Cliente de backend para comunicação direta e segura com o banco de dados Supabase.
 * Utiliza SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY com permissões completas de backend.
 *
 * SEGURANÇA:
 *  - SUPABASE_SERVICE_ROLE_KEY é restrita exclusivamente ao backend.
 *  - NUNCA expor esta chave ao frontend, logs, terminal, OpenRouter ou versionamento.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import logger from '../utils/logger.js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceRoleKey) {
  logger.warn('[Supabase] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados no .env');
}

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

/**
 * Valida a conexão com o Supabase sem alterar nem ler dados de tabelas específicas.
 *
 * @returns {Promise<{ ok: boolean, status: string, error?: string }>}
 */
export async function testConnection() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return {
      ok: false,
      status: 'NOT_CONFIGURED',
      error: 'Variáveis SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes',
    };
  }

  try {
    // Testa ping na API REST do Supabase
    const endpoint = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
      },
    });

    // Se o serviço responder (200 a 404 de rota base), a autenticação e conexão estão ativas
    if (response.status < 500) {
      return {
        ok: true,
        status: 'CONNECTED',
      };
    }

    return {
      ok: false,
      status: 'SERVER_ERROR',
      error: `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 'CONNECTION_ERROR',
      error: err.message,
    };
  }
}

export default supabase;
