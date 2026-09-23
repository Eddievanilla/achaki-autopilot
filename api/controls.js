import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxNzk2NTYsImV4cCI6MjEwNTc1NTY1Nn0.QSRQxVol0FYDtbbSxJ8_-jCMUcRD9ygiHZZI4wy7EGQ';

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { action } = req.body || {};

    if (!['INICIAR', 'PAUSAR', 'EXECUTAR_AGORA'].includes(action)) {
      return res.status(400).json({ error: 'Ação inválida. Use INICIAR, PAUSAR ou EXECUTAR_AGORA.' });
    }

    let newStatus = 'ONLINE';
    let step = 'Comando recebido pelo painel.';

    if (action === 'PAUSAR') {
      newStatus = 'AGUARDANDO';
      step = 'Operador pausado pelo painel operacional.';
    } else if (action === 'EXECUTAR_AGORA') {
      newStatus = 'TRABALHANDO';
      step = 'Disparo manual solicitado pelo painel. Inicializando ciclo...';
    } else if (action === 'INICIAR') {
      newStatus = 'ONLINE';
      step = 'Operador ativado. Aguardando próximo agendamento.';
    }

    // Atualiza estado no Supabase
    await supabase
      .from('system_state')
      .upsert({
        id: 'autopilot',
        status: newStatus,
        current_step: step,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

    // Registra log no feed
    await supabase.from('system_activity_logs').insert({
      message: `Comando [${action}] acionado pelo painel operacional`,
      level: 'INFO',
      created_at: new Date().toISOString(),
    });

    return res.status(200).json({
      ok: true,
      action,
      status: newStatus,
      message: `Comando ${action} processado com sucesso.`,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Falha ao processar comando: ' + err.message });
  }
}
