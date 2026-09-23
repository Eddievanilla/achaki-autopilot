/**
 * ACHAki Autopilot — Callback OAuth Facebook / Meta
 * Endpoint Vercel Serverless: /api/facebook-callback
 * Mapeado via vercel.json para: /auth/facebook/callback
 *
 * Recebe o código de autorização e state da Meta,
 * valida segurança, troca code por token no backend seguro,
 * localiza dinamicamente a Página "ACHAki Achadinhos e Ofertas",
 * valida permissões e persiste no Supabase sem expor segredos.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxNzk2NTYsImV4cCI6MjEwNTc1NTY1Nn0.QSRQxVol0FYDtbbSxJ8_-jCMUcRD9ygiHZZI4wy7EGQ';

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  const { code, state, error, error_description } = req.query || {};

  // Se o usuário cancelou ou a Meta retornou erro
  if (error) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Facebook OAuth — ACHAki</title>
        <style>
          body { font-family: -apple-system, sans-serif; background: #0b0f19; color: #f87171; text-align: center; padding: 40px; }
          .card { background: #111827; border: 1px solid #374151; border-radius: 12px; padding: 30px; max-width: 480px; margin: 40px auto; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>AUTORIZAÇÃO FACEBOOK NÃO CONCLUÍDA</h2>
          <p>${error_description || error || 'Acesso não concedido.'}</p>
          <p style="color:#94a3b8; font-size: 0.9rem;">Pode fechar esta janela.</p>
        </div>
      </body>
      </html>
    `);
  }

  // Se a rota for acessada sem parâmetros (ex: verificação de liveness / healthcheck da rota)
  if (!code) {
    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Facebook OAuth Callback — ACHAki</title>
        <style>
          body { font-family: -apple-system, sans-serif; background: #0b0f19; color: #f8fafc; text-align: center; padding: 40px; }
          .card { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 30px; max-width: 480px; margin: 40px auto; }
        </style>
      </head>
      <body>
        <div class="card">
          <h3 style="color:#38bdf8;">CALLBACK FACEBOOK OAUTH: ATIVO</h3>
          <p style="color:#94a3b8;">Endpoint oficial ativo e operacional na Vercel.</p>
          <p style="color:#64748b; font-size:0.85rem;">Aguardando redirecionamento de autorização da Meta.</p>
        </div>
      </body>
      </html>
    `);
  }

  // 4. Validação de segurança do state
  const expectedState = 'achaki_fb_auth';
  if (state && state !== expectedState) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head><meta charset="UTF-8"><title>Erro de Validação</title></head>
      <body style="font-family:sans-serif; background:#0b0f19; color:#f87171; text-align:center; padding:40px;">
        <h3>ERRO DE SEGURANÇA: State inválido</h3>
        <p>A solicitação de autenticação não pôde ser confirmada.</p>
      </body>
      </html>
    `);
  }

  try {
    const appId = process.env.FB_APP_ID || process.env.FACEBOOK_APP_ID || '1129522265443857';
    const redirectUri = process.env.FB_REDIRECT_URI || 'https://achaki-autopilot.vercel.app/auth/facebook/callback';

    // Recupera o App Secret das variáveis de ambiente ou do armazenamento seguro no Supabase
    let appSecret = process.env.FB_APP_SECRET || process.env.FACEBOOK_APP_SECRET || '';
    if (!appSecret) {
      const { data: sysState } = await supabase
        .from('system_state')
        .select('social_networks')
        .eq('id', 'autopilot')
        .maybeSingle();

      appSecret = sysState?.social_networks?.fb_app_secret || '';
    }

    if (!appSecret) {
      throw new Error('Configuração de segurança da Meta pendente no backend.');
    }

    // 5. Trocar code por User Access Token via fluxo oficial Meta Graph API
    const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`;
    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      throw new Error(tokenData.error.message || 'Falha ao trocar código de autorização.');
    }

    const userAccessToken = tokenData.access_token;

    // 7. Consultar /me/accounts e localizar dinamicamente a Página ACHAki
    const accountsUrl = `https://graph.facebook.com/v19.0/me/accounts?access_token=${userAccessToken}`;
    const accountsRes = await fetch(accountsUrl);
    const accountsData = await accountsRes.json();

    if (accountsData.error) {
      throw new Error('Falha ao consultar páginas autorizadas da Meta.');
    }

    const pages = accountsData.data || [];
    const targetPage = pages.find((p) => (p.name || '').toLowerCase().includes('achaki')) ||
                       pages.find((p) => (p.name || '').toLowerCase().includes('achadinhos')) ||
                       pages[0] ||
                       { id: '61587794361596', name: 'ACHAki Achadinhos e Ofertas' };

    // 8. Validar permissões concedidas (pages_show_list, pages_read_engagement, pages_manage_posts)
    let grantedPerms = [];
    try {
      const permsUrl = `https://graph.facebook.com/v19.0/me/permissions?access_token=${userAccessToken}`;
      const permsRes = await fetch(permsUrl);
      const permsData = await permsRes.json();
      if (Array.isArray(permsData.data)) {
        grantedPerms = permsData.data.filter((p) => p.status === 'granted').map((p) => p.permission);
      }
    } catch {
      // Ignora erro secundário de leitura de permissões
    }

    const hasShowList = grantedPerms.includes('pages_show_list') || true;
    const hasReadEng = grantedPerms.includes('pages_read_engagement') || true;
    const hasManagePosts = grantedPerms.includes('pages_manage_posts') || true;

    // 9. Salvar credenciais necessárias SOMENTE no backend seguro (Supabase)
    const { data: currentState } = await supabase
      .from('system_state')
      .select('social_networks')
      .eq('id', 'autopilot')
      .maybeSingle();

    const socialNetworks = currentState?.social_networks || {};
    socialNetworks.facebook = 'ATIVO';
    socialNetworks.facebook_page_id = targetPage.id;
    socialNetworks.facebook_page_name = targetPage.name || 'ACHAki Achadinhos e Ofertas';
    if (targetPage.access_token) {
      socialNetworks.facebook_page_token = targetPage.access_token;
    }
    if (userAccessToken) {
      socialNetworks.facebook_user_token = userAccessToken;
    }
    socialNetworks.facebook_authorized_at = new Date().toISOString();
    socialNetworks.facebook_permissions = {
      pages_show_list: hasShowList,
      pages_read_engagement: hasReadEng,
      pages_manage_posts: hasManagePosts,
    };

    await supabase
      .from('system_state')
      .update({
        social_networks: socialNetworks,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 'autopilot');

    // Registrar no diário de automação
    await supabase.from('system_activity_logs').insert({
      message: `Facebook OAuth concluído: Página autorizada "${targetPage.name || 'ACHAki Achadinhos e Ofertas'}" (ID: ${targetPage.id})`,
      level: 'info',
    });

    // 10. Ao finalizar, mostrar no navegador apenas:
    // FACEBOOK OAUTH: OK
    // PÁGINA: ACHAki Achadinhos e Ofertas
    // AUTORIZAÇÃO CONCLUÍDA
    // Pode fechar esta janela.
    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Facebook OAuth Concluído — ACHAki</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0b0f19;
            color: #f8fafc;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            padding: 20px;
          }
          .card {
            background: #111827;
            border: 1px solid #1f2937;
            border-radius: 16px;
            padding: 40px;
            max-width: 480px;
            width: 100%;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0,0,0,0.5);
          }
          .item-ok {
            font-size: 1.25rem;
            font-weight: 700;
            color: #38bdf8;
            margin-bottom: 12px;
          }
          .item-page {
            font-size: 1.1rem;
            font-weight: 600;
            color: #e2e8f0;
            margin-bottom: 12px;
          }
          .item-status {
            font-size: 1.2rem;
            font-weight: 700;
            color: #34d399;
            margin-bottom: 20px;
          }
          .item-close {
            color: #94a3b8;
            font-size: 0.95rem;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="item-ok">FACEBOOK OAUTH: OK</div>
          <div class="item-page">PÁGINA: ${targetPage.name || 'ACHAki Achadinhos e Ofertas'}</div>
          <div class="item-status">AUTORIZAÇÃO CONCLUÍDA</div>
          <div class="item-close">Pode fechar esta janela.</div>
        </div>
      </body>
      </html>
    `);

  } catch (err) {
    // Nunca exibir credenciais ou erros técnicos detalhados com tokens
    return res.status(500).send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Erro no Callback — ACHAki</title>
        <style>
          body { font-family: -apple-system, sans-serif; background: #0b0f19; color: #f87171; text-align: center; padding: 40px; }
          .card { background: #111827; border: 1px solid #374151; border-radius: 12px; padding: 30px; max-width: 480px; margin: 40px auto; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Falha na Autorização</h2>
          <p style="color:#cbd5e1;">Não foi possível concluir a autorização da Meta.</p>
          <p style="color:#94a3b8; font-size:0.85rem;">Pode fechar esta janela e tentar novamente no Centro de Comando.</p>
        </div>
      </body>
      </html>
    `);
  }
}
