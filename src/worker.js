/**
 * ACHAki Autopilot — Worker Local Operacional
 *
 * Responsável por:
 *  1. Emitir Heartbeat periódico para o Supabase (worker_heartbeats)
 *  2. Escutar a fila de comandos (robot_commands) via Realtime + Polling
 *  3. Reivindicar atomicamente comandos (ex: RUN_NOW)
 *  4. Executar o pipeline real completo com Playwright e serviços locais
 *  5. Emitir telemetria ao vivo via EventLogger em todas as etapas
 *  6. Respeitar o modo DRY_RUN_PUBLICATION (não publica no Facebook)
 *
 * USO:
 *   npm run worker
 */

import 'dotenv/config';
import os from 'os';
import crypto from 'crypto';
import { supabase } from './database/supabase.js';
import eventLogger from './services/event-logger.js';
import BrowserManager from './browser/browser.js';
import OpenRouterAgent from './agents/openrouter-agent.js';
import JevAgent from './agents/jev-agent.js';
import ProductSearchService from './services/product-search.js';
import AffiliateLinkService from './services/affiliate-link-service.js';
import ManualAffiliateFlow from './services/manual-affiliate-flow.js';
import TrackingService from './services/tracking-service.js';
import CreativeEngine from './services/creative-engine.js';
import PriceValidationEngine from './services/price-validation-engine.js';
import logger from './utils/logger.js';
import DemandIntelligenceEngine from './services/demand/demand-intelligence-engine.js';
import OpportunityEngine from './services/demand/opportunity-engine.js';
import creativeJobQueue from './services/factory/creative-job-queue.js';

const WORKER_ID = process.env.WORKER_ID || `worker-${os.hostname().toLowerCase().replace(/[^a-z0-9]/g, '')}`;
const HEARTBEAT_INTERVAL_MS = 10000; // 10 segundos
const POLL_INTERVAL_MS = 3000; // 3 segundos fallback
// Configuração Explícita para Publicação Externa (LIVE_PUBLICATION)
// SEGURANÇA: Por padrão, LIVE_PUBLICATION é false e DRY_RUN é true.
// Para ativar a postagem real externa no Facebook, configure no .env: LIVE_PUBLICATION=true e DRY_RUN_PUBLICATION=false.
const LIVE_PUBLICATION = process.env.LIVE_PUBLICATION === 'true' && process.env.DRY_RUN_PUBLICATION === 'false';
const DRY_RUN_PUBLICATION = !LIVE_PUBLICATION;
// Ciclo de monitoramento de demanda: 20 minutos (NÃO é frequência obrigatória de publicação)
const DEMAND_SCAN_INTERVAL_MS = (parseInt(process.env.DEMAND_SCAN_INTERVAL_MINUTES, 10) || 20) * 60 * 1000;

// Limites de Segurança Iniciais para Fase Live (Invioláveis)
const MAX_PUBLICATIONS_PER_DAY = 6;
const MAX_PUBLICATIONS_PER_CYCLE = 1;
const MIN_COOLDOWN_MINUTES = 45;

class RobotWorker {
  constructor() {
    this.workerId = WORKER_ID;
    this.hostname = os.hostname();
    this.isWorking = false;
    this.currentStep = 'AGUARDANDO';
    this.currentRunId = null;
    this.heartbeatTimer = null;
    this.pollTimer = null;
    this.demandScanTimer = null;
    this.realtimeChannel = null;
    this.isShuttingDown = false;
    this.priceValidationEngine = new PriceValidationEngine();
    this.demandEngine = new DemandIntelligenceEngine();
    this.opportunityEngine = new OpportunityEngine({ priceValidationEngine: this.priceValidationEngine });
    this.stateChannel = null;
    this.creativeJobTimer = null;
  }

  /**
   * Aciona parada automática (Auto-Stop) em caso de falha de segurança ou autenticação.
   */
  async _handleAutoStop(reason, details = {}) {
    logger.error(`[Worker] 🛑 AUTO-STOP ACIONADO: ${reason}`);
    await eventLogger.error('ERROR', `🛑 AUTO-STOP ACIONADO: ${reason}`, {
      action: 'AUTO_STOP_TRIGGERED',
      metadata: { reason, ...details },
    });

    try {
      await supabase
        .from('system_state')
        .update({
          status: 'PAUSADO_ERRO_CRITICO',
          current_step: `AUTO-STOP: ${reason}. Publicações suspensas automaticamente por segurança.`,
          autopilot_mode: 'ASSISTIDO',
          updated_at: new Date().toISOString(),
        })
        .eq('id', 'autopilot');
    } catch (e) {
      logger.error(`[Worker] Falha ao persistir AUTO-STOP no banco: ${e.message}`);
    }
  }

  /**
   * Emite heartbeat atômico para o Supabase.
   */
  async emitHeartbeat(customStep = null, customStatus = null) {
    if (this.isShuttingDown) return;
    try {
      let step = customStep || this.currentStep;
      const status = customStatus || (this.isWorking ? 'TRABALHANDO' : 'IDLE');

      // Se o worker não estiver trabalhando e o step for AGUARDANDO, confere se há publicação assistida
      if (!this.isWorking && (!step || step === 'AGUARDANDO')) {
        try {
          const { data: pendingAssisted } = await supabase
            .from('publications')
            .select('id')
            .eq('status', 'ASSISTED_READY')
            .limit(1);

          if (pendingAssisted && pendingAssisted.length > 0) {
            step = 'AGUARDANDO APROVAÇÃO';
            this.currentStep = step;
          }
        } catch {}
      }

      let factorySnapshot = null;
      try {
        factorySnapshot = await creativeJobQueue.getFactorySnapshot();
      } catch {}

      const payload = {
        worker_id: this.workerId,
        last_heartbeat_at: new Date().toISOString(),
        status,
        current_step: step,
        current_run_id: this.currentRunId,
        hostname: this.hostname,
        creative_factory: factorySnapshot,
        metadata: {
          pid: process.pid,
          nodeVersion: process.version,
          platform: process.platform,
          dryRun: DRY_RUN_PUBLICATION,
          uptimeSeconds: Math.round(process.uptime()),
        },
        updated_at: new Date().toISOString(),
      };

      await supabase
        .from('worker_heartbeats')
        .upsert(payload, { onConflict: 'worker_id' });
    } catch (err) {
      logger.warn(`[Worker] Falha ao enviar heartbeat: ${err.message}`);
    }
  }

  /**
   * Atualiza o passo atual da execução e emite heartbeat imediatamente.
   */
  async setStep(step) {
    this.currentStep = step;
    await this.emitHeartbeat(step);
  }

