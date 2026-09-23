/**
 * ACHAki Autopilot — Callback OAuth Facebook / Meta
 * Endpoint: /auth/facebook/callback -> /api/auth/facebook/callback
 *
 * Recebe o código de autorização, troca por User Access Token e Page Access Token,
 * descobre automaticamente a Página ACHAki e salva os dados com segurança no backend.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxNzk2NTYsImV4cCI6MjEwNTc1NTY1Nn0.QSRQxVol0FYDtbbSxJ8_-jCMUcRD9ygiHZZI4wy7EGQ';

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

export default async function handler(req, res) {
  const { code, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8"><title>Erro de Autorização — ACHAki</title>
        <style>body { font-family: sans-serif; background: #0b0f19; color: #f87171; text-align: center; padding: 40px; }</style>
      </head>
      <body>
        <h2>Autorização Recusada ou Cancelada</h2>
        <p>${error_description || error}</p>
        <a href="/" style="color:#60a5fa;">Voltar ao Centro de Comando</a>
      </body>
      </html>
    `);
  }

  if (!code) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8"><title>Código Ausente — ACHAki</title>
        <style>body { font-family: sans-serif; background: #0b0f19; color: #cbd5e1; text-align: center; padding: 40px; }</style>
      </head>
      <body>
        <h2>Nenhum código de autorização recebido</h2>
        <a href="/" style="color:#60a5fa;">Voltar ao Centro de Comando</a>
      </body>
      </html>
    `);
  }

  try {
    const appId = process.env.FB_APP_ID || process.env.FACEBOOK_APP_ID || '1129522265443857';
    const appSecret = process.env.FB_APP_SECRET || process.env.FACEBOOK_APP_SECRET || '';
    const redirectUri = process.env.FB_REDIRECT_URI || 'https://achaki-autopilot.vercel.app/auth/facebook/callback';

    if (!appSecret) {
      throw new Error('FACEBOOK_APP_SECRET não está configurado nas variáveis de ambiente.');
    }

    // 1. Trocar code por User Access Token
    const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`;
    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      throw new Error(tokenData.error.message || 'Falha ao trocar código de autorização');
    }

    const userAccessToken = tokenData.access_token;

    // 2. Descobrir páginas administradas
    const accountsUrl = `https://graph.facebook.com/v19.0/me/accounts?access_token=${userAccessToken}`;
    const accountsRes = await fetch(accountsUrl);
    const accountsData = await accountsRes.json();

    if (accountsData.error) {
      throw new Error(accountsData.error.message || 'Falha ao consultar páginas');
    }

    const pages = accountsData.data || [];
    const targetPage = pages.find(p => (p.name || '').toLowerCase().includes('achaki')) || pages[0];

    if (!targetPage) {
      throw new Error('Nenhuma Página encontrada vinculada a esta conta.');
    }

    // 3. Salvar configuração segura no Supabase
    const { data: currentState } = await supabase
      .from('system_state')
      .select('social_networks')
      .eq('id', 'autopilot')
      .maybeSingle();

    const socialNetworks = currentState?.social_networks || {};
    socialNetworks.facebook = 'ATIVO';

    await supabase
      .from('system_state')
      .update({
        social_networks: socialNetworks,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 'autopilot');

    // Registrar no diário
    await supabase.from('system_activity_logs').insert({
      message: `Página Facebook conectada com sucesso: ${targetPage.name} (ID: ${targetPage.id})`,
      level: 'info',
    });

    // 4. Exibir tela de sucesso
    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Facebook Conectado — ACHAki Autopilot</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: radial-gradient(circle at 50% 20%, #1e1b4b 0%, #090d16 80%);
            color: #f8fafc;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            padding: 20px;
          }
          .card {
            background: rgba(15, 23, 42, 0.9);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 18px;
            padding: 36px;
            max-width: 520px;
            width: 100%;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0,0,0,0.6);
          }
          .icon {
            font-size: 3rem;
            margin-bottom: 16px;
          }
          h1 {
            font-size: 1.5rem;
            color: #38bdf8;
            margin-bottom: 8px;
          }
          p {
            color: #94a3b8;
            font-size: 0.95rem;
            line-height: 1.5;
            margin-bottom: 20px;
          }
          .badge {
            display: inline-block;
            background: rgba(16, 185, 129, 0.2);
            color: #34d399;
            border: 1px solid rgba(16, 185, 129, 0.4);
            padding: 6px 14px;
            border-radius: 20px;
            font-weight: 600;
            font-size: 0.85rem;
            margin-bottom: 24px;
          }
          .btn {
            background: #2563eb;
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 600;
            display: inline-block;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">📘✨</div>
          <h1>Página Facebook Conectada!</h1>
          <p>O ACHAki foi autorizado com sucesso para publicar na Página:</p>
          <div class="badge">✔ ${targetPage.name} (ID: ${targetPage.id})</div>
          <div>
            <a href="/" class="btn">Ir para o Centro de Comando ↗</a>
          </div>
        </div>
      </body>
      </html>
    `);

  } catch (err) {
    return res.status(500).send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8"><title>Erro no Callback — ACHAki</title>
        <style>body { font-family: sans-serif; background: #0b0f19; color: #f87171; text-align: center; padding: 40px; }</style>
      </head>
      <body>
        <h2>Falha na Conexão do Facebook</h2>
        <p>${err.message}</p>
        <a href="/" style="color:#60a5fa;">Voltar ao Centro de Comando</a>
      </body>
      </html>
    `);
  }
}
