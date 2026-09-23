/**
 * ACHAki Autopilot — Teste de Conexão Supabase (Fase 4.3)
 *
 * Valida a conectividade e autenticação com o banco de dados Supabase via backend (Service Role).
 * Não realiza inserções, atualizações ou remoções de dados.
 *
 * SEGURANÇA:
 *  - NENHUMA chave, token ou credencial é exibida no console.
 *
 * USO:
 *   npm run test:supabase
 */

import 'dotenv/config';
import { testConnection } from '../src/database/supabase.js';

function printBanner() {
  console.log('\n' +
    '╔══════════════════════════════════════════════════════════╗\n' +
    '║      ACHAki Autopilot — Teste Supabase (Fase 4.3)        ║\n' +
    '╚══════════════════════════════════════════════════════════╝\n'
  );
}

async function main() {
  printBanner();

  const urlConfigured = Boolean(process.env.SUPABASE_URL?.trim());
  const serviceKeyConfigured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const anonKeyConfigured = Boolean(process.env.SUPABASE_ANON_KEY?.trim());

  console.log('1. Auditoria de Configuração:');
  console.log(`   SUPABASE_URL:              ${urlConfigured ? '✔ CONFIGURADA' : '○ AUSENTE'}`);
  console.log(`   SUPABASE_ANON_KEY:         ${anonKeyConfigured ? '✔ CONFIGURADA (ocultada)' : '○ AUSENTE'}`);
  console.log(`   SUPABASE_SERVICE_ROLE_KEY: ${serviceKeyConfigured ? '✔ CONFIGURADA (ocultada)' : '○ AUSENTE'}\n`);

  if (!urlConfigured || !serviceKeyConfigured) {
    console.log('❌ Falha: Variáveis obrigatórias ausentes no arquivo .env.');
    process.exit(1);
  }

  console.log('2. Testando Conectividade de Backend (REST ping)...');
  const result = await testConnection();

  if (result.ok) {
    console.log('──────────────────────────────────────────────────────────');
    console.log('🎉 SUCESSO: Conexão com o Supabase estabelecida com êxito!');
    console.log('   Status: CONNECTED');
    console.log('   Modo:   Backend Service Role (segurança máxima)');
    console.log('──────────────────────────────────────────────────────────\n');
  } else {
    console.log('──────────────────────────────────────────────────────────');
    console.log(`❌ ERRO de conexão: ${result.error || result.status}`);
    console.log('──────────────────────────────────────────────────────────\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Exceção inesperada:', err.message);
  process.exit(1);
});