  /**
   * Inicializa o worker, timers e canal Realtime.
   */
  async start() {
    console.log('\n===============================================================');
    console.log('  🤖 ACHAki Autopilot — Worker Operacional Local');
    console.log(`  Worker ID : ${this.workerId}`);
    console.log(`  Hostname  : ${this.hostname} (PID: ${process.pid})`);
    console.log(`  Modo      : ${DRY_RUN_PUBLICATION ? 'DRY_RUN_PUBLICATION (Seguro)' : 'REAL_PUBLICATION'}`);
    console.log(`  Scan Demanda: ${DEMAND_SCAN_INTERVAL_MS / 60000} min (monitoramento, NÃO frequência de publicação)`);
    console.log('===============================================================\n');

    // 1. Heartbeat inicial
    await this.emitHeartbeat('AGUARDANDO', 'IDLE');
    this.heartbeatTimer = setInterval(() => this.emitHeartbeat(), HEARTBEAT_INTERVAL_MS);

    // 2. Registrar evento de inicialização no log ao vivo
    await eventLogger.info('ROBOT', `Worker local operacional iniciado [${this.workerId}]`, {
      action: 'WORKER_START',
      metadata: { workerId: this.workerId, hostname: this.hostname, dryRun: DRY_RUN_PUBLICATION },
    });

    // 3. Conexão Realtime com a tabela robot_commands
    this._setupRealtimeListener();

    // 4. Polling periódico como fallback
    this.pollTimer = setInterval(() => this._pollPendingCommands(), POLL_INTERVAL_MS);

    // 5. Verificação imediata se há comandos pendentes
    await this._pollPendingCommands();

    // 6. Ciclo de monitoramento de demanda (modo AUTÔNOMO apenas)
    //    20 minutos = ciclo de observação, NÃO obrigação de publicar
    this.demandScanTimer = setInterval(() => this._runDemandScanCycle(), DEMAND_SCAN_INTERVAL_MS);

    // 7. Fila assíncrona da fábrica de criativos locais (comfyui / ffmpeg)
    this.creativeJobTimer = setInterval(() => {
      creativeJobQueue.processNextJob().catch(() => {});
    }, 10000);

    console.log('✓ Worker escutando comandos do Centro de Comando...\n');
    console.log(`✓ Ciclo de inteligência de demanda agendado (${DEMAND_SCAN_INTERVAL_MS / 60000} min).\n`);
    console.log('✓ Fábrica de criativos local integrada e ativa (polling 10s).\n');
  }

