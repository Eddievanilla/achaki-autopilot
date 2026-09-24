import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // POST: Atualização de modo do Autopilot ou Metas
  if (req.method === 'POST') {
    try {
      const { action, mode, targetClicks } = req.body || {};

      if (action === 'SET_AUTOPILOT_MODE' && mode) {
        const validModes = ['OFF', 'ASSISTIDO', 'AUTONOMO'];
        if (!validModes.includes(mode)) {
          return res.status(400).json({ error: `Modo inválido. Valores aceitos: ${validModes.join(', ')}` });
        }

        await supabase
          .from('system_state')
          .update({
            autopilot_mode: mode,
            updated_at: new Date().toISOString(),
          })
          .eq('id', 'autopilot');

        await supabase.from('system_activity_logs').insert({
          message: `Modo do Autopilot alterado para: ${mode}`,
          level: 'info',
        });

        return res.status(200).json({ success: true, mode });
      }

      if (action === 'SET_GOAL' && targetClicks) {
        const target = Math.max(1, parseInt(targetClicks, 10));

        await supabase
          .from('system_state')
          .update({
            target_clicks: target,
            updated_at: new Date().toISOString(),
          })
          .eq('id', 'autopilot');

        await supabase
          .from('goals')
          .upsert({
            metric_name: 'clicks_per_day',
            target_value: target,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'metric_name' });

        await supabase.from('system_activity_logs').insert({
          message: `Meta diária de cliques atualizada para: ${target}`,
          level: 'info',
        });

        return res.status(200).json({ success: true, targetClicks: target });
      }

      return res.status(400).json({ error: 'Ação não reconhecida.' });
    } catch (err) {
      return res.status(500).json({ error: 'Falha ao atualizar centro de comando: ' + err.message });
    }
  }

  // GET: Retorna dados completos do Centro de Comando
  try {
    const { data: stateData } = await supabase
      .from('system_state')
      .select('*')
      .eq('id', 'autopilot')
      .maybeSingle();

    const { data: strategies } = await supabase
      .from('content_strategies')
      .select('*')
      .order('id', { ascending: true });

    const { data: diary } = await supabase
      .from('automation_events')
      .select(`
        id,
        event_type,
        message,
        strategy_id,
        details,
        created_at,
        products (
          id,
          title,
          marketplace,
          product_url,
          image_url,
          category
        ),
        content_strategies (
          id,
          name,
          objective
        )
      `)
      .order('created_at', { ascending: false })
      .limit(30);

    const { data: decisions } = await supabase
      .from('optimizer_decisions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    const { data: runs } = await supabase
      .from('automation_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    const state = stateData || {};

    return res.status(200).json({
      status: 'OK',
      autopilotMode: state.autopilot_mode || 'ASSISTIDO',
      currentStrategy: state.current_strategy || 'ACHADINHO',
      targetClicks: state.target_clicks || 20,
      currentClicks: 0, // Zero mock policy
      robot: {
        status: state.status || 'ONLINE',
        currentStep: state.current_step || 'Aguardando próximo ciclo de coleta...',
        startedAt: state.started_at || null,
        lastRunAt: state.last_run_at || null,
        lastDurationSeconds: state.last_duration_seconds || 0,
      },
      strategies: strategies || [],
      diary: (diary || []).map((d) => ({
        id: d.id,
        eventType: d.event_type,
        message: d.message,
        strategyName: d.content_strategies?.name || d.strategy_id || 'Padrão',
        time: new Date(d.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        date: new Date(d.created_at).toLocaleDateString('pt-BR'),
        fullTimestamp: d.created_at,
        product: d.products || null,
        details: d.details || {},
      })),
      optimizerDecisions: decisions || [],
      runs: runs || [],
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erro no Centro de Comando: ' + err.message });
  }
}
