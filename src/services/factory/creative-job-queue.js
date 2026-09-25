/**
 * ACHAki Autopilot — CreativeJobQueue
 *
 * Gerenciador de fila e processamento assíncrono de jobs criativos da fábrica local.
 * Implementa:
 * - Trava de concorrência (Claim/Lock com worker_id)
 * - Priorização (HIGH > NORMAL > LOW)
 * - Roteamento com CreativeProviderRouter
 * - Composição com VideoComposer (FFmpeg)
 * - Upload para Supabase Storage
 * - Integração direta com a máquina de estados existente (CREATIVE_READY -> CREATIVE_REVIEW)
 */

import { supabase } from '../../database/supabase.js';
import logger from '../../utils/logger.js';
import eventLogger from '../event-logger.js';
import { LocalHardwareProbe } from './local-hardware-probe.js';
import { ComfyUIClient } from './comfyui-client.js';
import { CreativeProviderRouter, CREATIVE_PROVIDERS } from './creative-provider-router.js';
import mediaAssetService from './media-asset-service.js';
import videoComposer from './video-composer.js';
import creativeStorageService from './creative-storage-service.js';
import localCreativeCacheManager from './local-creative-cache-manager.js';

export const JOB_STATUSES = {
  PENDING: 'PENDING',
  WAITING_LOCAL_WORKER: 'WAITING_LOCAL_WORKER',
  CLAIMED: 'CLAIMED',
  PREPARING: 'PREPARING',
  GENERATING: 'GENERATING',
  COMPOSING: 'COMPOSING',
  UPLOADING: 'UPLOADING',
  CREATIVE_READY: 'CREATIVE_READY',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  REMAKE_REQUESTED: 'REMAKE_REQUESTED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
};

export class CreativeJobQueue {
  constructor({ workerId = 'worker-local' } = {}) {
    this.workerId = workerId;
    this.comfyui = new ComfyUIClient();
    this.maxConcurrent = Number(process.env.MAX_CONCURRENT_LOCAL_VIDEO_JOBS || 1);
    this.isProcessing = false;
    this.activeJobsCount = 0;
    this.currentJob = null;
    this.lastCreative = null;
  }

  /**
   * Enfileira um novo job na tabela creative_jobs.
   */
  async enqueueJob({
    productId,
    offerCandidateId = null,
    creativeVersion = 1,
    priority = 'NORMAL',
    headline = 'Oferta imperdível encontrada!',
    scriptData = {},
    metadata = {},
    idempotencyKey = null,
  }) {
    try {
      const key = idempotencyKey || `job_${productId}_v${creativeVersion}_${Date.now()}`;

      // Verifica se já existe job com a mesma idempotency_key
      const { data: existing } = await supabase
        .from('creative_jobs')
        .select('*')
        .eq('idempotency_key', key)
        .maybeSingle();

      if (existing) {
        logger.info(`[CreativeJobQueue] Job já existente para idempotency_key: ${key} [Status: ${existing.status}]`);
        return existing;
      }

      const payload = {
        product_id: productId,
        offer_candidate_id: offerCandidateId,
        creative_version: creativeVersion,
        job_type: 'VIDEO_9_16',
        priority,
        status: JOB_STATUSES.PENDING,
        workflow: 'wan2_2_i2v',
        prompt: headline,
        aspect_ratio: '9:16',
        duration_target: 15,
        idempotency_key: key,
        metadata: {
          ...metadata,
          headline,
          scriptData,
          enqueuedAt: new Date().toISOString(),
        },
      };

      const { data: inserted, error } = await supabase
        .from('creative_jobs')
        .insert(payload)
        .select()
        .single();

      if (error) {
        throw new Error(`Falha ao enfileirar job criativo: ${error.message}`);
      }

      logger.info(`[CreativeJobQueue] 🎬 Job criativo enfileirado com sucesso [ID: ${inserted.id}] [Prioridade: ${priority}]`);

      await eventLogger.info('ORCHESTRATOR', `🎬 Novo job criativo criado na fábrica [ID: ${inserted.id}]. Prioridade: ${priority}.`, {
        action: 'CREATIVE_JOB_CREATED',
        metadata: { jobId: inserted.id, productId, priority },
      });

      return inserted;
    } catch (err) {
      logger.error(`[CreativeJobQueue] Erro ao enfileirar job: ${err.message}`);
      throw err;
    }
  }

