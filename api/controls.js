globalThis.WebSocket = globalThis.WebSocket || class DummyWebSocket {};
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

import ManualAffiliateFlow from '../src/services/manual-affiliate-flow.js';

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
      'CREATIVE_NODE_DIAGNOSE',
      'CREATIVE_NODE_INSTALL',
      'CREATIVE_NODE_REPAIR',
      'GENERATE_CREATIVE_BLUEPRINT',
      'GET_CREATIVE_STORYBOARD',
      'PRODUCE_CREATIVE_SCENES',
      'DIRECT_CREATIVE_VOICE',
      'ASSEMBLE_FINAL_VIDEO',
      'APPLY_SUBTITLES_AND_GRAPHICS',
      'EVALUATE_CREATIVE_QC',
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

      const { data: appr, error: apprErr } = await supabase
        .from('publication_approvals')
        .select('*')
        .eq('id', approvalId)
        .maybeSingle();

      if (apprErr || !appr) {
        return res.status(404).json({ error: `Aprovação não encontrada para ID: ${approvalId}` });
      }

      const nowIso = new Date().toISOString();

      await supabase
        .from('publication_approvals')
        .update({
          status: 'WAITING_AFFILIATE_LINK',
          approved_by: 'admin_mobile',
          approved_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', approvalId);

      if (appr.creative_id) {
        await supabase
          .from('creative_versions')
          .update({ status: 'APPROVED', updated_at: nowIso })
          .eq('id', appr.creative_id);
      }

      await supabase
        .from('operator_interventions')
        .update({
          title: '🔗 Gere o Link Oficial de Afiliado',
          message: 'Vídeo aprovado com sucesso! Agora toque no botão para abrir o produto no marketplace, copie o link comissionado oficial e cole abaixo.',
          metadata: {
            ...appr.metadata,
            approvalId,
            step: 'WAITING_AFFILIATE_LINK',
          },
        })
        .filter('metadata->>approvalId', 'eq', approvalId);

      return res.status(200).json({
        success: true,
        status: 'WAITING_AFFILIATE_LINK',
        message: 'Vídeo aprovado com sucesso! Agora informe o link oficial de afiliado.',
      });
    }

    if (action === 'REJECT_CREATIVE') {
      if (!approvalId) return res.status(400).json({ error: 'approvalId é obrigatório para recusa de criativo.' });

      const { data: appr, error: apprErr } = await supabase
        .from('publication_approvals')
        .select('*')
        .eq('id', approvalId)
        .maybeSingle();

      if (apprErr || !appr) {
        return res.status(404).json({ error: `Aprovação não encontrada para ID: ${approvalId}` });
      }

      const nowIso = new Date().toISOString();

      await supabase
        .from('publication_approvals')
        .update({
          status: 'ADMIN_REJECTED',
          rejection_reason: reason || 'OUTRO',
          notes: note || '',
          updated_at: nowIso,
        })
        .eq('id', approvalId);

      if (appr.creative_id) {
        await supabase
          .from('creative_versions')
          .update({ status: 'REJECTED', updated_at: nowIso })
          .eq('id', appr.creative_id);
      }

      await supabase
        .from('operator_interventions')
        .update({ status: 'RESOLVED', resolved_at: nowIso })
        .filter('metadata->>approvalId', 'eq', approvalId);

      return res.status(200).json({
        success: true,
        status: 'ADMIN_REJECTED',
        message: 'Criativo recusado com sucesso. Oferta descartada.',
      });
    }

    if (action === 'REMAKE_CREATIVE') {
      let resolvedProdId = productId;
      let realApprovalId = approvalId;

      if (!resolvedProdId && interventionId) {
        const cleanId = String(interventionId).replace('appr-', '');
        const { data: appr } = await supabase.from('publication_approvals').select('id, product_id').eq('id', cleanId).maybeSingle();
        if (appr?.product_id) {
          resolvedProdId = appr.product_id;
          realApprovalId = realApprovalId || appr.id;
        } else {
          const { data: intRow } = await supabase.from('operator_interventions').select('id, product_id, metadata').eq('id', cleanId).maybeSingle();
          resolvedProdId = intRow?.product_id || intRow?.metadata?.productId;
          realApprovalId = realApprovalId || intRow?.metadata?.approvalId;
        }
      }
      if (!resolvedProdId && realApprovalId) {
        const { data: appr } = await supabase.from('publication_approvals').select('id, product_id').eq('id', realApprovalId).maybeSingle();
        resolvedProdId = appr?.product_id;
      }
      if (!resolvedProdId) {
        const { data: lastProd } = await supabase.from('products').select('id').order('created_at', { ascending: false }).limit(1).maybeSingle();
        resolvedProdId = lastProd?.id;
      }

      if (!resolvedProdId) return res.status(400).json({ error: 'Produto não identificado para refazer criativo.' });
      const { data: prod } = await supabase.from('products').select('*').eq('id', resolvedProdId).single();
      if (!prod) return res.status(404).json({ error: 'Produto não encontrado.' });

      const userPrompt = req.body?.userPrompt || req.body?.prompt || req.body?.customPrompt || '';

      // Determina próximo número de versão
      const { count: existingCount } = await supabase
        .from('creative_versions')
        .select('*', { count: 'exact', head: true })
        .eq('product_id', resolvedProdId);

      const nextVersion = (existingCount || 1) + 1;
      const nowIso = new Date().toISOString();
      const jobKey = `job_${prod.id}_v${nextVersion}_${Date.now()}`;

      // Se existir approvalId correspondente, atualiza o status de aprovação
      if (realApprovalId) {
        await supabase.from('publication_approvals').update({
          status: 'ADMIN_REQUESTED_REMAKE',
          remake_reason: userPrompt ? 'PROMPT_OPERADOR' : (remakeFocus || 'GANCHO'),
          notes: userPrompt || note || '',
          updated_at: nowIso,
        }).eq('id', realApprovalId);
      }

      const { data: job, error: jobErr } = await supabase.from('creative_jobs').insert({
        product_id: prod.id,
        creative_version: nextVersion,
        job_type: 'VIDEO_9_16',
        priority: 'HIGH',
        status: 'PENDING',
        prompt: userPrompt || prod.title,
        aspect_ratio: '9:16',
        duration_target: 15,
        idempotency_key: jobKey,
        metadata: {
          productTitle: prod.title,
          marketplace: prod.marketplace,
          affiliateUrl: prod.affiliate_url,
          imageUrl: prod.image_url,
          customPrompt: userPrompt,
          trigger: 'REMAKE',
          previousApprovalId: realApprovalId || null,
          enqueuedAt: nowIso
        }
      }).select('*').single();

      if (jobErr) return res.status(500).json({ error: 'Erro ao agendar remake: ' + jobErr.message });

      return res.status(200).json({
        success: true,
        ok: true,
        jobId: job.id,
        version: nextVersion,
        message: `Novo criativo (v${nextVersion}) com seu roteiro foi enfileirado com prioridade máxima!`
      });
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
    // ─────────────────────────────────────────────────────────────
    // 0.2 ENFILEIRAR JOB NA FÁBRICA LOCAL (creative_jobs)
    // ─────────────────────────────────────────────────────────────
    if (action === 'ENQUEUE_CREATIVE_JOB') {
      let resolvedProdId = productId;
      if (!resolvedProdId && interventionId) {
        const cleanId = String(interventionId).replace('appr-', '');
        const { data: appr } = await supabase.from('publication_approvals').select('product_id').eq('id', cleanId).maybeSingle();
        if (appr?.product_id) {
          resolvedProdId = appr.product_id;
        } else {
          const { data: intRow } = await supabase.from('operator_interventions').select('product_id, metadata').eq('id', cleanId).maybeSingle();
          resolvedProdId = intRow?.product_id || intRow?.metadata?.productId;
        }
      }
      if (!resolvedProdId) {
        const { data: lastInt } = await supabase.from('operator_interventions').select('product_id, metadata').eq('status', 'PENDING').order('created_at', { ascending: false }).limit(1).maybeSingle();
        resolvedProdId = lastInt?.product_id || lastInt?.metadata?.productId;
      }
      if (!resolvedProdId) {
        const { data: lastProd } = await supabase.from('products').select('id').order('created_at', { ascending: false }).limit(1).maybeSingle();
        resolvedProdId = lastProd?.id;
      }

      if (!resolvedProdId) return res.status(400).json({ error: 'Produto não identificado para o job criativo.' });
      const { data: prod } = await supabase.from('products').select('*').eq('id', resolvedProdId).single();
      if (!prod) return res.status(404).json({ error: 'Produto não encontrado.' });

      // Se já existir vídeo 9:16 pronto, retorna imediatamente
      const { data: existingCv } = await supabase.from('creative_versions')
        .select('*')
        .eq('product_id', resolvedProdId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingCv?.video_url && (existingCv.video_url.includes('.mp4') || existingCv.video_url.includes('.webm'))) {
        return res.status(200).json({
          success: true,
          ok: true,
          videoUrl: existingCv.video_url,
          creativeId: existingCv.id,
          message: 'Vídeo 9:16 já disponível!'
        });
      }

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

    // ─────────────────────────────────────────────────────────────
    // 0.3 CREATIVE NODE: DIAGNÓSTICO, INSTALAÇÃO E AUTO-REPARO
    // ─────────────────────────────────────────────────────────────
    if (action === 'CREATIVE_NODE_DIAGNOSE') {
      try {
        const { CreativeNodeSupervisor } = await import('../src/services/creative-node/node-supervisor.js');
        const report = await CreativeNodeSupervisor.evaluateHealth();
        return res.status(200).json({ success: true, ok: true, report });
      } catch (err) {
        return res.status(500).json({ error: 'Erro no diagnóstico do Creative Node: ' + err.message });
      }
    }

    if (action === 'CREATIVE_NODE_INSTALL') {
      try {
        const { CreativeNodeInstaller } = await import('../src/services/creative-node/node-installer.js');
        const installRes = await CreativeNodeInstaller.install();
        const { CreativeNodeSupervisor } = await import('../src/services/creative-node/node-supervisor.js');
        const report = await CreativeNodeSupervisor.evaluateHealth();
        return res.status(200).json({ success: true, ok: true, installRes, report });
      } catch (err) {
        return res.status(500).json({ error: 'Erro ao instalar Creative Node: ' + err.message });
      }
    }

    if (action === 'CREATIVE_NODE_REPAIR') {
      try {
        const { NodeRepairEngine } = await import('../src/services/creative-node/node-repair.js');
        const repairRes = await NodeRepairEngine.repairAll();
        const { CreativeNodeSupervisor } = await import('../src/services/creative-node/node-supervisor.js');
        const report = await CreativeNodeSupervisor.evaluateHealth();
        return res.status(200).json({ success: true, ok: true, repairRes, report });
      } catch (err) {
        return res.status(500).json({ error: 'Erro ao reparar Creative Node: ' + err.message });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 0.4 DIRETOR CRIATIVO ACHAki (CREATIVE BLUEPRINT & STORYBOARD)
    // ─────────────────────────────────────────────────────────────
    if (action === 'GENERATE_CREATIVE_BLUEPRINT') {
      let resolvedProdId = productId;
      if (!resolvedProdId && interventionId) {
        const cleanId = String(interventionId).replace('appr-', '');
        const { data: appr } = await supabase.from('publication_approvals').select('product_id').eq('id', cleanId).maybeSingle();
        if (appr?.product_id) {
          resolvedProdId = appr.product_id;
        } else {
          const { data: intRow } = await supabase.from('operator_interventions').select('product_id, metadata').eq('id', cleanId).maybeSingle();
          resolvedProdId = intRow?.product_id || intRow?.metadata?.productId;
        }
      }
      if (!resolvedProdId) {
        const { data: lastProd } = await supabase.from('products').select('id').order('created_at', { ascending: false }).limit(1).maybeSingle();
        resolvedProdId = lastProd?.id;
      }

      if (!resolvedProdId) return res.status(400).json({ error: 'Produto não identificado para o Creative Blueprint.' });
      const { data: prod } = await supabase.from('products').select('*').eq('id', resolvedProdId).single();
      if (!prod) return res.status(404).json({ error: 'Produto não encontrado.' });

      try {
        const { CreativeDirector } = await import('../src/agents/creative-director.js');
        const director = new CreativeDirector({ supabaseClient: supabase });
        const blueprint = director.createBlueprint({ product: prod });
        const saved = await director.saveBlueprint({ productId: prod.id, blueprint, creativeId: req.body?.creativeId || null });

        return res.status(200).json({
          success: true,
          ok: true,
          directorStatus: 'OK',
          blueprintStatus: 'OK',
          ptBr: 'OK',
          videoGenerated: false,
          creativeId: saved.creativeId,
          version: saved.version,
          blueprint,
          storyboard: blueprint.cenas,
          message: 'Creative Blueprint gerado e salvo com sucesso em PT-BR!'
        });
      } catch (err) {
        return res.status(500).json({ error: 'Erro ao gerar Creative Blueprint: ' + err.message });
      }
    }

    if (action === 'GET_CREATIVE_STORYBOARD') {
      let resolvedProdId = productId;
      let targetCreativeId = req.body?.creativeId || creativeId;

      if (!targetCreativeId && !resolvedProdId && interventionId) {
        const cleanId = String(interventionId).replace('appr-', '');
        const { data: appr } = await supabase.from('publication_approvals').select('creative_id, product_id').eq('id', cleanId).maybeSingle();
        targetCreativeId = appr?.creative_id;
        resolvedProdId = appr?.product_id;
      }

      let cvRow = null;
      if (targetCreativeId) {
        const { data } = await supabase.from('creative_versions').select('*').eq('id', targetCreativeId).maybeSingle();
        cvRow = data;
      }
      if (!cvRow && resolvedProdId) {
        const { data } = await supabase.from('creative_versions').select('*').eq('product_id', resolvedProdId).order('created_at', { ascending: false }).limit(1).maybeSingle();
        cvRow = data;
      }

      if (!cvRow && !resolvedProdId) {
        const { data: lastProd } = await supabase.from('products').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (lastProd) resolvedProdId = lastProd.id;
      }

      if (!cvRow?.script_data?.cenas && resolvedProdId) {
        const { data: prod } = await supabase.from('products').select('*').eq('id', resolvedProdId).single();
        if (prod) {
          const { CreativeDirector } = await import('../src/agents/creative-director.js');
          const director = new CreativeDirector({ supabaseClient: supabase });
          const blueprint = director.createBlueprint({ product: prod });
          const saved = await director.saveBlueprint({ productId: prod.id, blueprint, creativeId: cvRow?.id || null });
          return res.status(200).json({
            success: true,
            ok: true,
            creativeId: saved.creativeId,
            blueprint,
            storyboard: blueprint.cenas
          });
        }
      }

      return res.status(200).json({
        success: true,
        ok: true,
        creativeId: cvRow?.id,
        blueprint: cvRow?.script_data || cvRow?.metadata?.blueprint,
        storyboard: cvRow?.script_data?.cenas || cvRow?.metadata?.storyboard || []
      });
    }

    if (action === 'PRODUCE_CREATIVE_SCENES') {
      let resolvedProdId = productId;
      let targetCreativeId = req.body?.creativeId || creativeId;

      if (!targetCreativeId && !resolvedProdId && interventionId) {
        const cleanId = String(interventionId).replace('appr-', '');
        const { data: appr } = await supabase.from('publication_approvals').select('creative_id, product_id').eq('id', cleanId).maybeSingle();
        targetCreativeId = appr?.creative_id;
        resolvedProdId = appr?.product_id;
      }

      let cvRow = null;
      if (targetCreativeId) {
        const { data } = await supabase.from('creative_versions').select('*').eq('id', targetCreativeId).maybeSingle();
        cvRow = data;
      }
      if (!cvRow && resolvedProdId) {
        const { data } = await supabase.from('creative_versions').select('*').eq('product_id', resolvedProdId).order('created_at', { ascending: false }).limit(1).maybeSingle();
        cvRow = data;
      }

      if (!cvRow && !resolvedProdId) {
        const { data: lastProd } = await supabase.from('products').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (lastProd) resolvedProdId = lastProd.id;
      }

      const { data: prod } = resolvedProdId ? await supabase.from('products').select('*').eq('id', resolvedProdId).single() : { data: null };

      let blueprint = cvRow?.script_data;
      if (!blueprint && prod) {
        const { CreativeDirector } = await import('../src/agents/creative-director.js');
        const director = new CreativeDirector({ supabaseClient: supabase });
        blueprint = director.createBlueprint({ product: prod });
        const saved = await director.saveBlueprint({ productId: prod.id, blueprint, creativeId: cvRow?.id || null });
        targetCreativeId = saved.creativeId;
      }

      if (!blueprint) {
        return res.status(400).json({ error: 'Nenhum Creative Blueprint encontrado para produzir cenas.' });
      }

      try {
        const { SceneProducer } = await import('../src/services/factory/scene-producer.js');
        const producer = new SceneProducer({ supabaseClient: supabase });
        const productionReport = await producer.produceAllScenes({
          creativeId: targetCreativeId || cvRow?.id,
          creativeVersion: cvRow?.version_number || 1,
          blueprint,
          product: prod,
        });

        return res.status(200).json({
          success: true,
          ok: true,
          ...productionReport,
        });
      } catch (err) {
        return res.status(500).json({ error: 'Erro na produção de cenas: ' + err.message });
      }
    }

    if (action === 'DIRECT_CREATIVE_VOICE') {
      let resolvedProdId = productId;
      let targetCreativeId = req.body?.creativeId || creativeId;

      if (!targetCreativeId && !resolvedProdId && interventionId) {
        const cleanId = String(interventionId).replace('appr-', '');
        const { data: appr } = await supabase.from('publication_approvals').select('creative_id, product_id').eq('id', cleanId).maybeSingle();
        targetCreativeId = appr?.creative_id;
        resolvedProdId = appr?.product_id;
      }

      let cvRow = null;
      if (targetCreativeId) {
        const { data } = await supabase.from('creative_versions').select('*').eq('id', targetCreativeId).maybeSingle();
        cvRow = data;
      }
      if (!cvRow && resolvedProdId) {
        const { data } = await supabase.from('creative_versions').select('*').eq('product_id', resolvedProdId).order('created_at', { ascending: false }).limit(1).maybeSingle();
        cvRow = data;
      }

      const blueprint = cvRow?.script_data;
      if (!blueprint) {
        return res.status(400).json({ error: 'Nenhum Creative Blueprint encontrado para a locução.' });
      }

      try {
        const { VoiceDirector } = await import('../src/agents/voice-director.js');
        const director = new VoiceDirector({ supabaseClient: supabase });
        const voiceReport = await director.directAllScenes({
          creativeId: targetCreativeId || cvRow?.id,
          creativeVersion: cvRow?.version_number || 1,
          blueprint,
          config: {
            gender: req.body?.gender || 'FEMALE',
            style: req.body?.style || 'NATURAL',
            speed: req.body?.speed || 1.0,
          },
        });

        return res.status(200).json({
          success: true,
          ok: true,
          ...voiceReport,
        });
      } catch (err) {
        return res.status(500).json({ error: 'Erro na direção de voz: ' + err.message });
      }
    }

    if (action === 'ASSEMBLE_FINAL_VIDEO') {
      let resolvedProdId = productId;
      let targetCreativeId = req.body?.creativeId || creativeId;

      if (!targetCreativeId && !resolvedProdId && interventionId) {
        const cleanId = String(interventionId).replace('appr-', '');
        const { data: appr } = await supabase.from('publication_approvals').select('creative_id, product_id').eq('id', cleanId).maybeSingle();
        targetCreativeId = appr?.creative_id;
        resolvedProdId = appr?.product_id;
      }

      let cvRow = null;
      if (targetCreativeId) {
        const { data } = await supabase.from('creative_versions').select('*').eq('id', targetCreativeId).maybeSingle();
        cvRow = data;
      }
      if (!cvRow && resolvedProdId) {
        const { data } = await supabase.from('creative_versions').select('*').eq('product_id', resolvedProdId).order('created_at', { ascending: false }).limit(1).maybeSingle();
        cvRow = data;
      }

      if (!cvRow) {
        return res.status(404).json({ error: 'Creative Version não encontrada para montagem.' });
      }

      try {
        const { ProfessionalVideoEditor } = await import('../src/services/factory/professional-video-editor.js');
        const editor = new ProfessionalVideoEditor({ supabaseClient: supabase });
        const editorReport = await editor.editAndAssemble({
          creativeId: cvRow.id,
          version: cvRow.version_number || 1,
        });

        return res.status(200).json({
          success: true,
          ok: true,
          ...editorReport,
        });
      } catch (err) {
        return res.status(500).json({ error: 'Erro na montagem do vídeo: ' + err.message });
      }
    }

    if (action === 'APPLY_SUBTITLES_AND_GRAPHICS') {
      let resolvedProdId = productId;
      let targetCreativeId = req.body?.creativeId || creativeId;

      if (!targetCreativeId && !resolvedProdId && interventionId) {
        const cleanId = String(interventionId).replace('appr-', '');
        const { data: appr } = await supabase.from('publication_approvals').select('creative_id, product_id').eq('id', cleanId).maybeSingle();
        targetCreativeId = appr?.creative_id;
        resolvedProdId = appr?.product_id;
      }

      let cvRow = null;
      if (targetCreativeId) {
        const { data } = await supabase.from('creative_versions').select('*').eq('id', targetCreativeId).maybeSingle();
        cvRow = data;
      }
      if (!cvRow && resolvedProdId) {
        const { data } = await supabase.from('creative_versions').select('*').eq('product_id', resolvedProdId).order('created_at', { ascending: false }).limit(1).maybeSingle();
        cvRow = data;
      }

      if (!cvRow) {
        return res.status(404).json({ error: 'Creative Version não encontrada para legendas.' });
      }

      try {
        const { SubtitleAndGraphicsDirector } = await import('../src/services/factory/subtitle-graphics-director.js');
        const director = new SubtitleAndGraphicsDirector({ supabaseClient: supabase });
        const masterReport = await director.processAndMasterVideo({
          creativeId: cvRow.id,
          version: cvRow.version_number || 1,
        });

        return res.status(200).json({
          success: true,
          ok: true,
          ...masterReport,
        });
      } catch (err) {
        return res.status(500).json({ error: 'Erro nas legendas e acabamento: ' + err.message });
      }
    }

    if (action === 'EVALUATE_CREATIVE_QC') {
      let resolvedProdId = productId;
      let targetCreativeId = req.body?.creativeId || creativeId;

      if (!targetCreativeId && !resolvedProdId && interventionId) {
        const cleanId = String(interventionId).replace('appr-', '');
        const { data: appr } = await supabase.from('publication_approvals').select('creative_id, product_id').eq('id', cleanId).maybeSingle();
        targetCreativeId = appr?.creative_id;
        resolvedProdId = appr?.product_id;
      }

      let cvRow = null;
      if (targetCreativeId) {
        const { data } = await supabase.from('creative_versions').select('*').eq('id', targetCreativeId).maybeSingle();
        cvRow = data;
      }
      if (!cvRow && resolvedProdId) {
        const { data } = await supabase.from('creative_versions').select('*').eq('product_id', resolvedProdId).order('created_at', { ascending: false }).limit(1).maybeSingle();
        cvRow = data;
      }

      if (!cvRow) {
        return res.status(404).json({ error: 'Creative Version não encontrada para QC.' });
      }

      try {
        const { CreativeQualityControl } = await import('../src/services/factory/creative-quality-control.js');
        const qc = new CreativeQualityControl({ supabaseClient: supabase });
        const autoFix = req.body?.autoFix !== false;
        const report = await qc.executeQC({
          creativeId: cvRow.id,
          autoFix,
        });

        return res.status(200).json({
          success: true,
          ok: report.success,
          ...report,
        });
      } catch (err) {
        return res.status(500).json({ error: 'Erro no Controle de Qualidade (QC): ' + err.message });
      }
    }

    if (action === 'OPEN_AFFILIATE_GENERATOR') {
      try {
        const result = await new ManualAffiliateFlow({ supabaseClient: supabase }).requestOpen(interventionId);
        return res.status(200).json(result);
      } catch (err) {
        return res.status(200).json({ success: true, status: 'QUEUED', message: 'Gerador acionado.' });
      }
    }

    if (action === 'SUBMIT_AFFILIATE_LINK') {
      const targetId = interventionId || approvalId || productId;
      try {
        const result = await new ManualAffiliateFlow({ supabaseClient: supabase }).saveDetectedLink(targetId, rawLink);
        return res.status(result.success ? 200 : 422).json(result);
      } catch (err) {
        console.error('Erro em SUBMIT_AFFILIATE_LINK:', err);
        return res.status(422).json({ success: false, reason: err.message || 'Falha ao processar link de afiliado.' });
      }
    }

    if (action === 'START_CREATIVE_PIPELINE') {
      if (!productId) return res.status(400).json({ error: 'productId é obrigatório para iniciar pipeline de criativo.' });
      const { data: prod } = await supabase.from('products').select('*').eq('id', productId).single();
      if (!prod) return res.status(404).json({ error: 'Produto não encontrado.' });
      const request = await new ManualAffiliateFlow({ supabaseClient: supabase }).selectProduct(prod);
      return res.status(200).json({ success: true, interventionId: request.id, status: request.metadata?.step });
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
      const nowIso = new Date().toISOString();

      // 1. Resolve todas as intervenções pendentes / ativas do operador
      const { error: intErr } = await supabase
        .from('operator_interventions')
        .update({ status: 'RESOLVED', resolved_at: nowIso })
        .neq('status', 'RESOLVED');

      if (intErr) console.warn('[Controls] Erro ao resolver intervenções:', intErr.message);

      // 2. Descarta todas as aprovações e revisões pendentes
      const { error: apprErr } = await supabase
        .from('publication_approvals')
        .update({ status: 'DISMISSED', updated_at: nowIso })
        .in('status', ['WAITING_ADMIN_REVIEW', 'PENDING', 'WAITING_AFFILIATE_LINK']);

      if (apprErr) console.warn('[Controls] Erro ao descartar aprovações:', apprErr.message);

      // 3. Atualiza system_state caso estivesse aguardando aprovação ou link
      const { data: st } = await supabase.from('system_state').select('status, current_step').eq('id', 'autopilot').maybeSingle();
      if (st && (st.status === 'AGUARDANDO APROVAÇÃO' || st.status === 'AGUARDANDO LINK AFILIADO' || (st.current_step && st.current_step.includes('Aguardando')))) {
        await supabase
          .from('system_state')
          .update({
            status: 'ONLINE',
            current_step: 'Painel limpo pelo operador. Pronto para novas operações.',
            updated_at: nowIso,
          })
          .eq('id', 'autopilot');
      }

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
        const cleanId = String(interventionId).replace('appr-', '');
        const nowIso = new Date().toISOString();
        await supabase.from('operator_interventions')
          .update({ status: 'RESOLVED', resolved_at: nowIso })
          .or(`id.eq.${cleanId},metadata->>approvalId.eq.${cleanId}`);
        await supabase.from('publication_approvals')
          .update({ status: 'DISMISSED', updated_at: nowIso })
          .eq('id', cleanId);
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
