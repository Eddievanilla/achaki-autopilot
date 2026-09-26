import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

import PublicationOrchestrator from '../src/services/publication-orchestrator.js';
import ManualAffiliateFlow from '../src/services/manual-affiliate-flow.js';

const orchestrator = new PublicationOrchestrator({ supabaseClient: supabase });

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
    const { action, publicationId, interventionId, approvalId, reason, remakeFocus, note, rawLink, dryRun, productId, strategy } = req.body || {};

    const validActions = [
      'INICIAR',
      'PAUSAR',
      'EXECUTAR_AGORA',
      'APPROVE_PUBLICATION',
      'REJECT_PUBLICATION',
      'CHOOSE_ANOTHER_OFFER',
      'RESOLVE_INTERVENTION',
      'CLEAR_ALL_INTERVENTIONS',
      'SET_GOAL_MODE',
      'SET_CONFIGURED_GOAL',
      'APPROVE_CREATIVE',
      'REJECT_CREATIVE',
      'REMAKE_CREATIVE',
      'APPROVE_AND_PUBLISH',
      'ENQUEUE_CREATIVE_JOB',
      'SUBMIT_AFFILIATE_LINK',
      'OPEN_AFFILIATE_GENERATOR',
      'START_CREATIVE_PIPELINE',
      'SET_PUBLICATION_FREQUENCY',
    ];

    if (!validActions.includes(action)) {
      return res.status(400).json({ error: `Ação inválida. Use uma das seguintes: ${validActions.join(', ')}` });
    }

    if (action === 'SET_PUBLICATION_FREQUENCY') {
      const { frequencyMode = 'AUTONOMOUS', targetPerDay = 2 } = req.body || {};
      await supabase
        .from('system_state')
        .update({
          publication_frequency_mode: frequencyMode,
          publication_frequency_target: Number(targetPerDay) || 2,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 'autopilot');

      return res.status(200).json({
        success: true,
        message: `Frequência de publicação atualizada para ${frequencyMode} (${targetPerDay}/dia).`,
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 0. NOVO FLUXO: APROVAÇÃO, REFAÇÃO E RECUSA DE CRIATIVO 9:16
    // ─────────────────────────────────────────────────────────────
    if (action === 'APPROVE_CREATIVE') {
      if (!approvalId) return res.status(400).json({ error: 'approvalId é obrigatório para aprovação de criativo.' });
      const result = await orchestrator.adminApproveCreative({ approvalId, approvedBy: 'admin_mobile' });
      return res.status(200).json(result);
    }

    if (action === 'REJECT_CREATIVE') {
      if (!approvalId) return res.status(400).json({ error: 'approvalId é obrigatório para recusa de criativo.' });
      const result = await orchestrator.adminRejectCreative({ approvalId, reason: reason || 'OUTRO', note: note || '' });
      return res.status(200).json(result);
    }

    if (action === 'REMAKE_CREATIVE') {
      let realApprovalId = approvalId;
      if (!realApprovalId && interventionId) {
        const { data: intRow } = await supabase.from('operator_interventions').select('*').eq('id', interventionId).maybeSingle();
        realApprovalId = intRow?.metadata?.approvalId;
        if (!realApprovalId && intRow?.product_id) {
          const { data: appr } = await supabase.from('publication_approvals').select('id').eq('product_id', intRow.product_id).maybeSingle();
          realApprovalId = appr?.id;
        }
      }
      if (!realApprovalId) return res.status(400).json({ error: 'approvalId é obrigatório para solicitação de refação.' });
      const result = await orchestrator.adminRequestRemake({ approvalId: realApprovalId, remakeFocus: remakeFocus || 'GANCHO', note: note || '' });
      return res.status(200).json(result);
    }

    // ─────────────────────────────────────────────────────────────
    // 0.1 APROVAR E PUBLICAR OFERTA COM VÍDEO SALVO NA GALERIA
    // ─────────────────────────────────────────────────────────────
    if (action === 'APPROVE_AND_PUBLISH') {
      let resolvedProdId = productId;
      let resolvedInterventionId = interventionId;

      if (resolvedInterventionId) {
        const { data: intRow } = await supabase.from('operator_interventions').select('*').eq('id', resolvedInterventionId).maybeSingle();
        if (intRow) {
          resolvedProdId = resolvedProdId || intRow.product_id || intRow.metadata?.productId;
        }
      }

      if (!resolvedProdId) {
        const { data: lastInt } = await supabase.from('operator_interventions').select('*').eq('status', 'PENDING').order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (lastInt) {
          resolvedProdId = lastInt.product_id || lastInt.metadata?.productId;
          resolvedInterventionId = resolvedInterventionId || lastInt.id;
        }
      }

      if (!resolvedProdId) {
        return res.status(400).json({ error: 'Produto não identificado para aprovação e publicação.' });
      }

      const { data: product } = await supabase.from('products').select('*').eq('id', resolvedProdId).single();
      if (!product) return res.status(404).json({ error: 'Produto não encontrado.' });

      const nowIso = new Date().toISOString();
      const affiliateUrl = product.affiliate_url;

      // Marca ou atualiza o criativo como APPROVED na galeria
      const { data: existingCreative } = await supabase.from('creative_versions').select('*').eq('product_id', resolvedProdId).order('created_at', { ascending: false }).limit(1).maybeSingle();
      let creativeId = existingCreative?.id || null;
      let videoUrl = existingCreative?.video_url || existingCreative?.storage_url || product.image_url;

      if (existingCreative) {
        await supabase.from('creative_versions').update({ status: 'APPROVED', updated_at: nowIso }).eq('id', existingCreative.id);
      } else {
        const { data: newCv } = await supabase.from('creative_versions').insert({
          product_id: resolvedProdId, version_number: 1, aspect_ratio: '9:16', duration: 18,
          status: 'APPROVED', video_url: product.image_url, thumbnail_url: product.image_url,
          headline: product.title, metadata: { product_title: product.title, marketplace: product.marketplace, affiliate_url: affiliateUrl }
        }).select('id, video_url').maybeSingle();
        if (newCv) {
          creativeId = newCv.id;
          videoUrl = newCv.video_url;
        }
      }

      // Resolve a intervenção pendente
      if (resolvedInterventionId) {
        await supabase.from('operator_interventions').update({ status: 'RESOLVED', resolved_at: nowIso }).eq('id', resolvedInterventionId);
      } else {
        await supabase.from('operator_interventions').update({ status: 'RESOLVED', resolved_at: nowIso }).eq('product_id', resolvedProdId).eq('status', 'PENDING');
      }

      // Cria publicação em publications
      const { data: newPub } = await supabase.from('publications').insert({
        product_id: resolvedProdId, channel: 'Facebook', social_network: 'Facebook',
        status: 'READY', affiliate_url: affiliateUrl, media_url: videoUrl,
        metadata: { productTitle: product.title, marketplace: product.marketplace, creative_id: creativeId },
        created_at: nowIso
      }).select('*').single();

      // Enfileira comando APPROVE_PUBLICATION para o worker
      await supabase.from('robot_commands').insert({
        command: 'APPROVE_PUBLICATION', status: 'PENDING',
        metadata: { publicationId: newPub?.id, productId: resolvedProdId, affiliateUrl, requested_by: 'admin_modal_publish', requested_at: nowIso }
      });

      return res.status(200).json({ success: true, ok: true, message: 'Vídeo aprovado e salvo na galeria! Publicação disparada.', productId: resolvedProdId, publicationId: newPub?.id });
    }

    // ─────────────────────────────────────────────────────────────
    // 0.2 ENFILEIRAR JOB NA FÁBRICA LOCAL (creative_jobs)
    // ─────────────────────────────────────────────────────────────
    if (action === 'ENQUEUE_CREATIVE_JOB') {
      let resolvedProdId = productId;
      if (!resolvedProdId && interventionId) {
        const { data: intRow } = await supabase.from('operator_interventions').select('product_id, metadata').eq('id', interventionId).maybeSingle();
        resolvedProdId = intRow?.product_id || intRow?.metadata?.productId;
      }
      if (!resolvedProdId) {
        const { data: lastInt } = await supabase.from('operator_interventions').select('product_id, metadata').eq('status', 'PENDING').order('created_at', { ascending: false }).limit(1).maybeSingle();
        resolvedProdId = lastInt?.product_id || lastInt?.metadata?.productId;
      }

      if (!resolvedProdId) return res.status(400).json({ error: 'Produto não identificado para o job criativo.' });
      const { data: prod } = await supabase.from('products').select('*').eq('id', resolvedProdId).single();
      if (!prod) return res.status(404).json({ error: 'Produto não encontrado.' });

      const nowIso = new Date().toISOString();
      const jobKey = `job_${prod.id}_v1_${Date.now()}`;

      const { data: job, error: jobErr } = await supabase.from('creative_jobs').insert({
        product_id: prod.id, creative_version: 1, job_type: 'VIDEO_9_16', priority: 'HIGH', status: 'PENDING',
        prompt: prod.title, aspect_ratio: '9:16', duration_target: 15, idempotency_key: jobKey,
        metadata: { productTitle: prod.title, marketplace: prod.marketplace, affiliateUrl: prod.affiliate_url, imageUrl: prod.image_url, enqueuedAt: nowIso }
      }).select('*').single();

      if (jobErr) return res.status(500).json({ error: 'Erro ao enfileirar: ' + jobErr.message });

      return res.status(200).json({ success: true, ok: true, jobId: job.id, message: 'Job de vídeo 9:16 enfileirado na fábrica local!' });
    }

    if (action === 'OPEN_AFFILIATE_GENERATOR') {
      if (!interventionId) return res.status(400).json({ error: 'interventionId é obrigatório.' });
      let realId = interventionId;
      if (interventionId.startsWith('appr-')) {
        const approvalId = interventionId.replace('appr-', '');
        const { data: appr } = await supabase.from('publication_approvals').select('product_id').eq('id', approvalId).maybeSingle();
        if (appr?.product_id) {
          const { data: intRow } = await supabase.from('operator_interventions').select('id').eq('product_id', appr.product_id).eq('status', 'PENDING').maybeSingle();
          if (intRow?.id) realId = intRow.id;
        }
      }
      const result = await new ManualAffiliateFlow({ supabaseClient: supabase }).requestOpen(realId);
      return res.status(200).json(result);
    }

    if (action === 'SUBMIT_AFFILIATE_LINK' && interventionId) {
      let realId = interventionId;
      if (interventionId.startsWith('appr-')) {
        const approvalId = interventionId.replace('appr-', '');
        const { data: appr } = await supabase.from('publication_approvals').select('product_id').eq('id', approvalId).maybeSingle();
        if (appr?.product_id) {
          const { data: intRow } = await supabase.from('operator_interventions').select('id').eq('product_id', appr.product_id).eq('status', 'PENDING').maybeSingle();
          if (intRow?.id) realId = intRow.id;
        }
      }
      const result = await new ManualAffiliateFlow({ supabaseClient: supabase }).saveDetectedLink(realId, rawLink);
      return res.status(result.success ? 200 : 422).json(result);
    }

    if (action === 'SUBMIT_AFFILIATE_LINK') {
      if (!approvalId || !rawLink) return res.status(400).json({ error: 'approvalId e rawLink são obrigatórios.' });
      const result = await orchestrator.submitAndValidateAffiliateLink({
        approvalId,
        rawLink,
        dryRun: dryRun !== undefined ? Boolean(dryRun) : true, // padrão seguro DRY_RUN
      });
      return res.status(200).json(result);
    }

    if (action === 'START_CREATIVE_PIPELINE') {
      if (!productId) return res.status(400).json({ error: 'productId é obrigatório para iniciar pipeline de criativo.' });
      const { data: prod } = await supabase.from('products').select('*').eq('id', productId).single();
      if (!prod) return res.status(404).json({ error: 'Produto não encontrado.' });
      const result = await orchestrator.startPipelineForProduct({ product: prod, strategy: strategy || 'DESCONTO' });
      return res.status(200).json(result);
    }

    // ─────────────────────────────────────────────────────────────
    // 0.0 ALTERAR MODO DE METAS (AUTÔNOMAS OU CONFIGURADAS)
    // ─────────────────────────────────────────────────────────────
    if (action === 'SET_GOAL_MODE') {
      const { mode } = req.body || {};
      const targetMode = mode === 'CONFIGURED' ? 'CONFIGURED' : 'AUTONOMOUS';

      await supabase
        .from('system_state')
        .update({
          goal_mode: targetMode,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 'autopilot');

      return res.status(200).json({ ok: true, mode: targetMode, message: `Modo de metas atualizado para [${targetMode}].` });
    }

    // ─────────────────────────────────────────────────────────────
    // 0.01 CONFIGURAR META MANUAL DO OPERADOR
    // ─────────────────────────────────────────────────────────────
    if (action === 'SET_CONFIGURED_GOAL') {
      const { metric, value } = req.body || {};
      if (!metric || value == null) {
        return res.status(400).json({ error: 'metric e value são obrigatórios.' });
      }

      await supabase
        .from('goals')
        .upsert({
          id: `goal-${metric}`,
          metric,
          mode: 'CONFIGURED',
          current_goal: Number(value),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

      return res.status(200).json({ ok: true, metric, value: Number(value), message: `Meta para [${metric}] configurada em ${value}.` });
    }

    // ─────────────────────────────────────────────────────────────
    // 0. LIMPAR TODAS AS INTERVENÇÕES ANTIGAS
    // ─────────────────────────────────────────────────────────────
    if (action === 'CLEAR_ALL_INTERVENTIONS') {
      await supabase
        .from('operator_interventions')
        .update({ status: 'RESOLVED', resolved_at: new Date().toISOString() })
        .eq('status', 'PENDING');
      return res.status(200).json({ ok: true, message: 'Todas as notificações antigas foram limpas com sucesso.' });
    }

    // ─────────────────────────────────────────────────────────────
    // 0.1 RESOLVER INTERVENÇÃO DO OPERADOR
    // ─────────────────────────────────────────────────────────────
    if (action === 'RESOLVE_INTERVENTION') {
      const { affiliateUrl } = req.body || {};
      if (affiliateUrl) {
        if (!interventionId) return res.status(400).json({ error: 'Solicitação de link obrigatória.' });
        const result = await new ManualAffiliateFlow({ supabaseClient: supabase }).saveDetectedLink(interventionId, affiliateUrl);
        return res.status(result.success ? 200 : 422).json(result);
      }
      if (interventionId) {
        const { error } = await supabase.from('operator_interventions')
          .update({ status: 'RESOLVED', resolved_at: new Date().toISOString() }).eq('id', interventionId);
        if (error) throw new Error(error.message);
      }

      return res.status(200).json({ ok: true, message: 'Intervenção marcada como resolvida com sucesso.' });
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
