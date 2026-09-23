/**
 * ACHAki Autopilot — Fluxo OAuth Mercado Livre (Fase 4.2.1)
 *
 * Script assistido para gerar a URL de autorização e trocar o código
 * de autorização por Access Token e Refresh Token oficiais.
 *
 * USO:
 *   npm run oauth:ml
 *
 * SEGURANÇA:
 *   - CLIENT_SECRET, ACCESS_TOKEN e REFRESH_TOKEN NUNCA são expostos no terminal.
 *   - .env é atualizado com segurança sem sobrescrever outras variáveis.
 */

import 'dotenv/config';
import readline from 'node:readline';
import MercadoLivreOAuthManager, { DEFAULT_REDIRECT_URI } from '../src/providers/mercadolivre/oauth-manager.js';
import MercadoLivreApiProvider from '../src/providers/mercadolivre/api-provider.js';

function printBanner() {
  console.log('\n' +
    '╔══════════════════════════════════════════════════════════╗\n' +
    '║      ACHAki Autopilot — OAuth Mercado Livre (F4.2.1)     ║\n' +
    '╚══════════════════════════════════════════════════════════╝\n'
  );
}

function promptQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  printBanner();

  const clientId = process.env.MERCADOLIVRE_CLIENT_ID;
  const clientSecret = process.env.MERCADOLIVRE_CLIENT_SECRET;
  const redirectUri = process.env.MERCADOLIVRE_REDIRECT_URI || DEFAULT_REDIRECT_URI;

  console.log('1. Auditoria Prévia de Credenciais:');
  console.log(`   MERCADOLIVRE_CLIENT_ID:     ${clientId?.trim() ? 'CONFIGURADO' : 'NÃO CONFIGURADO'}`);
  console.log(`   MERCADOLIVRE_CLIENT_SECRET: ${clientSecret?.trim() ? 'CONFIGURADO' : 'NÃO CONFIGURADO'}`);
  console.log(`   Redirect URI:               ${redirectUri}\n`);

  if (!clientId?.trim() || !clientSecret?.trim()) {
    console.log('❌ ERRO: MERCADOLIVRE_CLIENT_ID e MERCADOLIVRE_CLIENT_SECRET precisam estar preenchidos no .env.');
    console.log('Preencha as variáveis no arquivo .env e execute novamente:\n  npm run oauth:ml\n');
    process.exit(1);
  }

  const oauthManager = new MercadoLivreOAuthManager({
    clientId,
    clientSecret,
    redirectUri,
  });

  const authUrl = oauthManager.getAuthorizationUrl();

  console.log('──────────────────────────────────────────────────────────');
  console.log('2. PASSO 1 — AUTORIZAÇÃO NO NAVEGADOR');
  console.log('──────────────────────────────────────────────────────────');
  console.log('Abra o link abaixo no seu navegador (com a conta Mercado Livre conectada):\n');
  console.log(`  👉 ${authUrl}\n`);
  console.log('Clique em "Permitir" / "Continuar" para autorizar a aplicação.');
  console.log('O Mercado Livre irá redirecioná-lo para a Redirect URI com o parâmetro "code=".');
  console.log('Exemplo: https://achaki-autopilot.vercel.app/achaki/oauth/callback?code=TG-66f1...-123456\n');

  console.log('──────────────────────────────────────────────────────────');
  console.log('3. PASSO 2 — INFORMAR O CÓDIGO');
  console.log('──────────────────────────────────────────────────────────');

  const rawInput = await promptQuestion('Cole o código (TG-...) ou a URL completa do redirecionamento:\n> ');

  if (!rawInput) {
    console.log('\n❌ Operação cancelada. Nenhum código informado.\n');
    process.exit(1);
  }

  const extractedCode = MercadoLivreOAuthManager.extractCode(rawInput);
  if (!extractedCode) {
    console.log('\n❌ Código inválido. Certifique-se de colar o código TG-... ou a URL inteira do callback.\n');
    process.exit(1);
  }

  console.log('\n⏳ Trocando o código de autorização por Access Token e Refresh Token...');

  try {
    const tokens = await oauthManager.exchangeCodeForTokens(extractedCode);

    // Salvar com segurança no .env sem expor valores
    MercadoLivreOAuthManager.saveTokensToEnv(tokens);

    console.log('✅ Tokens obtidos e salvos no arquivo .env com sucesso!');
    console.log(`   Expiração: ${Math.round(tokens.expiresIn / 3600)} horas`);
    console.log(`   Escopo:    ${tokens.scope || 'offline_access read write'}`);

    console.log('\n⏳ Validando credenciais na API oficial (/users/me)...');
    const provider = new MercadoLivreApiProvider();
    provider.reloadCredentials();
    const validation = await provider.validateCredentials();

    if (validation.valid) {
      console.log('──────────────────────────────────────────────────────────');
      console.log('🎉 SUCESSO! INTEGRAÇÃO OFICIAL ATIVADA:');
      console.log('──────────────────────────────────────────────────────────');
      console.log('  Mercado Livre API: AVAILABLE');
      console.log(`  Usuário/Conta:     ${validation.user}`);
      console.log('  Modo Operacional:  API Oficial ativa (Chromium em fallback)');
      console.log('──────────────────────────────────────────────────────────\n');
    } else {
      console.log(`⚠️ Alerta: Os tokens foram gravados, mas a validação retornou: ${validation.message}`);
      console.log('Execute `npm run test:ml-api` para testar novamente.\n');
    }

  } catch (err) {
    console.log(`\n❌ Falha na troca do código: ${err.message}`);
    console.log('\nDica: O código de autorização do Mercado Livre expira em poucos minutos e é de uso único.');
    console.log('Se necessário, abra novamente o link do Passo 1 para obter um novo código.\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n❌ Erro inesperado:', err.message);
  process.exit(1);
});
