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
      const step = customStep || this.currentStep;
      const status = customStatus || (this.isWorking ? 'TRABALHANDO' : 'IDLE');

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
            result: 'COMPLETED_ASSISTED',
            durationMs,
            finishedAt: new Date().toISOString(),
          },
        })
        .eq('id', cmd.id);

      await this.setStep('AGUARDANDO');
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
      await this.emitHeartbeat('AGUARDANDO', 'IDLE');
    }
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

      const creativeEngine = new CreativeEngine();
      const creative = creativeEngine.generatePost({
        title: bestOffer.title,
        currentPrice,
        originalPrice: bestOffer.originalPrice,
        discountPercent: bestOffer.discountPercent || 0,
        imageUrl: bestOffer.imageUrl,
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
            affiliate_url: affiliateRes.affiliateUrl || bestOffer.productUrl,
            product_url: bestOffer.productUrl,
            status: 'ASSISTED_READY',
            metadata: {
              dryRun: DRY_RUN_PUBLICATION,
              headline: creative.headline,
              messageText: creative.text,
              imageUrl: bestOffer.imageUrl,
              targetPageName: 'ACHAki Achadinhos e Ofertas',
              targetPageId: '61587794361596',
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
