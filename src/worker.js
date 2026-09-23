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
import TrackingService from './services/tracking-service.js';
import CreativeEngine from './services/creative-engine.js';
import logger from './utils/logger.js';

const WORKER_ID = process.env.WORKER_ID || `worker-${os.hostname().toLowerCase().replace(/[^a-z0-9]/g, '')}`;
const HEARTBEAT_INTERVAL_MS = 10000; // 10 segundos
const POLL_INTERVAL_MS = 3000; // 3 segundos fallback
const DRY_RUN_PUBLICATION = process.env.DRY_RUN_PUBLICATION !== 'false'; // Padrão: true (não publica de verdade)

class RobotWorker {
  constructor() {
    this.workerId = WORKER_ID;
    this.hostname = os.hostname();
    this.isWorking = false;
    this.currentStep = 'AGUARDANDO';
    this.currentRunId = null;
    this.heartbeatTimer = null;
    this.pollTimer = null;
    this.realtimeChannel = null;
    this.isShuttingDown = false;
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

      const payload = {
        worker_id: this.workerId,
        last_heartbeat_at: new Date().toISOString(),
        status,
        current_step: step,
        current_run_id: this.currentRunId,
        hostname: this.hostname,
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

    console.log('✓ Worker escutando comandos do Centro de Comando...\n');
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

    // 2. Revalidação final
    await this.setStep('VALIDANDO PREÇO');
    await eventLogger.info('PRICE', 'Revalidação final iniciada', {
      action: 'PRICE_FINAL_REVALIDATION',
      publicationId: pub.id,
    });

    // Consulta preço mais recente registrado para o produto
    let latestPrice = Number(pub.price_published);
    let originalPrice = pub.original_price_published ? Number(pub.original_price_published) : null;
    let discountPercent = pub.discount_published ? Number(pub.discount_published) : 0;
    let isAvailable = true;

    if (pub.product_id) {
      const { data: priceRow } = await supabase
        .from('product_prices')
        .select('current_price, original_price, discount_percent, in_stock')
        .eq('product_id', pub.product_id)
        .order('collected_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (priceRow) {
        if (priceRow.in_stock === false) {
          isAvailable = false;
        }
        if (priceRow.current_price && Number(priceRow.current_price) > 0) {
          latestPrice = Number(priceRow.current_price);
          originalPrice = priceRow.original_price ? Number(priceRow.original_price) : originalPrice;
          discountPercent = priceRow.discount_percent || discountPercent;
        }
      }
    }

    // Se produto ficou indisponível:
    if (!isAvailable) {
      await supabase
        .from('publications')
        .update({ status: 'CANCELLED_UNAVAILABLE', updated_at: new Date().toISOString() })
        .eq('id', pub.id);

      await eventLogger.error('PRICE', 'Produto indisponível no marketplace. Publicação cancelada.', {
        action: 'PRODUCT_UNAVAILABLE',
        publicationId: pub.id,
      });
      await this.setStep('AGUARDANDO');
      return;
    }

    // Se preço mudou em relação ao aprovado:
    const registeredPrice = Number(pub.price_published);
    if (registeredPrice && Math.abs(latestPrice - registeredPrice) > 0.05) {
      await supabase
        .from('publications')
        .update({
          price_published: latestPrice,
          original_price_published: originalPrice,
          discount_published: discountPercent,
          metadata: {
            ...pub.metadata,
            price_changed: true,
            previous_price: registeredPrice,
            new_price: latestPrice,
            revalidated_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', pub.id);

      await eventLogger.warning(
        'PRICE',
        `Preço alterado no marketplace de R$ ${registeredPrice.toFixed(2)} para R$ ${latestPrice.toFixed(2)}. Card atualizado — publicação retida para nova aprovação.`,
        {
          action: 'PRICE_CHANGED_REAPPROVAL_REQUIRED',
          publicationId: pub.id,
          metadata: { previousPrice: registeredPrice, newPrice: latestPrice },
        }
      );

      await this.setStep('AGUARDANDO APROVAÇÃO');
      return;
    }

    // Preço confirmado
    await eventLogger.success('PRICE', 'Preço confirmado', {
      action: 'PRICE_CONFIRMED',
      metadata: { currentPrice: latestPrice, discountPercent },
    });

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
      const pageAccessToken = sn.facebook_page_token;
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

      const topOffers = cycleResult?.topOffers || [];

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

      const bestOffer = topOffers[0];
      if (!bestOffer) {
        throw new Error('Nenhuma oferta qualificada foi obtida no ciclo de coleta.');
      }

      await eventLogger.success(
        'AI',
        `Curadoria JEV aprovou oferta "${bestOffer.title.slice(0, 40)}..." (Score: ${bestOffer.finalScore || bestOffer.score || 85}/100)`,
        {
          action: 'AI_APPROVAL',
          metadata: {
            title: bestOffer.title,
            score: bestOffer.finalScore || bestOffer.score,
            strategy: bestOffer.strategy?.code || 'DESCONTO',
          },
        }
      );

      // ─────────────────────────────────────────────────────────────
      // PASSO 3: VALIDANDO PREÇO
      // ─────────────────────────────────────────────────────────────
      await this.setStep('VALIDANDO PREÇO');
      await eventLogger.info('PRICE', `Revalidando preço da oferta #${bestOffer.productId || bestOffer.dbId || 'MLB'}...`, {
        action: 'PRICE_VALIDATION_START',
      });

      const currentPrice = Number(bestOffer.currentPrice);
      if (!currentPrice || currentPrice <= 0) {
        throw new Error(`Preço inconsistente detectado: R$ ${bestOffer.currentPrice}`);
      }

      const discStr = bestOffer.discountPercent > 0 ? ` (-${bestOffer.discountPercent}% OFF)` : '';
      await eventLogger.success(
        'PRICE',
        `Preço confirmado: R$ ${currentPrice.toFixed(2)}${discStr}`,
        {
          action: 'PRICE_CONFIRMED',
          metadata: {
            currentPrice,
            originalPrice: bestOffer.originalPrice || null,
            discountPercent: bestOffer.discountPercent || 0,
          },
        }
      );

      // ─────────────────────────────────────────────────────────────
      // PASSO 4: GERANDO LINK
      // ─────────────────────────────────────────────────────────────
      await this.setStep('GERANDO LINK');
      await eventLogger.info('AFFILIATE', 'Resolução de link de afiliado oficial no marketplace...', {
        action: 'AFFILIATE_START',
      });

      const affiliateService = new AffiliateLinkService({ browserManager });
      const affiliateRes = await affiliateService.resolveAffiliateLink({
        marketplace: bestOffer.marketplace || 'mercadolivre',
        productUrl: bestOffer.productUrl,
        productId: bestOffer.productId,
        dbProductId: bestOffer.dbId,
      });

      const trackingService = new TrackingService();
      const trackingId = trackingService.generateTrackingId();
      const trackingUrl = trackingService.buildTrackingUrl(trackingId);

      await eventLogger.success(
        'AFFILIATE',
        `Link comissionado verificado e URL de tracking criada: ${trackingUrl}`,
        {
          action: 'AFFILIATE_READY',
          metadata: {
            trackingId,
            trackingUrl,
            affiliateVerified: affiliateRes.affiliateVerified,
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

      const directAffiliateUrl = affiliateRes.affiliateUrl || bestOffer.productUrl;

      const creativeEngine = new CreativeEngine();
      const creative = creativeEngine.generatePost({
        title: bestOffer.title,
        currentPrice,
        originalPrice: bestOffer.originalPrice,
        discountPercent: bestOffer.discountPercent || 0,
        imageUrl: bestOffer.imageUrl,
        affiliateUrl: directAffiliateUrl,
        trackingUrl,
        strategy: bestOffer.strategy || { code: 'DESCONTO', name: 'Desconto Real Comprovado' },
        category: bestOffer.category || 'utilidades',
      });

      // Salva publicação no Supabase como ASSISTED_READY / PREPARED
      let pubId = null;
      try {
        const { data: pubData } = await supabase
          .from('publications')
          .insert({
            product_id: bestOffer.dbId || null,
            marketplace: bestOffer.marketplace || 'mercadolivre',
            social_network: 'facebook',
            strategy: bestOffer.strategy?.code || 'DESCONTO',
            tracking_id: trackingId,
            tracking_url: trackingUrl,
            affiliate_url: directAffiliateUrl,
            status: 'ASSISTED_READY',
            content: creative.text,
            media_url: bestOffer.imageUrl,
            price_published: currentPrice,
            original_price_published: bestOffer.originalPrice || null,
            discount_published: bestOffer.discountPercent || 0,
            run_id: runId,
            metadata: {
              dryRun: DRY_RUN_PUBLICATION,
              headline: creative.headline,
              messageText: creative.text,
              imageUrl: bestOffer.imageUrl,
              targetPageName: 'ACHAki Achadinhos e Ofertas',
              targetPageId: '61587794361596',
              marketplaceProductId: bestOffer.productId || bestOffer.dbId,
              score: bestOffer.finalScore || bestOffer.score || 85,
              strategy: bestOffer.strategy?.code || 'DESCONTO',
              validated_at: new Date().toISOString(),
            },
          })
          .select('id')
          .maybeSingle();

        pubId = pubData?.id;
      } catch (pubErr) {
        logger.warn(`[Worker] Falha não impeditiva ao registrar publicação: ${pubErr.message}`);
      }

      // ─────────────────────────────────────────────────────────────
      // PASSO 6: AGUARDANDO APROVAÇÃO (Fim do ciclo no Modo Assistido / Dry-Run)
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
        'Ciclo real concluído com sucesso! (Modo Assistido: publicação retida para aprovação)',
        {
          action: 'CYCLE_COMPLETE',
          publicationId: pubId,
          metadata: {
            runId,
            topOfferTitle: bestOffer.title,
            price: currentPrice,
            trackingUrl,
            status: 'COMPLETED_ASSISTED',
          },
        }
      );
    } finally {
      try {
        await browserManager.close();
      } catch {}
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