  /**
   * Processa o próximo job pendente da fila respeitando prioridade e capacidade da máquina.
   */
  async processNextJob() {
    if (this.activeJobsCount >= this.maxConcurrent) {
      return { status: 'BUSY', activeJobsCount: this.activeJobsCount };
    }

    try {
      // 1. Busca job de maior prioridade (HIGH > NORMAL > LOW) que esteja PENDING ou WAITING_LOCAL_WORKER
      const { data: jobs, error } = await supabase
        .from('creative_jobs')
        .select('*, products(*)')
        .in('status', [JOB_STATUSES.PENDING, JOB_STATUSES.WAITING_LOCAL_WORKER])
        .order('priority', { ascending: false }) // HIGH antes de NORMAL/LOW
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) {
        logger.warn(`[CreativeJobQueue] Erro ao consultar fila: ${error.message}`);
        return null;
      }

      if (!jobs || jobs.length === 0) {
        return null; // Fila vazia
      }

      const job = jobs[0];

      // 2. Lock/Claim atômico para impedir duplicidade entre instâncias
      const nowIso = new Date().toISOString();
      const { data: claimed, error: claimErr } = await supabase
        .from('creative_jobs')
        .update({
          status: JOB_STATUSES.CLAIMED,
          worker_id: this.workerId,
          started_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', job.id)
        .in('status', [JOB_STATUSES.PENDING, JOB_STATUSES.WAITING_LOCAL_WORKER])
        .select()
        .single();

      if (claimErr || !claimed) {
        // Outro processo ou worker pegou o job
        return null;
      }

      logger.info(`[CreativeJobQueue] 🔒 Job reivindicado pelo worker [Job: ${job.id}]`);
      this.activeJobsCount++;
      this.currentJob = { id: job.id, startedAt: nowIso, priority: job.priority };

      await eventLogger.info('ROBOT', `Fábrica local assumiu produção do criativo [Job: ${job.id}].`, {
        action: 'WORKER_CLAIMED',
        metadata: { jobId: job.id, workerId: this.workerId },
      });

      // Executa job assincronamente sem travar chamadas subsequentes
      this._executeJob(job)
        .catch(err => {
          logger.error(`[CreativeJobQueue] Falha fatal no job ${job.id}: ${err.message}`);
        })
        .finally(() => {
          this.activeJobsCount--;
          this.currentJob = null;
        });

      return { status: 'CLAIMED', jobId: job.id };
    } catch (err) {
      logger.error(`[CreativeJobQueue] Erro no processNextJob: ${err.message}`);
      return null;
    }
  }

  /**
   * Executa as fases do pipeline do job:
   * PREPARING -> GENERATING -> COMPOSING -> UPLOADING -> CREATIVE_READY
   */
  async _executeJob(job) {
    const jobId = job.id;
    const product = job.products || {};

    try {
      // 1. Sonda de hardware e Roteamento de Provedor
      await this._updateJobStatus(jobId, JOB_STATUSES.PREPARING);

      const hw = await LocalHardwareProbe.probe();
      const route = await CreativeProviderRouter.routeJob({
        hardwareProbe: hw,
        preferredProvider: job.provider,
      });

      logger.info(`[CreativeJobQueue] Roteador definiu provedor: ${route.provider} (${route.reason})`);

      // Se vídeo generativo ComfyUI era obrigatório e está offline
      if (job.provider === CREATIVE_PROVIDERS.LOCAL_COMFYUI && !hw.comfyui.online && route.provider !== CREATIVE_PROVIDERS.COMPOSITOR_ONLY) {
        logger.warn(`[CreativeJobQueue] ComfyUI indisponível. Colocando job em WAITING_LOCAL_WORKER.`);
        await this._updateJobStatus(jobId, JOB_STATUSES.WAITING_LOCAL_WORKER, {
          error_message: 'ComfyUI offline na porta 8188. Aguardando inicialização do ambiente local.',
        });
        return;
      }

      // 2. Download e preparação de assets locais
      const rawImageUrl = product.image_url || job.metadata?.imageUrl;
      if (!rawImageUrl) {
        throw new Error('Produto não possui URL de imagem válida para o criativo.');
      }

      const localImgPath = await mediaAssetService.downloadProductImage(rawImageUrl);

      // 3. Geração / Composição do Vídeo 9:16
      await this._updateJobStatus(jobId, JOB_STATUSES.COMPOSING, { provider: route.provider });

      const headline = job.prompt || job.metadata?.headline || 'Olha essa novidade!';
      const price = product.current_price || product.price || 0;
      const discount = product.discount_percent || 0;

      const composed = await videoComposer.composeProductVideo({
        imagePath: localImgPath,
        title: product.title || 'Produto ACHAki',
        price,
        discountPercent: discount,
        headline,
        duration: job.duration_target || 15,
        outputFilename: `job_${jobId}_v${job.creative_version}.mp4`,
      });

      // 4. Upload para Supabase Storage
      await this._updateJobStatus(jobId, JOB_STATUSES.UPLOADING);

      const storageResult = await creativeStorageService.uploadCreativePackage({
        productId: job.product_id,
        creativeId: jobId,
        version: job.creative_version,
        videoPath: composed.videoPath,
        thumbnailPath: composed.thumbnailPath,
      });

      // 5. Registra o asset gerado na tabela creative_assets
      const { data: assetRecord } = await supabase
        .from('creative_assets')
        .insert({
          product_id: job.product_id,
          marketplace: product.marketplace || 'mercadolivre',
          marketplace_product_id: product.marketplace_product_id,
          type: 'VIDEO',
          source_url: rawImageUrl,
          storage_url: storageResult.videoUrl,
          thumbnail_url: storageResult.thumbnailUrl,
          mime_type: 'video/mp4',
          width: 1080,
          height: 1920,
          duration: composed.duration,
          file_size: composed.fileSize,
          source: route.provider,
          usage_status: 'AVAILABLE',
          metadata: {
            jobId,
            aspectRatio: '9:16',
            resolution: composed.resolution,
            localPath: composed.videoPath,
          },
        })
        .select()
        .single();

      // 6. Registra/Atualiza em creative_versions
      const { data: creativeVer } = await supabase
        .from('creative_versions')
        .insert({
          product_id: job.product_id,
          version_number: job.creative_version,
          status: 'CREATIVE_READY',
          aspect_ratio: '9:16',
          video_url: storageResult.videoUrl,
          thumbnail_url: storageResult.thumbnailUrl,
          duration: composed.duration,
          headline,
          script_data: job.metadata?.scriptData || {},
          metadata: {
            jobId,
            assetId: assetRecord?.id,
            provider: route.provider,
            composedAt: new Date().toISOString(),
          },
        })
        .select()
        .single();

      // 7. Conecta ao fluxo de aprovação existente
      const deliveryResult = await this._deliverToApprovalPipeline({
        job,
        product,
        creativeVersion: creativeVer,
        storageResult,
      });

      // 8. Conclui o job
      const completedIso = new Date().toISOString();
      await supabase
        .from('creative_jobs')
        .update({
          status: JOB_STATUSES.CREATIVE_READY,
          creative_id: creativeVer?.id,
          output_asset_id: assetRecord?.id,
          completed_at: completedIso,
          updated_at: completedIso,
        })
        .eq('id', jobId);

      this.lastCreative = {
        jobId,
        productId: job.product_id,
        videoUrl: storageResult.videoUrl,
        thumbnailUrl: storageResult.thumbnailUrl,
        completedAt: completedIso,
        duration: composed.duration,
      };

      logger.info(`[CreativeJobQueue] 🎉 Job [ID: ${jobId}] concluído com sucesso: ${storageResult.videoUrl}`);

      await eventLogger.info('ORCHESTRATOR', `🎬 Criativo 9:16 concluído na fábrica local para "${product.title?.slice(0, 45)}...".`, {
        action: 'CREATIVE_READY',
        metadata: { jobId, creativeId: creativeVer?.id, videoUrl: storageResult.videoUrl },
      });

      // 9. Limpeza de cache temporário
      await localCreativeCacheManager.cleanExpiredCache().catch(() => {});

      return { success: true, creativeId: creativeVer?.id, videoUrl: storageResult.videoUrl };
    } catch (err) {
      logger.error(`[CreativeJobQueue] Falha na execução do job ${jobId}: ${err.message}`);

      await supabase
        .from('creative_jobs')
        .update({
          status: JOB_STATUSES.FAILED,
          error_code: 'GENERATION_ERROR',
          error_message: err.message,
          retry_count: (job.retry_count || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);

      return { success: false, error: err.message };
    }
  }

  /**
   * Encaminha o criativo gerado diretamente para a máquina de aprovação existente
   * (publication_approvals + operator_interventions de CREATIVE_REVIEW).
   */
  async _deliverToApprovalPipeline({ job, product, creativeVersion, storageResult }) {
    try {
      const approvalToken = `appr_${job.id}_v${creativeVersion.version_number}_${Date.now()}`;
      const idempotencyKey = `pub_appr_${job.id}_v${creativeVersion.version_number}`;

      // 1. Cria ou reutiliza aprovação pendente
      const { data: apprRecord, error: apprErr } = await supabase
        .from('publication_approvals')
        .insert({
          creative_version_id: creativeVersion.id,
          creative_id: creativeVersion.id,
          product_id: job.product_id,
          marketplace: product.marketplace || 'mercadolivre',
          marketplace_product_id: product.marketplace_product_id,
          approval_token: approvalToken,
          status: 'PENDING',
          affiliate_link_status: 'WAITING',
          idempotency_key: idempotencyKey,
          metadata: {
            jobId: job.id,
            versionNumber: creativeVersion.version_number,
            videoUrl: storageResult.videoUrl,
            thumbnailUrl: storageResult.thumbnailUrl,
            duration: creativeVersion.duration,
            strategy: 'DESCONTO',
            aspectRatio: '9:16',
          },
        })
        .select()
        .single();

      if (apprErr) {
        logger.warn(`[CreativeJobQueue] Registro de aprovação: ${apprErr.message}`);
      }

      // 2. Dispara intervenção CREATIVE_REVIEW para o celular do admin
      const { default: interventionManager } = await import('../intervention-manager.js');
      await interventionManager.requestIntervention({
        type: 'CREATIVE_REVIEW',
        marketplace: product.marketplace || 'mercadolivre',
        title: '🎬 Novo vídeo ACHAki pronto para aprovação',
        message: `Vídeo 9:16 gerado para "${product.title?.slice(0, 50)}...". Assista e aprove ou peça refação pelo celular.`,
        targetUrl: product.product_url || 'https://www.mercadolivre.com.br',
        actionLabel: 'Revisar Criativo 9:16',
        metadata: {
          approvalId: apprRecord?.id,
          creativeId: creativeVersion.id,
          productId: job.product_id,
          marketplaceProductId: product.marketplace_product_id,
          productUrl: product.product_url,
          videoUrl: storageResult.videoUrl,
          thumbnailUrl: storageResult.thumbnailUrl,
          duration: creativeVersion.duration,
          price: product.current_price || product.price,
          discountPercent: product.discount_percent,
          strategy: 'DESCONTO',
          versionNumber: creativeVersion.version_number,
          headline: creativeVersion.headline,
          aspectRatio: '9:16',
        },
      });

      logger.info(`[CreativeJobQueue] 📱 Criativo entregue com sucesso ao sistema de aprovação mobile [Approval: ${apprRecord?.id}]`);
    } catch (err) {
      logger.error(`[CreativeJobQueue] Erro ao entregar para aprovação: ${err.message}`);
    }
  }

  async _updateJobStatus(jobId, status, extra = {}) {
    await supabase
      .from('creative_jobs')
      .update({
        status,
        ...extra,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);
  }

  /**
   * Retorna snapshot do estado da fábrica para inclusão no heartbeat do worker.
   */
  async getFactorySnapshot() {
    const hw = await LocalHardwareProbe.probe();

    // Contagem da fila
    const { count } = await supabase
      .from('creative_jobs')
      .select('*', { count: 'exact', head: true })
      .in('status', [JOB_STATUSES.PENDING, JOB_STATUSES.WAITING_LOCAL_WORKER]);

    return {
      worker: 'ONLINE',
      comfyui: hw.comfyui.online ? 'ONLINE' : 'OFFLINE',
      gpu: hw.gpu.cudaAvailable ? 'READY' : 'UNAVAILABLE',
      gpuName: hw.gpu.name,
      vramFreeMb: hw.gpu.vramFreeMb,
      activeJob: this.currentJob,
      queueLength: count || 0,
      wanModelAvailable: hw.wanModelAvailable,
      lastCreative: this.lastCreative,
      updatedAt: new Date().toISOString(),
    };
  }
}

export default new CreativeJobQueue();
