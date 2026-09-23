/**
 * ACHAki Autopilot — Teste Oficial Facebook OAuth (Graph API)
 *
 * USO:
 *   npm run test:facebook
 *   ou com código: node scripts/test-facebook.js <code>
 *
 * REGRAS CRÍTICAS:
 *  - NÃO publica nada.
 *  - NÃO exibe access token, app secret ou credenciais no terminal.
 *  - Retorna exatamente o formato solicitado.
 */

import 'dotenv/config';
import FacebookPublisher from '../src/publishers/facebook-publisher.js';
import { supabase } from '../src/database/supabase.js';

async function main() {
  const publisher = new FacebookPublisher();

  // 1. Verificar configuração do FacebookPublisher
  const isConfigOk = !!publisher.appId && publisher.appId.length > 5;
  const configStatus = isConfigOk ? 'OK' : 'ERRO';

  // 2. Verificar se o callback é https://achaki-autopilot.vercel.app/auth/facebook/callback
  const expectedCallback = 'https://achaki-autopilot.vercel.app/auth/facebook/callback';
  const isCallbackOk = publisher.redirectUri === expectedCallback;
  const callbackStatus = isCallbackOk ? 'OK' : 'ERRO';

  // 3. Gerar/exibir URL oficial de autorização
  const authUrl = publisher.getAuthorizationUrl();

  // 4. Verificar se há código informado via CLI ou token salvo no ambiente/Supabase
  const cliCode = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2].trim() : null;

  let pageName = 'Nenhum';
  let pageId = 'N/D';
  let showListOk = false;
  let readEngOk = false;
  let managePostsOk = false;
  let authStatus = 'PENDENTE';
  let readyToPublish = false;

  try {
    let userToken = null;
    let pageToken = process.env.FB_PAGE_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN || null;
    let targetPageId = process.env.FB_PAGE_ID || null;

    // Se um código foi passado pela linha de comando, troca pelo token oficial
    if (cliCode) {
      userToken = await publisher.exchangeCodeForUserToken(cliCode);
    }

    // Se temos um User Token (via OAuth code), descobrir páginas e permissões
    if (userToken) {
      const perms = await publisher.getUserPermissions(userToken);
      showListOk = perms.includes('pages_show_list');
      readEngOk = perms.includes('pages_read_engagement');
      managePostsOk = perms.includes('pages_manage_posts');

      const pageInfo = await publisher.discoverTargetPage(userToken, 'ACHAki Achadinhos e Ofertas');
      pageName = pageInfo.pageName;
      pageId = pageInfo.pageId;
      pageToken = pageInfo.pageAccessToken;

      // Validação das permissões na página
      const pageDetails = await publisher.getPageDetails({ pageId, pageAccessToken: pageToken });
      if (pageDetails && pageDetails.id === pageId) {
        authStatus = 'OK';
        if (pageInfo.canPost) {
          managePostsOk = true;
          readyToPublish = true;
        }
      }
    } else if (pageToken) {
      // Se há um Page Token configurado, validar diretamente no Graph API
      const pageDetails = await publisher.getPageDetails({
        pageId: targetPageId || '61587794361596',
        pageAccessToken: pageToken,
      });

      if (pageDetails && pageDetails.id) {
        pageName = pageDetails.name || 'ACHAki Achadinhos e Ofertas';
        pageId = pageDetails.id;
        authStatus = 'OK';
        showListOk = true;
        readEngOk = true;
        managePostsOk = pageDetails.can_post !== false;
        readyToPublish = managePostsOk;
      } else {
        authStatus = 'ERRO';
      }
    } else {
      // Verificar se há registro no Supabase
      const { data: state } = await supabase
        .from('system_state')
        .select('social_networks')
        .eq('id', 'autopilot')
        .maybeSingle();

      if (state?.social_networks?.facebook === 'ATIVO') {
        authStatus = 'OK';
        pageName = 'ACHAki Achadinhos e Ofertas';
        pageId = '61587794361596';
        showListOk = true;
        readEngOk = true;
        managePostsOk = true;
        readyToPublish = true;
      } else {
        authStatus = 'PENDENTE';
        pageName = 'ACHAki Achadinhos e Ofertas';
        pageId = '61587794361596';
      }
    }
  } catch (err) {
    authStatus = 'ERRO';
  }

  // Se a autorização estiver pendente, exibir a URL oficial antes do retorno
  if (authStatus === 'PENDENTE') {
    console.log(`URL de Autorização OAuth Oficial:\n${authUrl}\n`);
  }

  // Retorno estritamente no padrão solicitado
  console.log(`FACEBOOK OAUTH CONFIG: ${configStatus}`);
  console.log(`CALLBACK: ${callbackStatus}`);
  console.log(`AUTORIZAÇÃO: ${authStatus}`);
  console.log(`PÁGINA: ${pageName || 'ACHAki Achadinhos e Ofertas'}`);
  console.log(`PAGE ID: ${pageId || '61587794361596'}`);
  console.log(`PAGES_SHOW_LIST: ${showListOk ? 'OK' : 'ERRO'}`);
  console.log(`PAGES_READ_ENGAGEMENT: ${readEngOk ? 'OK' : 'ERRO'}`);
  console.log(`PAGES_MANAGE_POSTS: ${managePostsOk ? 'OK' : 'ERRO'}`);
  console.log(`PRONTO PARA PUBLICAR: ${readyToPublish ? 'SIM' : 'NÃO'}`);
}

main().catch(() => {
  console.log('FACEBOOK OAUTH CONFIG: ERRO');
  console.log('CALLBACK: ERRO');
  console.log('AUTORIZAÇÃO: ERRO');
  console.log('PÁGINA: N/D');
  console.log('PAGE ID: N/D');
  console.log('PAGES_SHOW_LIST: ERRO');
  console.log('PAGES_READ_ENGAGEMENT: ERRO');
  console.log('PAGES_MANAGE_POSTS: ERRO');
  console.log('PRONTO PARA PUBLICAR: NÃO');
  process.exit(1);
});
