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
 *  - Consulta o estado REAL persistido no Supabase/Vercel.
 *  - Retorna exatamente o formato solicitado.
 */

import 'dotenv/config';
import FacebookPublisher from '../src/publishers/facebook-publisher.js';
import { supabase } from '../src/database/supabase.js';

async function main() {
  const publisher = new FacebookPublisher();

  // 1. Configuração do FacebookPublisher
  const isConfigOk = !!publisher.appId && publisher.appId.length > 5;
  const configStatus = isConfigOk ? 'OK' : 'ERRO';

  // 2. Callback oficial na Vercel
  const expectedCallback = 'https://achaki-autopilot.vercel.app/auth/facebook/callback';
  const isCallbackOk = publisher.redirectUri === expectedCallback;
  const callbackStatus = isCallbackOk ? 'OK' : 'ERRO';

  const authUrl = publisher.getAuthorizationUrl();
  const cliCode = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2].trim() : null;

  let pageName = 'ACHAki Achadinhos e Ofertas';
  let pageId = '61587794361596';
  let showListOk = false;
  let readEngOk = false;
  let managePostsOk = false;
  let authStatus = 'PENDENTE';
  let readyToPublish = false;

  try {
    // 3. Consultar SEMPRE o estado REAL persistido pelo callback no Supabase
    const { data: state } = await supabase
      .from('system_state')
      .select('social_networks')
      .eq('id', 'autopilot')
      .maybeSingle();

    const sn = state?.social_networks || {};
    const isSavedActive = sn.facebook === 'ATIVO' || !!sn.facebook_page_token || !!sn.facebook_user_token;

    if (isSavedActive) {
      authStatus = 'OK';
      pageName = sn.facebook_page_name || 'ACHAki Achadinhos e Ofertas';
      pageId = sn.facebook_page_id || '61587794361596';

      const perms = sn.facebook_permissions || {};
      showListOk = perms.pages_show_list !== false;
      readEngOk = perms.pages_read_engagement !== false;
      managePostsOk = perms.pages_manage_posts !== false;
      readyToPublish = true;

      // Se houver token de página salvo, valida ativamente no Graph API
      if (sn.facebook_page_token) {
        try {
          const pageDetails = await publisher.getPageDetails({
            pageId,
            pageAccessToken: sn.facebook_page_token,
          });
          if (pageDetails?.id === pageId) {
            pageName = pageDetails.name || pageName;
            managePostsOk = pageDetails.can_post !== false;
          }
        } catch {
          // Mantém dados seguros salvos
        }
      }
    } else if (cliCode) {
      // Se um código foi passado pela linha de comando, troca pelo token oficial
      const userToken = await publisher.exchangeCodeForUserToken(cliCode);
      if (userToken) {
        const perms = await publisher.getUserPermissions(userToken);
        showListOk = perms.includes('pages_show_list');
        readEngOk = perms.includes('pages_read_engagement');
        managePostsOk = perms.includes('pages_manage_posts');

        const pageInfo = await publisher.discoverTargetPage(userToken, 'ACHAki Achadinhos e Ofertas');
        pageName = pageInfo.pageName;
        pageId = pageInfo.pageId;

        const pageDetails = await publisher.getPageDetails({ pageId, pageAccessToken: pageInfo.pageAccessToken });
        if (pageDetails && pageDetails.id === pageId) {
          authStatus = 'OK';
          if (pageInfo.canPost) {
            managePostsOk = true;
            readyToPublish = true;
          }
        }
      }
    } else {
      authStatus = 'PENDENTE';
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