  /**
   * Configura assinatura Supabase Realtime para notificações imediatas de novos comandos.
   */
  _setupRealtimeListener() {
    try {
      this.realtimeChannel = supabase
        .channel(`worker:${this.workerId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'robot_commands' },
          async (payload) => {
            if (payload?.new && payload.new.status === 'PENDING') {
              logger.info(`[Worker] Novo comando recebido via Realtime: ${payload.new.command} (ID: ${payload.new.id})`);
              await this._tryClaimAndExecute(payload.new);
            }
          }
        )
        .subscribe();

      // Assinatura em tempo real para mudanças de modo no Centro de Comando
      this.stateChannel = supabase
        .channel(`worker-state:${this.workerId}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'system_state' },
          async (payload) => {
            if (payload?.new?.autopilot_mode) {
              const newMode = payload.new.autopilot_mode;
              logger.info(`[Worker] 🕹️ Modo operacional recebido do Centro de Comando: ${newMode}`);
              await eventLogger.info('ROBOT', `Modo operacional atualizado para: ${newMode}`, {
                action: 'AUTOPILOT_MODE_CHANGED',
                metadata: { mode: newMode },
              });
            }
          }
        )
        .subscribe();
    } catch (err) {
      logger.warn(`[Worker] Erro ao subscrever canal Realtime: ${err.message}`);
    }
  }

  /**
   * Consulta a fila de comandos pendentes no banco (fallback resiliente).
   */
  async _pollPendingCommands() {
    if (this.isWorking || this.isShuttingDown) return;

    try {
      const { data: pendingCommands, error } = await supabase
        .from('robot_commands')
        .select('*')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) {
        logger.warn(`[Worker] Erro ao consultar fila de comandos: ${error.message}`);
        return;
      }

      if (pendingCommands && pendingCommands.length > 0) {
        await this._tryClaimAndExecute(pendingCommands[0]);
      }
    } catch (err) {
      logger.warn(`[Worker] Erro no polling de comandos: ${err.message}`);
    }
  }

  /**
   * Tenta reivindicar atomicamente o comando no banco.
   * Evita duplicidade de execução se houver concorrência.
   */
  async _tryClaimAndExecute(cmd) {
    if (this.isWorking || this.isShuttingDown) return;

    try {
      const nowIso = new Date().toISOString();

      // UPDATE atômico com WHERE status = 'PENDING'
      const { data: claimed, error } = await supabase
        .from('robot_commands')
        .update({
          status: 'CLAIMED',
          worker_id: this.workerId,
          claimed_at: nowIso,
        })
        .eq('id', cmd.id)
        .eq('status', 'PENDING')
        .select('*')
        .maybeSingle();

      if (error || !claimed) {
        // Comando já foi reivindicado por outro processo ou cancelado
        return;
      }

      // Reivindicação bem sucedida: inicia processamento
      await this._processCommand(claimed);
    } catch (err) {
      logger.error(`[Worker] Falha ao reivindicar comando ${cmd.id}:`, err);
    }
  }

  /**
   * Processa o comando reivindicado executando o pipeline correspondente.
   */
  async _processCommand(cmd) {
    this.isWorking = true;
    const runId = crypto.randomUUID();
    this.currentRunId = runId;
    eventLogger.setRunId(runId);

    const startTime = Date.now();

    try {
      // 1. Atualiza comando para RUNNING
      await supabase
        .from('robot_commands')
        .update({
          status: 'RUNNING',
          started_at: new Date().toISOString(),
          run_id: runId,
        })
        .eq('id', cmd.id);

      await this.setStep('COMANDO RECEBIDO');

      await eventLogger.info('ROBOT', `Comando [${cmd.command}] recebido pelo worker local [ID: ${cmd.id.slice(0, 8)}]`, {
        action: 'COMMAND_RECEIVED',
        metadata: { commandId: cmd.id, command: cmd.command },
      });

      await eventLogger.info('ROBOT', `Ciclo real iniciado [Run ID: ${runId.slice(0, 8)}]`, {
        action: 'CYCLE_START',
        metadata: { runId, commandId: cmd.id },
      });

      if (cmd.command === 'RUN_NOW') {
        await this._executeRealPipeline(cmd, runId);
      } else if (cmd.command === 'OPEN_AFFILIATE_GENERATOR') {
        const browser = new BrowserManager();
        browser.headless = false;
        try {
          await browser.launch();
          await this.setStep('AGUARDANDO LINK DO ADMINISTRADOR');
          await new ManualAffiliateFlow().captureInSession(cmd.metadata.interventionId, browser);
        } finally {
          await browser.close();
        }
      } else if (cmd.command === 'APPROVE_PUBLICATION') {
        await this._executeApprovePublication(cmd, runId);
      } else if (cmd.command === 'PAUSE') {
        await this.setStep('PAUSADO');
        await eventLogger.warning('ROBOT', 'Operador pausado pelo Centro de Comando', { action: 'PAUSED' });
      } else if (cmd.command === 'RESUME') {
        await this.setStep('AGUARDANDO');
        await eventLogger.info('ROBOT', 'Operador retomado e ativo para novos ciclos', { action: 'RESUMED' });
      }

      // Conclusão com sucesso
      const durationMs = Date.now() - startTime;
      await supabase
        .from('robot_commands')
        .update({
          status: 'COMPLETED',
          finished_at: new Date().toISOString(),
          metadata: {
            ...cmd.metadata,
            result: 'COMPLETED',
            durationMs,
            finishedAt: new Date().toISOString(),
          },
        })
        .eq('id', cmd.id);

      // Se houver publicação em ASSISTED_READY, mantém o status informativo
      const { data: pendingAssisted } = await supabase
        .from('publications')
        .select('id')
        .eq('status', 'ASSISTED_READY')
        .limit(1);

      if (pendingAssisted && pendingAssisted.length > 0) {
        await this.setStep('AGUARDANDO APROVAÇÃO');
        await supabase
          .from('system_state')
          .update({
            status: 'AGUARDANDO APROVAÇÃO',
            current_step: 'Publicação preparada. Aguardando revisão e aprovação humana.',
            updated_at: new Date().toISOString(),
          })
          .eq('id', 'autopilot');
      } else {
        await this.setStep('AGUARDANDO');
      }
    } catch (err) {
      const durationMs = Date.now() - startTime;
      logger.error(`[Worker] Erro durante a execução do comando ${cmd.id}:`, err);

      await eventLogger.error('ERROR', `Falha na execução do pipeline: ${err.message}`, {
        action: 'PIPELINE_ERROR',
        durationMs,
        metadata: { error: err.message, stack: err.stack?.slice(0, 300) },
      });

      await supabase
        .from('robot_commands')
        .update({
          status: 'FAILED',
          finished_at: new Date().toISOString(),
          error: err.message,
          metadata: { ...cmd.metadata, durationMs },
        })
        .eq('id', cmd.id);

      await this.setStep('ERRO');
      setTimeout(() => this.setStep('AGUARDANDO'), 5000);
    } finally {
      this.isWorking = false;
      this.currentRunId = null;
      try {
        const { data: pendingAssisted } = await supabase
          .from('publications')
          .select('id')
          .eq('status', 'ASSISTED_READY')
          .limit(1);

        if (pendingAssisted && pendingAssisted.length > 0) {
          this.currentStep = 'AGUARDANDO APROVAÇÃO';
          await this.emitHeartbeat('AGUARDANDO APROVAÇÃO', 'IDLE');
          await supabase
            .from('system_state')
            .update({
              status: 'AGUARDANDO APROVAÇÃO',
              current_step: 'Publicação preparada. Aguardando revisão e aprovação humana.',
              updated_at: new Date().toISOString(),
            })
            .eq('id', 'autopilot');
        } else {
          await this.emitHeartbeat(this.currentStep || 'AGUARDANDO', 'IDLE');
        }
      } catch {
        await this.emitHeartbeat('AGUARDANDO', 'IDLE');
      }
    }
  }

  /**
   * Executa a aprovação e publicação segura no Facebook:
   *  1. Comando APPROVE_PUBLICATION recebido
   *  2. Revalidação final: produto disponível, preço atual, desconto, link oficial
   *  3. Se preço mudou: NÃO publica, atualiza card, volta para AGUARDANDO APROVAÇÃO
   *  4. Se indisponível: cancela e informa no log
   *  5. Se válido: publicação única e atômica com idempotency key
   *  6. Grava tudo no Supabase
   */
  async _executeApprovePublication(cmd, runId) {
    const pubId = cmd.metadata?.publicationId;
    const testOnly = cmd.metadata?.testOnly === true;

    await eventLogger.info('ROBOT', 'Comando APPROVE_PUBLICATION recebido', {
      action: 'APPROVE_PUBLICATION_RECEIVED',
      metadata: { commandId: cmd.id, publicationId: pubId },
    });

    // 1. Localiza a publicação pendente
    let query = supabase.from('publications').select('*, products(*)');
    if (pubId) {
      query = query.eq('id', pubId);
    } else {
      query = query.eq('status', 'ASSISTED_READY').order('created_at', { ascending: false }).limit(1);
    }
    const { data: pubList, error: pubErr } = await query;
    const pub = Array.isArray(pubList) ? pubList[0] : pubList;

    if (pubErr || !pub) {
      throw new Error(`Publicação preparada não encontrada no banco (ID: ${pubId || 'mais recente'})`);
    }

    // Idempotência estrita: se já estiver publicada, interrompe imediatamente
    if (pub.status === 'PUBLISHED') {
      await eventLogger.warning('FACEBOOK', 'Publicação já realizada anteriormente. Idempotência acionada.', {
        action: 'IDEMPOTENCY_BLOCKED',
        publicationId: pub.id,
      });
      return;
    }

    // 2. Revalidação final em tempo real na PDP (Validação 2)
    await this.setStep('VALIDANDO PREÇO');
    await eventLogger.info('PRICE', 'Revalidação final iniciada na página real do marketplace...', {
      action: 'PRICE_FINAL_REVALIDATION',
      publicationId: pub.id,
    });

    const browserManager = new BrowserManager();
    await browserManager.launch();
    this.priceValidationEngine.browserManager = browserManager;

    let latestPrice = Number(pub.price_published);
    let originalPrice = pub.original_price_published ? Number(pub.original_price_published) : null;
    let discountPercent = pub.discount_published ? Number(pub.discount_published) : 0;

    try {
      const page = await browserManager.openPage();
      const targetUrl = pub.metadata?.canonicalUrl || pub.metadata?.productUrl || pub.affiliate_url;

      const valRes = await this.priceValidationEngine.validateProductPage({
        url: targetUrl,
        expectedPrice: latestPrice,
        page,
      });

      // Se produto ficou indisponível ou página falhou:
      if (!valRes.isValid) {
        await supabase
          .from('publications')
          .update({ status: 'CANCELLED_UNAVAILABLE', updated_at: new Date().toISOString() })
          .eq('id', pub.id);

        await eventLogger.error('PRICE', `Produto indisponível ou preço não confirmado: ${valRes.reason}`, {
          action: valRes.validationCode,
          publicationId: pub.id,
        });
        await this.setStep('AGUARDANDO');
        return;
      }

      // Se preço mudou em relação ao aprovado:
      if (valRes.validationCode === 'PRICE_CHANGED') {
        const newPrice = valRes.data.currentPrice;
        originalPrice = valRes.data.originalPrice;
        discountPercent = valRes.data.discountPercent || 0;

        await supabase
          .from('publications')
          .update({
            price_published: newPrice,
            original_price_published: originalPrice,
            discount_published: discountPercent,
            metadata: {
              ...pub.metadata,
              price_changed: true,
              previous_price: latestPrice,
              new_price: newPrice,
              revalidated_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', pub.id);

        await eventLogger.warning(
          'PRICE',
          `Preço alterado no marketplace de R$ ${latestPrice.toFixed(2)} para R$ ${newPrice.toFixed(2)}. Card atualizado — publicação retida para nova aprovação.`,
          {
            action: 'PRICE_CHANGED_REAPPROVAL_REQUIRED',
            publicationId: pub.id,
            metadata: { previousPrice: latestPrice, newPrice },
          }
        );

        await this.setStep('AGUARDANDO APROVAÇÃO');
        return;
      }

      latestPrice = valRes.data.currentPrice;
      originalPrice = valRes.data.originalPrice || originalPrice;
      discountPercent = valRes.data.discountPercent || discountPercent;

      // Preço confirmado
      await eventLogger.success('PRICE', 'Preço confirmado', {
        action: 'PRICE_CONFIRMED',
        metadata: { currentPrice: latestPrice, discountPercent },
      });
    } finally {
      try {
        await browserManager.close();
      } catch {}
    }

    // 3. Link oficial confirmado (deve ser meli.la direto ou link de afiliado oficial)
    const affiliateUrl = pub.affiliate_url || pub.tracking_url;
    if (!affiliateUrl || affiliateUrl.length < 5) {
      throw new Error('Link de afiliado oficial inválido ou ausente na publicação preparada.');
    }

    await eventLogger.success('AFFILIATE', 'Link oficial confirmado', {
      action: 'AFFILIATE_CONFIRMED',
      metadata: { affiliateUrl },
    });

    // 4. Bloqueio de Idempotência Atômico no Banco (evita corrida / cliques múltiplos)
    const idempotencyKey = pub.idempotency_key || `post_${pub.id}_${pub.product_id || 'prod'}_${Date.now()}`;
    const { data: claimedPub, error: claimErr } = await supabase
      .from('publications')
      .update({
        status: 'PUBLISHING',
        idempotency_key: idempotencyKey,
        run_id: runId,
      })
      .eq('id', pub.id)
      .eq('status', 'ASSISTED_READY')
      .select('*')
      .maybeSingle();

    if (claimErr || !claimedPub) {
      await eventLogger.warning('FACEBOOK', 'Tentativa de publicação duplicada detectada (Idempotency Key ativa). Operação cancelada.', {
        action: 'IDEMPOTENCY_GUARD_TRIGGERED',
        publicationId: pub.id,
      });
      return;
    }

    // 5. Enviando publicação para o Facebook
    await this.setStep('PUBLICANDO NO FACEBOOK');
    await eventLogger.info('FACEBOOK', 'Enviando publicação', {
      action: 'FACEBOOK_SENDING',
      publicationId: pub.id,
    });

    let fbPostId = null;
    let fbPublicationUrl = null;

    if (testOnly || DRY_RUN_PUBLICATION) {
      // MODO TESTE / DRY-RUN: NÃO posta na Meta
      fbPostId = `dryrun_post_${Date.now()}`;
      fbPublicationUrl = `https://www.facebook.com/ACHAki/posts/${fbPostId}`;
    } else {
      // MODO REAL: Busca token e posta via Meta Graph API oficial
      const { data: stateData } = await supabase
        .from('system_state')
        .select('social_networks')
        .eq('id', 'autopilot')
        .maybeSingle();

      const sn = stateData?.social_networks || {};
      const pageAccessToken = sn.facebook_page_token || sn.facebook_user_token || sn.page_access_token || process.env.FB_PAGE_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN;
      const pageId = sn.facebook_page_id || '61587794361596';

      if (!pageAccessToken) {
        throw new Error('Facebook Page Access Token não encontrado em system_state. Autorize via OAuth primeiro.');
      }

      const FacebookPublisher = (await import('./publishers/facebook-publisher.js')).default;
      const publisher = new FacebookPublisher();

      const fbResult = await publisher.publishPost({
        pageId,
        pageAccessToken,
        message: pub.content,
        imageUrl: pub.media_url,
        link: affiliateUrl,
      });

      fbPostId = fbResult.postId;
      fbPublicationUrl = fbResult.publicationUrl;
    }

    await eventLogger.success('FACEBOOK', 'Publicação criada com sucesso', {
      action: 'FACEBOOK_POST_CREATED',
      publicationId: pub.id,
      metadata: { postId: fbPostId, publicationUrl: fbPublicationUrl },
    });

    // 6. DATABASE | Publicação registrada
    const publishedAt = new Date().toISOString();
    await supabase
      .from('publications')
      .update({
        status: 'PUBLISHED',
        facebook_post_id: fbPostId,
        publication_url: fbPublicationUrl,
        published_at: publishedAt,
        price_published: latestPrice,
        affiliate_url: affiliateUrl,
        content: pub.content,
        media_url: pub.media_url,
        run_id: runId,
        metadata: {
          ...pub.metadata,
          approved_by: 'operator',
          approved_at: new Date().toISOString(),
          dryRun: DRY_RUN_PUBLICATION || testOnly,
        },
      })
      .eq('id', pub.id);

    // Registra métrica inicial de cliques = 0
    await supabase.from('publication_metrics').insert({
      publication_id: pub.id,
      clicks: 0,
      impressions: 0,
      tracked_at: publishedAt,
    });

    await eventLogger.success('DATABASE', 'Publicação registrada', {
      action: 'DATABASE_SAVED',
      publicationId: pub.id,
      metadata: { postId: fbPostId, publicationUrl: fbPublicationUrl },
    });

    // 7. ROBOT | Publicação concluída
    await eventLogger.success('ROBOT', 'Publicação concluída', {
      action: 'PUBLICATION_COMPLETED',
      publicationId: pub.id,
      metadata: { postId: fbPostId, publicationUrl: fbPublicationUrl },
    });

    await this.setStep('AGUARDANDO');
  }

  /**
   * Executa o pipeline operacional real:
   *  COLETANDO -> ANALISANDO -> VALIDANDO PREÇO -> GERANDO LINK -> PREPARANDO PUBLICAÇÃO -> AGUARDANDO APROVAÇÃO
   */
  async _executeRealPipeline(cmd, runId) {
    const browserManager = new BrowserManager();
    const openrouterAgent = new OpenRouterAgent();
    const jevAgent = new JevAgent();

    try {
      // ─────────────────────────────────────────────────────────────
      // PASSO 1: COLETANDO
      // ─────────────────────────────────────────────────────────────
      await this.setStep('COLETANDO');
      await eventLogger.info('COLLECTOR', 'Coleta de produtos iniciada no Mercado Livre...', {
        action: 'COLLECT_START',
      });

      await browserManager.launch();

      const searchService = new ProductSearchService({
        browserManager,
        openrouterAgent,
        jevAgent,
      });

      const cycleResult = await searchService.searchAndSelect({
        limit: 5,
        itemsPerMarketplace: 5,
        runId,
      });

      const topOffers = (cycleResult?.topOffers || []).map(o => ({
        ...o,
        isLiveScrape: true,
        source: 'live_scrape'
      }));

      await eventLogger.success(
        'COLLECTOR',
        `${topOffers.length} produtos selecionados com relevância comercial comprovada`,
        {
          action: 'COLLECT_COMPLETE',
          metadata: { itemsFound: cycleResult.itemsFound || topOffers.length, selected: topOffers.length },
        }
      );

      // ─────────────────────────────────────────────────────────────
      // PASSO 2: ANALISANDO (JEV & Cache)
      // ─────────────────────────────────────────────────────────────
      await this.setStep('ANALISANDO');
      await eventLogger.info('AI', 'Análise orgânica e curadoria com JEV / Cache...', {
        action: 'AI_ANALYSIS_START',
      });

      // Consulta modo de operação ativo (ASSISTIDO ou AUTONOMO)
      const { data: stateData } = await supabase
        .from('system_state')
        .select('autopilot_mode')
        .eq('id', 'autopilot')
        .maybeSingle();
      const autopilotMode = stateData?.autopilot_mode || 'ASSISTIDO';

      logger.info(`[Worker] Modo de operação ativo: ${autopilotMode}`);

      // ─────────────────────────────────────────────────────────────
      // PASSO 2: ANALISANDO (JEV & Cache)
      // ─────────────────────────────────────────────────────────────
      await this.setStep('ANALISANDO');
      await eventLogger.info('AI', 'Análise orgânica e curadoria com JEV / Cache...', {
        action: 'AI_ANALYSIS_START',
      });

      if (!topOffers || topOffers.length === 0) {
        throw new Error('Nenhuma oferta qualificada foi obtida no ciclo de coleta.');
      }

      // ─────────────────────────────────────────────────────────────
      // PASSO 3: VALIDANDO PREÇO (Validação 1 — Pré-conteúdo com substituição automática)
      // ─────────────────────────────────────────────────────────────
      await this.setStep('VALIDANDO PREÇO');

      let chosenOffer = null;
      // ─────────────────────────────────────────────────────────────
      // PASSO 3 & 4: VALIDAÇÃO MULTI-SOURCE & CONFIRMAÇÃO DO LINK DE AFILIADO
      // ─────────────────────────────────────────────────────────────
      await this.setStep('VALIDANDO PREÇOS');

      // Recupera produtos aprovados do catálogo que já possuem link oficial comissionado (meli.la) confirmado
      let catalogCandidates = [];
      try {
        const { data: dbVerifiedProducts } = await supabase
          .from('products')
          .select(`
            id,
            marketplace,
            marketplace_product_id,
            title,
            category,
            product_url,
            image_url,
            affiliate_url,
            product_prices (
              current_price,
              original_price,
              discount_percent
            )
          `)
          .not('affiliate_url', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(5);

        if (dbVerifiedProducts && dbVerifiedProducts.length > 0) {
          catalogCandidates = dbVerifiedProducts.map(p => {
            const prices = p.product_prices || [];
            const latestP = prices[0] || {};
            return {
              dbId: p.id,
              productId: p.marketplace_product_id,
              marketplace: p.marketplace || 'mercadolivre',
              title: p.title,
              category: p.category || 'utilidades',
              productUrl: p.product_url,
              imageUrl: p.image_url,
              affiliateUrl: p.affiliate_url,
              currentPrice: Number(latestP.current_price || 0),
              originalPrice: Number(latestP.original_price || 0),
              discountPercent: Number(latestP.discount_percent || 0),
              score: 92,
              finalScore: 92,
              strategy: { code: 'DESCONTO', name: 'Desconto Real Comprovado' },
              isCatalogCandidate: true,
              isLiveScrape: false,
            };
          });
        }
      } catch (catErr) {
        logger.warn(`[Worker] Erro ao carregar catálogo com link verificado: ${catErr.message}`);
      }

      const priorityCandidates = [];
      if (cmd?.metadata?.candidate) {
        priorityCandidates.push(cmd.metadata.candidate);
      }

      let candidateIdx = 0;
      let candidatesPool = [...priorityCandidates, ...catalogCandidates, ...topOffers];
      this.priceValidationEngine.browserManager = browserManager;
      const affiliateService = new AffiliateLinkService({ browserManager });
      const trackingService = new TrackingService();
      let directAffiliateUrl = null;
      let trackingId = null;
      let trackingUrl = null;

      while (candidateIdx < candidatesPool.length) {
        const candidate = candidatesPool[candidateIdx];
        await eventLogger.info(
          'PRICE',
          `[Validação 1] Validando preço multi-source da oferta #${candidate.productId || candidate.dbId || 'MLB'} no marketplace...`,
          {
            action: 'PRICE_VALIDATION_START',
            metadata: { title: candidate.title, expectedPrice: candidate.currentPrice },
          }
        );

        const pageForValidation = await browserManager.openPage();
        const valRes = await this.priceValidationEngine.validateCandidatePrice(candidate, {
          page: pageForValidation,
          supabase,
          expectedPrice: candidate.currentPrice,
        });

        if (valRes.data?.pdpNote) {
          await eventLogger.info('PRICE', valRes.data.pdpNote, {
            action: 'PRICE_MULTI_SOURCE_FALLBACK',
            metadata: { confidence: valRes.confidence, source: valRes.data.source },
          });
        }

        if (!valRes.isValid || (valRes.confidence !== 'HIGH' && valRes.confidence !== 'MEDIUM')) {
          await eventLogger.warning(
            'PRICE',
            `Oferta descartada: ${valRes.reason || 'preço divergente ou confiança insuficiente.'}`,
            {
              action: 'OFFER_DISCARDED',
              metadata: { code: valRes.validationCode, title: candidate.title, reason: valRes.reason, confidence: valRes.confidence },
            }
          );
          candidateIdx++;
          if (candidateIdx < candidatesPool.length) {
            await eventLogger.info(
              'SELECTION',
              'Produto substituído por candidato de maior potencial.',
              {
                action: 'CANDIDATE_SUBSTITUTED',
                metadata: { nextCandidate: candidatesPool[candidateIdx].title },
              }
            );
          }
          continue;
        }

        let evaluatedOffer = { ...candidate };
        if (valRes.validationCode === 'PRICE_CHANGED') {
          if (autopilotMode === 'AUTONOMO') {
            const evalRes = this.priceValidationEngine.evaluateOfferRelevanceAfterPriceChange({
              originalOffer: candidate,
              validatedData: valRes.data,
            });

            if (!evalRes.isAttractive) {
              await eventLogger.warning(
                'PRICE',
                'Oferta descartada: preço divergente.',
                {
                  action: 'OFFER_DISCARDED_PRICE_DIVERGENCE',
                  metadata: { reason: evalRes.reason, title: candidate.title },
                }
              );
              candidateIdx++;
              if (candidateIdx < candidatesPool.length) {
                await eventLogger.info(
                  'SELECTION',
                  'Produto substituído por candidato de maior potencial.',
                  {
                    action: 'CANDIDATE_SUBSTITUTED',
                    metadata: { nextCandidate: candidatesPool[candidateIdx].title },
                  }
                );
              }
              continue;
            }

            evaluatedOffer = evalRes.updatedOffer;
          } else {
            evaluatedOffer = {
              ...candidate,
              currentPrice: valRes.data.currentPrice,
              originalPrice: valRes.data.originalPrice,
              discountPercent: valRes.data.discountPercent,
            };
          }
        } else {
          evaluatedOffer = {
            ...candidate,
            currentPrice: valRes.data.currentPrice,
            originalPrice: valRes.data.originalPrice,
            discountPercent: valRes.data.discountPercent,
            imageUrl: valRes.data.imageUrl || candidate.imageUrl,
          };
        }

        const discStr = evaluatedOffer.discountPercent > 0 ? ` (-${evaluatedOffer.discountPercent}% OFF)` : '';
        await eventLogger.success(
          'PRICE',
          `Preço validado: R$ ${evaluatedOffer.currentPrice.toFixed(2)}${discStr}`,
          {
            action: 'PRICE_CONFIRMED',
            metadata: { ...valRes.data },
          }
        );

        // ─────────────────────────────────────────────────────────────
        // Produto selecionado: interrompe este ciclo antes de criativos/publicação.
        const marketplace = evaluatedOffer.marketplace || 'mercadolivre';
        let productQuery = supabase.from('products').select('*');
        productQuery = evaluatedOffer.dbId
          ? productQuery.eq('id', evaluatedOffer.dbId)
          : productQuery.eq('marketplace', marketplace).eq('marketplace_product_id', evaluatedOffer.productId);
        const { data: selectedProduct, error: selectedError } = await productQuery.single();
        if (selectedError || !selectedProduct) throw new Error(selectedError?.message || 'Produto selecionado não persistido.');
        await new ManualAffiliateFlow().selectProduct({
          ...selectedProduct, current_price: evaluatedOffer.currentPrice,
          score: evaluatedOffer.finalScore ?? evaluatedOffer.score ?? evaluatedOffer.aiScore,
        });
        await this.setStep('AGUARDANDO LINK DO ADMINISTRADOR');
        return;

        // RESOLUÇÃO DE LINK DE AFILIADO (meli.la) PARA ESTE CANDIDATO
        // ─────────────────────────────────────────────────────────────
        await this.setStep('GERANDO LINK');
        await eventLogger.info('AFFILIATE', `Resolução de link de afiliado oficial para "${evaluatedOffer.title.slice(0, 35)}..."`, {
          action: 'AFFILIATE_START',
        });

        const affiliateRes = await affiliateService.resolveAffiliateLink({
          marketplace: evaluatedOffer.marketplace || 'mercadolivre',
          productUrl: evaluatedOffer.productUrl,
          productId: evaluatedOffer.productId,
          dbProductId: evaluatedOffer.dbId,
        });

        const confirmedMeliUrl = (affiliateRes.shortUrl && affiliateRes.shortUrl.includes('meli.la'))
          ? affiliateRes.shortUrl
          : (affiliateRes.affiliateUrl && affiliateRes.affiliateUrl.includes('meli.la') ? affiliateRes.affiliateUrl : null);

        if (!affiliateRes.affiliateVerified || !confirmedMeliUrl) {
          await eventLogger.warning(
            'AFFILIATE',
            'Link de afiliado comissionado não confirmado (AFFILIATE_LINK_UNVERIFIED). Fallback para URL comum BLOQUEADO. Candidato descartado. Tentando próximo candidato...',
            {
              action: 'AFFILIATE_LINK_UNVERIFIED',
              metadata: {
                productUrl: evaluatedOffer.productUrl,
                productId: evaluatedOffer.productId,
                status: affiliateRes.status,
                reason: affiliateRes.reason || 'URL meli.la não confirmada pelo programa',
              },
            }
          );
          candidateIdx++;
          if (candidateIdx < candidatesPool.length) {
            await eventLogger.info(
              'SELECTION',
              'Produto substituído por candidato de maior potencial.',
              {
                action: 'CANDIDATE_SUBSTITUTED',
                metadata: { nextCandidate: candidatesPool[candidateIdx].title },
              }
            );
          }
          continue;
        }

        // SUCESSO: Preço validado e Link meli.la confirmado!
        chosenOffer = evaluatedOffer;
        directAffiliateUrl = confirmedMeliUrl;
        trackingId = trackingService.generateTrackingId();
        trackingUrl = trackingService.buildTrackingUrl(trackingId);

        if (chosenOffer.dbId) {
          try {
            await supabase.from('product_prices').insert({
              product_id: chosenOffer.dbId,
              current_price: chosenOffer.currentPrice,
              original_price: chosenOffer.originalPrice || null,
              discount_percent: chosenOffer.discountPercent || null,
              collected_at: new Date().toISOString(),
            });
          } catch {}
        }

        await eventLogger.success(
          'AFFILIATE',
          `Link comissionado oficial verificado (${confirmedMeliUrl}) e URL de tracking criada: ${trackingUrl}`,
          {
            action: 'AFFILIATE_READY',
            metadata: {
              directAffiliateUrl,
              trackingId,
              trackingUrl,
              affiliateVerified: true,
            },
          }
        );

        break;
      }

      if (!chosenOffer || !directAffiliateUrl) {
        throw new Error('Nenhuma oferta permaneceu válida após a validação profunda de preços e confirmação de link meli.la.');
      }

      await eventLogger.success(
        'AI',
        `Curadoria JEV aprovou oferta "${chosenOffer.title.slice(0, 40)}..." (Score: ${chosenOffer.finalScore || chosenOffer.score || 85}/100)`,
        {
          action: 'AI_APPROVAL',
          metadata: {
            title: chosenOffer.title,
            score: chosenOffer.finalScore || chosenOffer.score,
            strategy: chosenOffer.strategy?.code || 'DESCONTO',
          },
        }
      );

      // ─────────────────────────────────────────────────────────────
      // PASSO 5: PREPARANDO PUBLICAÇÃO
      // ─────────────────────────────────────────────────────────────
      await this.setStep('PREPARANDO PUBLICAÇÃO');
      await eventLogger.info('FACEBOOK', 'Preparando copy e imagem para publicação...', {
        action: 'CONTENT_PREP_START',
      });

      const creativeEngine = new CreativeEngine();
      let creative = creativeEngine.generatePost({
        title: chosenOffer.title,
        currentPrice: chosenOffer.currentPrice,
        originalPrice: chosenOffer.originalPrice,
        discountPercent: chosenOffer.discountPercent || 0,
        imageUrl: chosenOffer.imageUrl,
        affiliateUrl: directAffiliateUrl,
        trackingUrl,
        strategy: chosenOffer.strategy || { code: 'DESCONTO', name: 'Desconto Real Comprovado' },
        category: chosenOffer.category || 'utilidades',
      });

      // ─────────────────────────────────────────────────────────────
      // PASSO 6: VALIDAÇÃO 2 & PUBLICAÇÃO (DECISÃO POR MODO)
      // ─────────────────────────────────────────────────────────────
      if (autopilotMode === 'AUTONOMO') {
        // SEGURANÇA 1: Limite Diário de Publicações (Máximo 6 por dia)
        const todayStartIso = new Date();
        todayStartIso.setHours(0, 0, 0, 0);
        const { count: todayPubsCount } = await supabase
          .from('publications')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'PUBLISHED')
          .gte('published_at', todayStartIso.toISOString());

        if ((todayPubsCount || 0) >= MAX_PUBLICATIONS_PER_DAY) {
          logger.info(`[Worker] Limite diário de segurança atingido (${todayPubsCount}/${MAX_PUBLICATIONS_PER_DAY}). Nenhuma publicação será realizada.`);
          await eventLogger.info('ROBOT', `Limite diário máximo de ${MAX_PUBLICATIONS_PER_DAY} publicações atingido hoje. Oportunidade não publicada por segurança.`, {
            action: 'DAILY_LIMIT_REACHED',
            metadata: { count: todayPubsCount, maxAllowed: MAX_PUBLICATIONS_PER_DAY }
          });
          return;
        }

        // SEGURANÇA 2: Cooldown Mínimo entre Publicações (45 min)
        const { data: lastPub } = await supabase
          .from('publications')
          .select('published_at')
          .eq('status', 'PUBLISHED')
          .order('published_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastPub?.published_at) {
          const diffMinutes = (Date.now() - new Date(lastPub.published_at).getTime()) / 60000;
          if (diffMinutes < MIN_COOLDOWN_MINUTES) {
            logger.info(`[Worker] Cooldown de segurança ativo (${Math.round(diffMinutes)}/${MIN_COOLDOWN_MINUTES} min). Aguardando próximo ciclo.`);
            await eventLogger.info('ROBOT', `Cooldown de segurança ativo (${Math.round(diffMinutes)}/${MIN_COOLDOWN_MINUTES} min). Publicação suspensa até o fim do intervalo.`, {
              action: 'COOLDOWN_ACTIVE',
              metadata: { elapsedMinutes: Math.round(diffMinutes), minCooldown: MIN_COOLDOWN_MINUTES }
            });
            return;
          }
        }

        // MODO AUTÔNOMO: Validação 2 imediata e publicação sem aprovação humana
        await this.setStep('VALIDAÇÃO FINAL');
        await eventLogger.info('PRICE', '[Validação 2] Validação final de preço antes da publicação automática...', {
          action: 'PRICE_FINAL_VALIDATION',
          metadata: { productUrl: chosenOffer.productUrl, price: chosenOffer.currentPrice },
        });

        const finalPage = await browserManager.openPage();
        const finalVal = await this.priceValidationEngine.validateCandidatePrice(chosenOffer, {
          page: finalPage,
          supabase,
          expectedPrice: chosenOffer.currentPrice,
        });

        // Se validação falhar ou consenso for LOW: descartar e não publicar
        if (!finalVal.isValid || finalVal.consensus === 'LOW') {
          await eventLogger.error(
            'PRICE',
            `Oferta descartada: ${finalVal.reason || 'Consenso de preço insuficiente (LOW).'}. Procurando outro candidato.`,
            { action: 'PRICE_FINAL_REJECT', metadata: { consensus: finalVal.consensus, validationCode: finalVal.validationCode } }
          );
          throw new Error(`Validação final falhou ou consenso LOW: ${finalVal.reason || 'Consenso LOW'}`);
        }

        if (finalVal.validationCode === 'PRICE_CHANGED') {
          const eval2 = this.priceValidationEngine.evaluateOfferRelevanceAfterPriceChange({
            originalOffer: chosenOffer,
            validatedData: finalVal.data,
          });

          if (!eval2.isAttractive) {
            await eventLogger.warning(
              'PRICE',
              'Oferta descartada: preço divergente.',
              { action: 'OFFER_DISCARDED_PRICE_DIVERGENCE', metadata: { reason: eval2.reason } }
            );
            throw new Error(`Oferta perdeu atratividade na validação final: ${eval2.reason}`);
          }

          await eventLogger.info(
            'PRICE',
            'Oferta reavaliada após alteração de preço.',
            { action: 'OFFER_REEVALUATED', metadata: { newPrice: finalVal.data.currentPrice } }
          );

          chosenOffer = eval2.updatedOffer;
          creative = creativeEngine.generatePost({
            title: chosenOffer.title,
            currentPrice: chosenOffer.currentPrice,
            originalPrice: chosenOffer.originalPrice,
            discountPercent: chosenOffer.discountPercent || 0,
            imageUrl: chosenOffer.imageUrl,
            affiliateUrl: directAffiliateUrl,
            trackingUrl,
            strategy: chosenOffer.strategy || { code: 'DESCONTO', name: 'Desconto Real Comprovado' },
            category: chosenOffer.category || 'utilidades',
          });
        }

        // Confirmar link oficial de afiliado antes da publicação
        if (!directAffiliateUrl || directAffiliateUrl.length < 8) {
          await eventLogger.error('AFFILIATE', 'Link oficial de afiliado ausente ou corrompido antes da publicação.', {
            action: 'AFFILIATE_REJECT',
            metadata: { directAffiliateUrl }
          });
          throw new Error('Link oficial de afiliado ausente ou corrompido antes da publicação.');
        }

        // Publicação Orgânica
        await this.setStep('PUBLICANDO NO FACEBOOK');
        let fbPostId = null;
        let fbPubUrl = null;

        if (DRY_RUN_PUBLICATION) {
          logger.info('[Worker] Modo DRY_RUN_PUBLICATION ativo: publicação no Facebook simulada.');
          fbPostId = `dryrun_${Date.now()}`;
          fbPubUrl = `https://www.facebook.com/achakiofertas/posts/${fbPostId}`;
        } else {
          // Busca token de página atualizado em system_state
          const { data: stateData } = await supabase
            .from('system_state')
            .select('social_networks')
            .eq('id', 'autopilot')
            .maybeSingle();

          const sn = stateData?.social_networks || {};
          const pageAccessToken = sn.facebook_page_token || sn.facebook_user_token || sn.page_access_token || process.env.FB_PAGE_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN;
          const pageId = sn.facebook_page_id || process.env.FB_PAGE_ID || '61587794361596';

          if (!pageAccessToken) {
            await this._handleAutoStop('Facebook OAuth inválido ou token de página ausente no banco');
            throw new Error('Facebook Page Access Token não encontrado em system_state. Autorize via OAuth primeiro.');
          }

          try {
            const FacebookPublisher = (await import('./publishers/facebook-publisher.js')).default;
            const publisher = new FacebookPublisher();
            const pubRes = await publisher.publishPost({
              pageId,
              pageAccessToken,
              message: creative.text,
              imageUrl: chosenOffer.imageUrl,
              link: directAffiliateUrl,
            });
            fbPostId = pubRes.postId;
            fbPubUrl = pubRes.publicationUrl;
          } catch (pubErr) {
            await this._handleAutoStop(`Erro repetido Graph API: ${pubErr.message}`, { error: pubErr.message });
            throw pubErr;
          }
        }

        const publishedAt = new Date().toISOString();
        const { data: pubData } = await supabase
          .from('publications')
          .insert({
            product_id: chosenOffer.dbId || null,
            marketplace: chosenOffer.marketplace || 'mercadolivre',
            social_network: 'facebook',
            strategy: chosenOffer.strategy?.code || 'DESCONTO',
            tracking_id: trackingId,
            tracking_url: trackingUrl,
            affiliate_url: directAffiliateUrl,
            status: 'PUBLISHED',
            facebook_post_id: fbPostId,
            publication_url: fbPubUrl,
            published_at: publishedAt,
            content: creative.text,
            media_url: chosenOffer.imageUrl,
            price_published: chosenOffer.currentPrice,
            original_price_published: chosenOffer.originalPrice || null,
            discount_published: chosenOffer.discountPercent || 0,
            run_id: runId,
            metadata: {
              dryRun: DRY_RUN_PUBLICATION,
              headline: creative.headline,
              messageText: creative.text,
              imageUrl: chosenOffer.imageUrl,
              targetPageName: 'ACHAki Achadinhos e Ofertas',
              targetPageId: '61587794361596',
              marketplaceProductId: chosenOffer.productId || chosenOffer.dbId,
              score: chosenOffer.finalScore || chosenOffer.score || 85,
              strategy: chosenOffer.strategy?.code || 'DESCONTO',
              validated_at: publishedAt,
              mode: 'AUTONOMO',
            },
          })
          .select('id')
          .maybeSingle();

        await eventLogger.success(
          'FACEBOOK',
          'Publicação realizada automaticamente.',
          {
            action: 'AUTONOMOUS_PUBLISHED',
            publicationId: pubData?.id,
            metadata: { postId: fbPostId, price: chosenOffer.currentPrice, dryRun: DRY_RUN_PUBLICATION },
          }
        );

        // Feedback loop inicial
        try {
          await supabase.from('publication_metrics').insert({
            publication_id: pubData?.id,
            clicks: 0,
            impressions: 0,
            tracked_at: publishedAt,
          });
        } catch {}

        await this.setStep('CONCLUÍDO');
        await eventLogger.success(
          'ROBOT',
          'Ciclo autônomo concluído com sucesso! Publicação realizada sem necessidade de intervenção humana.',
          {
            action: 'CYCLE_COMPLETE',
            publicationId: pubData?.id,
            metadata: { runId, topOfferTitle: chosenOffer.title, price: chosenOffer.currentPrice },
          }
        );
      } else {
        // MODO ASSISTIDO: Salva como ASSISTED_READY e aguarda aprovação humana
        let pubId = null;
        try {
          const { data: pubData } = await supabase
            .from('publications')
            .insert({
              product_id: chosenOffer.dbId || null,
              marketplace: chosenOffer.marketplace || 'mercadolivre',
              social_network: 'facebook',
              strategy: chosenOffer.strategy?.code || 'DESCONTO',
              tracking_id: trackingId,
              tracking_url: trackingUrl,
              affiliate_url: directAffiliateUrl,
              status: 'ASSISTED_READY',
              content: creative.text,
              media_url: chosenOffer.imageUrl,
              price_published: chosenOffer.currentPrice,
              original_price_published: chosenOffer.originalPrice || null,
              discount_published: chosenOffer.discountPercent || 0,
              run_id: runId,
              metadata: {
                dryRun: DRY_RUN_PUBLICATION,
                headline: creative.headline,
                messageText: creative.text,
                imageUrl: chosenOffer.imageUrl,
                targetPageName: 'ACHAki Achadinhos e Ofertas',
                targetPageId: '61587794361596',
                marketplaceProductId: chosenOffer.productId || chosenOffer.dbId,
                score: chosenOffer.finalScore || chosenOffer.score || 85,
                strategy: chosenOffer.strategy?.code || 'DESCONTO',
                validated_at: new Date().toISOString(),
                mode: 'ASSISTIDO',
              },
            })
            .select('id')
            .maybeSingle();

          pubId = pubData?.id;
        } catch (pubErr) {
          logger.warn(`[Worker] Falha não impeditiva ao registrar publicação: ${pubErr.message}`);
        }

        // ─────────────────────────────────────────────────────────────
        // PASSO 6: AGUARDANDO APROVAÇÃO (Fim do ciclo no Modo Assistido)
        // ─────────────────────────────────────────────────────────────
        await this.setStep('AGUARDANDO APROVAÇÃO');

        await eventLogger.info(
          'FACEBOOK',
          'Publicação preparada — aguardando autorização (Modo Assistido ativo)',
          {
            action: 'POST_PREPARED',
            publicationId: pubId,
            metadata: {
              trackingId,
              headline: creative.headline,
              dryRun: DRY_RUN_PUBLICATION,
            },
          }
        );

        await eventLogger.success(
          'ROBOT',
          'Ciclo concluído com sucesso! (Modo Assistido: publicação retida para aprovação)',
          {
            action: 'CYCLE_COMPLETE',
            publicationId: pubId,
            metadata: {
              runId,
              topOfferTitle: chosenOffer.title,
              price: chosenOffer.currentPrice,
              trackingUrl,
              status: 'COMPLETED_ASSISTED',
            },
          }
        );
      }
    } finally {
      try {
        await browserManager.close();
      } catch {}
    }
  }

  /**
   * Ciclo de Monitoramento de Demanda (apenas modo AUTÔNOMO).
   *
   * REGRA CENTRAL: 20 minutos = intervalo de observação.
   * O robô NUNCA publica apenas por ter decorrido 20 minutos.
   * Publica SOMENTE se uma oportunidade real atingir Score >= 75/100.
   * Se nenhuma oportunidade atingir o threshold: registra e aguarda.
   */
  async _runDemandScanCycle() {
    if (this.isWorking || this.isShuttingDown) return;

    try {
      // Lê modo de operação ativo
      const { data: stateRow } = await supabase
        .from('system_state')
        .select('autopilot_mode')
        .eq('id', 'autopilot')
        .maybeSingle();

      const autopilotMode = stateRow?.autopilot_mode || 'ASSISTIDO';

      // Scan de demanda só é relevante no modo AUTÔNOMO
      if (autopilotMode !== 'AUTONOMO') {
        logger.info('[DemandScan] Modo ASSISTIDO — scan de demanda ignorado.');
        return;
      }

      logger.info('[DemandScan] 🔍 Iniciando ciclo de monitoramento de demanda...');

      await eventLogger.info('ROBOT', 'Ciclo de monitoramento de demanda iniciado', {
        action: 'DEMAND_SCAN_START',
        metadata: { scanIntervalMinutes: DEMAND_SCAN_INTERVAL_MS / 60000, autopilotMode }
      });

      // Avalia demanda e oportunidades reais
      const scanBrowser = new BrowserManager();
      let result;
      try {
        await scanBrowser.launch();
        this.opportunityEngine.browserManager = scanBrowser;
        result = await this.opportunityEngine.evaluateDemandAndOpportunities();
      } finally {
        await scanBrowser.close().catch(() => {});
        this.opportunityEngine.browserManager = null;
      }

      const activeDemands = (result.opportunities || []).slice(0, 5).map(o => ({
        keyword: o.keyword,
        demand_score: o.demand_score,
        trend_direction: o.trend_direction,
        intent: o.intent
      }));

      // Grava evento de DEMANDA no banco para o dashboard
      await supabase.from('system_events').insert({
        level: result.decision === 'PUBLISH' ? 'SUCCESS' : 'INFO',
        category: 'DEMAND',
        source: 'DemandIntelligenceEngine',
        action: result.decision === 'PUBLISH' ? 'OPPORTUNITY_FOUND' : 'DEMAND_MONITORED',
        status: result.decision,
        message: result.reason || 'Ciclo de monitoramento concluído.',
        metadata: {
          decision: result.decision,
          actionTaken: result.action,
          activeDemands,
          bestOpportunity: result.demandResult?.candidate ? {
            title: result.demandResult.candidate.title,
            price: result.demandResult.candidate.currentPrice,
            score: result.demandResult.commercialScore,
            keyword: result.demandResult.opportunity?.keyword
          } : null,
          scannedAt: new Date().toISOString()
        }
      });

      if (result.decision === 'PUBLISH') {
        logger.info(`[DemandScan] 🎯 Oportunidade aprovada: "${result.demandResult?.candidate?.title?.slice(0, 50)}" (Score: ${result.demandResult?.commercialScore}/100)`);
        await eventLogger.success('ROBOT', `Oportunidade de demanda aprovada para publicação autônoma (Score: ${result.demandResult?.commercialScore}/100)`, {
          action: 'AUTONOMOUS_PUBLISH_QUEUED',
          metadata: { candidate: result.demandResult?.candidate?.title, score: result.demandResult?.commercialScore }
        });

        // Enfileira execução autônoma do pipeline com o candidato aprovado (mesmo em DRY_RUN)
        await supabase.from('robot_commands').insert({
          command: 'RUN_NOW',
          status: 'PENDING',
          metadata: {
            reason: 'autonomous_demand_opportunity',
            demandKeyword: result.demandResult?.opportunity?.keyword,
            dryRun: DRY_RUN_PUBLICATION,
            requestedAt: new Date().toISOString()
          }
        });
        if (DRY_RUN_PUBLICATION) {
          logger.info('[DemandScan] Modo DRY_RUN_PUBLICATION ativo: ciclo autônomo disparado em modo seguro de teste.');
        }
      } else {
        logger.info(`[DemandScan] ⏸ ${result.reason}`);
        await eventLogger.info('ROBOT', result.reason, {
          action: 'DEMAND_NO_PUBLISH',
          metadata: { opportunitiesScanned: activeDemands.length }
        });
      }
    } catch (err) {
      logger.warn(`[DemandScan] Erro no ciclo de monitoramento: ${err.message}`);
    }
  }

  /**
   * Encerramento gracioso do worker.
   */
  async stop() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    console.log('\n[Worker] Encerrando worker local graciosamente...');

    clearInterval(this.heartbeatTimer);
    clearInterval(this.pollTimer);
    clearInterval(this.demandScanTimer);
    clearInterval(this.creativeJobTimer);

    if (this.realtimeChannel) {
      try {
        supabase.removeChannel(this.realtimeChannel);
      } catch {}
    }

    // Marca no banco que o worker ficou offline
    try {
      await supabase
        .from('worker_heartbeats')
        .upsert({
          worker_id: this.workerId,
          status: 'OFFLINE',
          current_step: 'Worker offline',
          last_heartbeat_at: new Date(Date.now() - 60000).toISOString(), // marca como antigo
          updated_at: new Date().toISOString(),
        }, { onConflict: 'worker_id' });
    } catch {}

    await eventLogger.info('ROBOT', `Worker local [${this.workerId}] desconectado`, {
      action: 'WORKER_SHUTDOWN',
    });

    console.log('✓ Worker encerrado com segurança.\n');
  }
}

// Instância global do worker
const worker = new RobotWorker();

// Tratamento de sinais de encerramento
process.on('SIGINT', async () => {
  await worker.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await worker.stop();
  process.exit(0);
});

// Inicialização automática ao rodar via linha de comando
if (process.argv[1] && process.argv[1].endsWith('worker.js')) {
  worker.start().catch((err) => {
    console.error('Erro fatal ao iniciar worker:', err);
    process.exit(1);
  });
}

export default worker;
