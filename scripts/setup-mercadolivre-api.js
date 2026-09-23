/**
 * ACHAki Autopilot — Setup Assistido da API do Mercado Livre (Fase 4.2)
 *
 * Verifica se as credenciais oficiais da API do Mercado Livre estão configuradas.
 * Se estiverem ausentes, orienta o operador com instruções claras sobre como
 * criá-las no portal oficial de desenvolvedores.
 *
 * USO:
 *   npm run setup:ml-api
 */

import 'dotenv/config';
import MercadoLivreApiProvider from '../src/providers/mercadolivre/api-provider.js';

function printBanner() {
  console.log('\n' +
    '╔══════════════════════════════════════════════════════════╗\n' +
    '║   ACHAki Autopilot — Setup Mercado Livre API (F4.2)      ║\n' +
    '╚══════════════════════════════════════════════════════════╝\n'
  );
}

async function main() {
  printBanner();

  const provider = new MercadoLivreApiProvider();
  const missing = provider.getMissingCredentials();

  console.log('────────────────────────────────────────────────────────────');
  console.log('  VERIFICAÇÃO DE CREDENCIAIS NO ARQUIVO .ENV');
  console.log('────────────────────────────────────────────────────────────\n');

  console.log(`  MERCADOLIVRE_CLIENT_ID     : ${provider.clientId ? '✔ CONFIGURADA' : '○ NÃO CONFIGURADA'}`);
  console.log(`  MERCADOLIVRE_CLIENT_SECRET : ${provider.clientSecret ? '✔ CONFIGURADA (ocultada)' : '○ NÃO CONFIGURADA'}`);
  console.log(`  MERCADOLIVRE_ACCESS_TOKEN  : ${provider.accessToken ? '✔ CONFIGURADO (ocultado)' : '○ NÃO CONFIGURADO'}`);

  if (missing.length > 0) {
    console.log('\n────────────────────────────────────────────────────────────');
    console.log('  STATUS: NOT_CONFIGURED');
    console.log('────────────────────────────────────────────────────────────\n');

    if (provider.clientId && provider.clientSecret && !provider.accessToken) {
      console.log('  \x1b[32m✔ CLIENT_ID e CLIENT_SECRET já estão configurados!\x1b[0m');
      console.log('  Para obter o Access Token e Refresh Token oficiais via OAuth, execute:\n');
      console.log('    \x1b[36mnpm run oauth:ml\x1b[0m\n');
      console.log('  O assistente gerará a URL de autorização e salvará os tokens no .env automaticamente.\n');
      return;
    }

    console.log('  Para ativar a busca via API oficial, você precisará obter');
    console.log('  suas credenciais no portal oficial de desenvolvedores:\n');
    console.log('  1. Acesse o portal Mercado Livre Developers:');
    console.log('     https://developers.mercadolivre.com.br/\n');
    console.log('  2. Faça login com a sua conta do Mercado Livre.\n');
    console.log('  3. Vá em "Meus Aplicativos" (ou crie um novo aplicativo):\n');
    console.log('     • Nome: ACHAki Autopilot');
    console.log('     • Redirecionamento: https://achaki.co.netlify.app/achaki/oauth/callback\n');
    console.log('  4. Copie o App ID (Client ID) e Secret Key (Client Secret).\n');
    console.log('  5. Adicione no seu arquivo .env:\n');
    console.log('     MERCADOLIVRE_CLIENT_ID=seu_client_id_aqui');
    console.log('     MERCADOLIVRE_CLIENT_SECRET=seu_client_secret_aqui\n');
    console.log('  6. Execute o fluxo OAuth para obter os tokens:');
    console.log('     npm run oauth:ml\n');
    console.log('  ℹ  ENQUANTO NÃO CONFIGURADO:');
    console.log('     O ACHAki continuará operando normalmente através do coletor');
    console.log('     Mercado Livre via navegador (MercadoLivreBrowserProvider).\n');
    return;
  }

  // Se todas as variáveis estão preenchidas, executa teste de autenticação
  console.log('\n  Todas as variáveis estão presentes no .env. Testando conexão com a API...\n');
  const result = await provider.validateCredentials();

  if (result.valid) {
    console.log(`  \x1b[32m✔ SUCESSO: Conexão autenticada! Usuário: ${result.user}\x1b[0m`);
    console.log('  Status da API: AVAILABLE\n');
  } else {
    console.log(`  \x1b[31m✖ FALHA NA AUTENTICAÇÃO: ${result.message}\x1b[0m`);
    console.log('  Status da API: AUTH_ERROR\n');
    console.log('  Verifique se o seu Access Token não expirou e gere um novo token no portal.\n');
  }
}

main().catch(console.error);
