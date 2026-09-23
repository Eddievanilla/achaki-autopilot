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

    let commandType = 'RUN_NOW';
    let newStatus = 'TRABALHANDO';
    let step = 'Comando EXECUTAR AGORA colocado na fila. Aguardando worker local...';
    let logMessage = 'Comando EXECUTAR AGORA solicitado pelo painel';
    let logLevel = 'INFO';

    if (action === 'PAUSAR') {
      commandType = 'PAUSE';
      newStatus = 'AGUARDANDO';
      step = 'Operador pausado pelo painel operacional.';
      logMessage = 'Comando PAUSAR solicitado pelo painel';
      logLevel = 'WARNING';
    } else if (action === 'INICIAR') {
      commandType = 'RESUME';
      newStatus = 'ONLINE';
      step = 'Operador ativado. Aguardando comandos ou agendamento.';
      logMessage = 'Comando INICIAR solicitado pelo painel';
      logLevel = 'INFO';
    }

    // 1. Criar comando na fila robot_commands
    const { data: cmdRecord, error: cmdErr } = await supabase
      .from('robot_commands')
      .insert({
        command: commandType,
        status: 'PENDING',
        metadata: {
          requested_by: 'dashboard_button',
          action,
          requested_at: new Date().toISOString(),
        },
      })
      .select('id, command, status, created_at')
      .single();

    if (cmdErr) {
      console.error('[Controls] Erro ao enfileirar comando:', cmdErr);
      throw new Error(`Falha ao registrar comando na fila: ${cmdErr.message}`);
    }

    // 2. Registrar imediatamente no system_events para telemetria em tempo real
    await supabase.from('system_events').insert({
      level: logLevel,
      category: 'DASHBOARD',
      source: 'Centro-de-Comando',
      action: `${action}_REQUESTED`,
      status: 'PENDING',
      message: logMessage,
      metadata: {
        command_id: cmdRecord.id,
        command_type: commandType,
        action,
      },
    });

    // 3. Atualizar estado no Supabase (system_state)
    await supabase
      .from('system_state')
      .upsert({
        id: 'autopilot',
        status: newStatus,
        current_step: step,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

    // 4. Registrar em system_activity_logs (legado)
    await supabase.from('system_activity_logs').insert({
      message: `Comando [${action}] acionado pelo painel operacional (ID: ${cmdRecord.id})`,
      level: logLevel,
      created_at: new Date().toISOString(),
    });

    return res.status(200).json({
      ok: true,
      action,
      commandId: cmdRecord.id,
      commandType,
      status: newStatus,
      message: `Comando ${action} enviado com sucesso para a fila do worker local.`,
    });
  } catch (err) {
    console.error('[Controls] Erro no handler:', err);
    return res.status(500).json({ error: 'Falha ao processar comando: ' + err.message });
  }
}
