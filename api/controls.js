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
    const { action, publicationId } = req.body || {};

    const validActions = [
      'INICIAR',
      'PAUSAR',
      'EXECUTAR_AGORA',
      'APPROVE_PUBLICATION',
      'REJECT_PUBLICATION',
      'CHOOSE_ANOTHER_OFFER',
    ];

    if (!validActions.includes(action)) {
      return res.status(400).json({ error: `Ação inválida. Use uma das seguintes: ${validActions.join(', ')}` });
    }

    // ─────────────────────────────────────────────────────────────
    // 1. APROVAR E PUBLICAR
    // ─────────────────────────────────────────────────────────────
    if (action === 'APPROVE_PUBLICATION') {
      if (!publicationId) {
        return res.status(400).json({ error: 'publicationId é obrigatório para aprovação.' });
      }

      const { data: pub, error: pubErr } = await supabase
        .from('publications')
        .select('*')
        .eq('id', publicationId)
        .maybeSingle();

      if (pubErr || !pub) {
        return res.status(404).json({ error: 'Publicação preparada não encontrada.' });
      }

      if (pub.status === 'PUBLISHED') {
        return res.status(400).json({ error: 'Esta publicação já foi realizada anteriormente (Idempotência ativa).' });
      }

      // 1. Registra telemetria imediata
      await supabase.from('system_events').insert({
        level: 'INFO',
        category: 'DASHBOARD',
        source: 'Centro-de-Comando',
        action: 'PUBLICATION_APPROVED',
        status: 'PENDING',
        message: 'Publicação aprovada pelo operador',
        publication_id: publicationId,
        metadata: { publicationId, approved_at: new Date().toISOString() },
      });

      // 2. Enfileira comando APPROVE_PUBLICATION para o worker local
      const { data: cmdRecord, error: cmdErr } = await supabase
        .from('robot_commands')
        .insert({
          command: 'APPROVE_PUBLICATION',
          status: 'PENDING',
          metadata: {
            publicationId,
            requested_by: 'dashboard_operator',
            requested_at: new Date().toISOString(),
          },
        })
        .select('*')
        .single();

      if (cmdErr) {
        throw new Error(`Erro ao enfileirar comando de aprovação: ${cmdErr.message}`);
      }

      // 3. Atualiza estado para TRABALHANDO
      await supabase
        .from('system_state')
        .upsert({
          id: 'autopilot',
          status: 'TRABALHANDO',
          current_step: 'Publicação aprovada pelo operador. Processando envio...',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

      return res.status(200).json({
        ok: true,
        action,
        commandId: cmdRecord.id,
        message: 'Publicação aprovada! Comando enviado para o worker local.',
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 2. REJEITAR PUBLICAÇÃO
    // ─────────────────────────────────────────────────────────────
    if (action === 'REJECT_PUBLICATION') {
      if (publicationId) {
        await supabase
          .from('publications')
          .update({ status: 'REJECTED' })
          .eq('id', publicationId);
      }

      await supabase.from('system_events').insert({
        level: 'WARNING',
        category: 'DASHBOARD',
        source: 'Centro-de-Comando',
        action: 'PUBLICATION_REJECTED',
        status: 'REJECTED',
        message: 'Publicação rejeitada pelo operador',
        publication_id: publicationId || null,
        metadata: { publicationId },
      });

      // Atualiza step para AGUARDANDO
      await supabase
        .from('worker_heartbeats')
        .update({ current_step: 'AGUARDANDO', status: 'IDLE', updated_at: new Date().toISOString() })
        .eq('worker_id', 'local-worker');

      await supabase
        .from('system_state')
        .upsert({
          id: 'autopilot',
          status: 'ONLINE',
          current_step: 'Publicação rejeitada. Aguardando próximo ciclo...',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

      return res.status(200).json({
        ok: true,
        action,
        message: 'Publicação rejeitada com sucesso.',
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 3. ESCOLHER OUTRA OFERTA
    // ─────────────────────────────────────────────────────────────
    if (action === 'CHOOSE_ANOTHER_OFFER') {
      if (publicationId) {
        await supabase
          .from('publications')
          .update({ status: 'SKIPPED' })
          .eq('id', publicationId);
      }

      await supabase.from('system_events').insert({
        level: 'INFO',
        category: 'DASHBOARD',
        source: 'Centro-de-Comando',
        action: 'CHOOSE_ANOTHER_OFFER',
        status: 'PENDING',
        message: 'Solicitada nova oferta para curadoria',
        publication_id: publicationId || null,
        metadata: { skippedPublicationId: publicationId },
      });

      const { data: cmdRecord } = await supabase
        .from('robot_commands')
        .insert({
          command: 'RUN_NOW',
          status: 'PENDING',
          metadata: {
            reason: 'choose_another_offer',
            skippedPublicationId: publicationId,
            requested_at: new Date().toISOString(),
          },
        })
        .select('*')
        .single();

      return res.status(200).json({
        ok: true,
        action,
        commandId: cmdRecord?.id,
        message: 'Nova oferta solicitada. O robô irá garimpar uma nova opção.',
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 4. COMANDOS GERAIS (EXECUTAR_AGORA, PAUSAR, INICIAR)
    // ─────────────────────────────────────────────────────────────
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

    await supabase
      .from('system_state')
      .upsert({
        id: 'autopilot',
        status: newStatus,
        current_step: step,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

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
