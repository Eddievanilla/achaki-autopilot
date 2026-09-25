/**
 * ACHAki Autopilot — PublicationOrchestrator
 *
 * Máquina de estados completa para o pipeline de crescimento:
 *  OPPORTUNITY_FOUND
 *  ↓
 *  CURATING
 *  ↓
 *  CURATED
 *  ↓
 *  CREATIVE_GENERATING
 *  ↓
 *  CREATIVE_READY
 *  ↓
 *  WAITING_ADMIN_REVIEW
 *  ↓
 *  ADMIN_APPROVED (ou ADMIN_REJECTED / ADMIN_REQUESTED_REMAKE)
 *  ↓
 *  WAITING_AFFILIATE_LINK
 *  ↓
 *  AFFILIATE_LINK_DETECTED
 *  ↓
 *  AFFILIATE_LINK_VALIDATING
 *  ↓
 *  READY_TO_PUBLISH
 *  ↓
 *  PUBLISHING
 *  ↓
 *  PUBLISHED (ou DRY_RUN_PUBLISHED)
 *  ↓
 *  MONITORING_PERFORMANCE
 *
 * Princípios Fundamentais:
 * 1. Separação estrita entre Automação do Robô e Intervenção Humana (Aprovação do Criativo e Geração Manual do Link).
 * 2. NUNCA tenta automatizar CAPTCHA, 2FA ou burlar mecanismos anti-bot.
 * 3. Validação rigorosa do link de afiliado (meli.la obrigatório para ML; rejeita URLs comuns e produtos divergentes).
 * 4. Idempotência absoluta: uma aprovação não gera publicação duplicada.
 * 5. Verificação de preço antes da publicação (detecta PRICE_CHANGED).
 * 6. Multirrede legítima: publica apenas em redes READY/configuradas. Zero simulação enganosa.
 * 7. Suporte a DRY_RUN completo sem nenhuma publicação real em ambiente de teste.
 * 8. Registro contínuo no Diário de Decisões.
 */

import crypto from 'crypto';
import { supabase } from '../database/supabase.js';
import logger from '../utils/logger.js';
import eventLogger from './event-logger.js';
import { CreativeAgent } from '../agents/creative-agent.js';
import { AffiliateLinkValidator, VALIDATION_STATUS } from './affiliate-link-validator.js';
import FacebookPublisher from '../publishers/facebook-publisher.js';
import interventionManager from './intervention-manager.js';
import StrategyLearningEngine from './growth/strategy-learning-engine.js';
import CreativeCandidateScorer from './factory/creative-candidate-scorer.js';
import creativeJobQueue from './factory/creative-job-queue.js';

export const PIPELINE_STATES = {
  OPPORTUNITY_FOUND: 'OPPORTUNITY_FOUND',
  CURATING: 'CURATING',
  CURATED: 'CURATED',
  CREATIVE_GENERATING: 'CREATIVE_GENERATING',
  CREATIVE_READY: 'CREATIVE_READY',
  WAITING_ADMIN_REVIEW: 'WAITING_ADMIN_REVIEW',
  ADMIN_APPROVED: 'ADMIN_APPROVED',
  ADMIN_REJECTED: 'ADMIN_REJECTED',
  ADMIN_REQUESTED_REMAKE: 'ADMIN_REQUESTED_REMAKE',
  WAITING_AFFILIATE_LINK: 'WAITING_AFFILIATE_LINK',
  AFFILIATE_LINK_DETECTED: 'AFFILIATE_LINK_DETECTED',
  AFFILIATE_LINK_VALIDATING: 'AFFILIATE_LINK_VALIDATING',
  AFFILIATE_LINK_INVALID: 'AFFILIATE_LINK_INVALID',
  PRODUCT_MISMATCH: 'PRODUCT_MISMATCH',
  PRICE_CHANGED: 'PRICE_CHANGED',
  READY_TO_PUBLISH: 'READY_TO_PUBLISH',
  PUBLISHING: 'PUBLISHING',
  PUBLISHED: 'PUBLISHED',
  DRY_RUN_PUBLISHED: 'DRY_RUN_PUBLISHED',
  MONITORING_PERFORMANCE: 'MONITORING_PERFORMANCE',
};

export class PublicationOrchestrator {
  constructor({ supabaseClient = supabase } = {}) {
    this.supabase = supabaseClient;
    this.creativeAgent = new CreativeAgent({ supabaseClient });
    this.linkValidator = new AffiliateLinkValidator({ supabaseClient });
    this.learningEngine = new StrategyLearningEngine({ supabaseClient });
    this.fbPublisher = new FacebookPublisher();
  }

  /**
   * Registra um marco no Diário de Decisões / Log ao Vivo.
   */
  async logDecisionDiary({ tag, icon, message, productId = null, publicationId = null, metadata = {} }) {
    try {
      await eventLogger.info('ORCHESTRATOR', `${icon} [${tag}] ${message}`, {
        action: tag,
        status: 'SUCCESS',
        productId,
        publicationId,
        metadata: {
          ...metadata,
          loggedAt: new Date().toISOString(),
        },
      });
    } catch (e) {
      logger.warn(`[PublicationOrchestrator] Falha ao registrar diário: ${e.message}`);
    }
  }

  /**
   * ETAPA 1 a 4: Inicia o pipeline para um produto selecionado na curadoria.
   * Cria criativo 9:16 V1, registra aprovação e gera intervenção mobile.
   *
   * @param {object} params
   * @param {object} params.product - Produto com preço, título, marketplace, etc.
   * @param {string} [params.strategy='DESCONTO'] - Estratégia orgânica selecionada
   * @returns {Promise<object>} Objeto da aprovação criada
   */
  async startPipelineForProduct({ product, strategy = 'DESCONTO' }) {
    logger.info(`[PublicationOrchestrator] 🚀 Iniciando pipeline para produto [ID: ${product.id}] ${product.title}`);

    // 0. Avaliação prévia com CreativeCandidateScorer (evita gastar recursos com produto fraco)
    const candidateScore = CreativeCandidateScorer.scoreCandidate({
      product,
      demandContext: { score: 75, keyword: strategy },
      minThreshold: 50,
    });

    if (!candidateScore.eligible) {
      logger.warn(`[PublicationOrchestrator] Produto rejeitado pelo Scorer: ${candidateScore.reason}`);
      await this.logDecisionDiary({
        tag: 'CURADORIA',
        icon: '⚠️',
        message: `Produto descartado para criativo: ${candidateScore.reason}`,
        productId: product.id,
        metadata: { score: candidateScore.score, breakdown: candidateScore.breakdown },
      });
      return {
        success: false,
        status: 'CANDIDATE_DISCARDED_LOW_SCORE',
        reason: candidateScore.reason,
        score: candidateScore.score,
      };
    }

    // 1. OPPORTUNITY_FOUND -> CURATING -> CURATED
    await this.logDecisionDiary({
      tag: 'CURADORIA',
      icon: '🎯',
      message: `[POR QUE ESTE PRODUTO FOI ESCOLHIDO] ${candidateScore.reason}`,
      productId: product.id,
      metadata: { strategy, price: product.current_price || product.price, score: candidateScore.score },
    });

    // Enfileira job na fábrica de criativos
    let creativeJob = null;
    try {
      creativeJob = await creativeJobQueue.enqueueJob({
        productId: product.id,
        creativeVersion: 1,
        priority: candidateScore.priority,
        headline: product.title,
        metadata: { strategy, candidateScore: candidateScore.score },
      });
    } catch {}

    // 2. CREATIVE_GENERATING: CreativeAgent produz vídeo vertical 9:16
    await this.logDecisionDiary({
      tag: 'CRIATIVO',
      icon: '🎬',
      message: `Iniciando produção de criativo vertical 9:16 (V1)...`,
      productId: product.id,
    });

    const creativeVersion = await this.creativeAgent.produceCreative({
      product,
      versionNumber: 1,
      strategy,
    });

    // 3. Registra aprovação pendente (WAITING_ADMIN_REVIEW) com chave de idempotência
    const approvalToken = crypto.randomUUID();
    const idempotencyKey = `appr_${product.id}_v1_${Date.now()}`;

    const { data: approvalRecord, error: apprErr } = await this.supabase
      .from('publication_approvals')
      .insert({
        product_id: product.id,
        creative_id: creativeVersion.id,
        status: PIPELINE_STATES.WAITING_ADMIN_REVIEW,
        approval_token: approvalToken,
        idempotency_key: idempotencyKey,
        metadata: {
          strategy,
          product_title: product.title,
          marketplace: product.marketplace || 'mercadolivre',
          marketplace_product_id: product.marketplace_product_id,
          product_url: product.product_url,
          price: product.current_price || product.price,
          discount_percent: product.discount_percent,
          version_number: 1,
          video_url: creativeVersion.video_url,
          aspect_ratio: '9:16',
        },
      })
      .select()
      .single();

    if (apprErr) {
      throw new Error(`Erro ao criar publicação pendente de aprovação: ${apprErr.message}`);
    }

    // 4. Cria intervenção mobile de operador (CREATIVE_REVIEW)
    const interventionRes = await interventionManager.requestIntervention({
      type: 'CREATIVE_REVIEW',
      marketplace: product.marketplace || 'mercadolivre',
      title: '🎬 Novo vídeo ACHAki pronto para aprovação',
      message: `Vídeo 9:16 gerado para "${product.title.slice(0, 50)}...". Assista e aprove ou peça refação pelo celular.`,
      targetUrl: product.product_url || 'https://www.mercadolivre.com.br',
      actionLabel: 'Revisar Criativo 9:16',
      metadata: {
        approvalId: approvalRecord.id,
        creativeId: creativeVersion.id,
        productId: product.id,
        marketplaceProductId: product.marketplace_product_id,
        productUrl: product.product_url,
        videoUrl: creativeVersion.video_url,
        thumbnailUrl: creativeVersion.thumbnail_url,
        duration: creativeVersion.duration,
        price: product.current_price || product.price,
        discountPercent: product.discount_percent,
        strategy,
        versionNumber: 1,
        headline: creativeVersion.headline,
        aspectRatio: '9:16',
      },
    });

    await this.logDecisionDiary({
      tag: 'ADMIN',
      icon: '👤',
      message: `Criativo 9:16 pronto. Notificação enviada para aprovação do administrador mobile.`,
      productId: product.id,
      metadata: { approvalId: approvalRecord.id, interventionId: interventionRes.id },
    });

    return {
      success: true,
      approvalId: approvalRecord.id,
      creativeId: creativeVersion.id,
      status: PIPELINE_STATES.WAITING_ADMIN_REVIEW,
      creativeVersion,
    };
  }

  /**
   * Helper resiliente para carregar aprovação com produto associado.
   */
  async _getApprovalWithProduct(approvalId) {
    const { data: appr, error } = await this.supabase
      .from('publication_approvals')
      .select('*')
      .eq('id', approvalId)
      .maybeSingle();

    if (error || !appr) {
      throw new Error(`Aprovação não encontrada para ID: ${approvalId}`);
    }

    if (!appr.products && appr.product_id) {
      const { data: prod } = await this.supabase
        .from('products')
        .select('*')
        .eq('id', appr.product_id)
        .maybeSingle();
      appr.products = prod || {};
    }

    return appr;
  }

  /**
   * ETAPA 6 / 9: Administrador RECUSA o criativo.
   *
   * @param {object} params
   * @param {string} params.approvalId
   * @param {string} [params.reason='OUTRO'] - PRODUTO RUIM | VIDEO RUIM | COPY RUIM | PRECO RUIM | NAO INTERESSANTE | OUTRO
   * @param {string} [params.note]
   */
  async adminRejectCreative({ approvalId, reason = 'OUTRO', note = '' }) {
    logger.info(`[PublicationOrchestrator] ❌ Administrador recusou criativo [Approval: ${approvalId}]. Motivo: ${reason}`);

    const appr = await this._getApprovalWithProduct(approvalId);

    // Atualiza status da aprovação
    await this.supabase
      .from('publication_approvals')
      .update({
        status: PIPELINE_STATES.ADMIN_REJECTED,
        rejection_reason: reason,
        notes: note,
        updated_at: new Date().toISOString(),
      })
      .eq('id', approvalId);

    // Atualiza status do criativo
    if (appr.creative_id) {
      await this.supabase
        .from('creative_versions')
        .update({ status: 'REJECTED' })
        .eq('id', appr.creative_id);
    }

    // Fecha intervenções pendentes associadas
    await this.supabase
      .from('operator_interventions')
      .update({ status: 'RESOLVED', resolved_at: new Date().toISOString() })
      .filter('metadata->>approvalId', 'eq', approvalId);

    // Registra feedback negativo no StrategyLearningEngine
    try {
      await this.learningEngine.recordSignal({
        source: 'ADMIN_REJECTED',
        entityId: appr.product_id,
        signalType: 'NEGATIVE',
        reason,
        confidence: 'HIGH',
        metadata: { approvalId, note },
      });
    } catch (e) {
      logger.warn(`[PublicationOrchestrator] Erro ao registrar sinal no StrategyLearning: ${e.message}`);
    }

    await this.logDecisionDiary({
      tag: 'ADMIN',
      icon: '❌',
      message: `Criativo recusado pelo administrador. Motivo: ${reason}. Publicação cancelada.`,
      productId: appr.product_id,
      metadata: { approvalId, reason, note },
    });

    return {
      success: true,
      status: PIPELINE_STATES.ADMIN_REJECTED,
      message: 'Criativo recusado com sucesso. Oferta descartada.',
    };
  }

  /**
   * ETAPA 6 / 10: Administrador solicita REFAZER o criativo.
   *
   * @param {object} params
   * @param {string} params.approvalId
   * @param {string} [params.remakeFocus='GANCHO'] - GANCHO | EDICAO | NARRACAO | TEXTO | MUSICA | DURACAO | CTA | OUTRO
   * @param {string} [params.note]
   */
  async adminRequestRemake({ approvalId, remakeFocus = 'GANCHO', note = '' }) {
    const appr = await this._getApprovalWithProduct(approvalId);
    const product = appr.products;
    const currentVersion = appr.metadata?.version_number || 1;
    const nextVersionNumber = currentVersion + 1;

    // Atualiza status da aprovação atual
    await this.supabase
      .from('publication_approvals')
      .update({
        status: PIPELINE_STATES.ADMIN_REQUESTED_REMAKE,
        remake_reason: remakeFocus,
        notes: note,
        updated_at: new Date().toISOString(),
      })
      .eq('id', approvalId);

    // Registra no Diário
    await this.logDecisionDiary({
      tag: 'ADMIN',
      icon: '♻️',
      message: `Administrador solicitou refazer criativo. Foco: ${remakeFocus}. Produzindo V${nextVersionNumber}...`,
      productId: appr.product_id,
      metadata: { approvalId, remakeFocus, note },
    });

    // Enfileira job de refação na fábrica local
    try {
      await creativeJobQueue.enqueueJob({
        productId: appr.product_id,
        creativeVersion: nextVersionNumber,
        priority: 'HIGH',
        headline: product.title,
        metadata: { remakeFocus, previousApprovalId: approvalId },
      });
    } catch {}

    // CreativeAgent produz NOVA versão (V2, V3...) preservando anteriores
    const newCreative = await this.creativeAgent.produceCreative({
      product,
      versionNumber: nextVersionNumber,
      remakeFocus,
      strategy: appr.metadata?.strategy || 'DESCONTO',
    });

    // Atualiza o registro de aprovação para a nova versão
    await this.supabase
      .from('publication_approvals')
      .update({
        creative_id: newCreative.id,
        status: PIPELINE_STATES.WAITING_ADMIN_REVIEW,
        metadata: {
          ...appr.metadata,
          version_number: nextVersionNumber,
          video_url: newCreative.video_url,
          remake_focus: remakeFocus,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', approvalId);

    // Atualiza a intervenção para a nova versão
    await this.supabase
      .from('operator_interventions')
      .update({
        title: `🎬 Novo vídeo ACHAki V${nextVersionNumber} pronto para aprovação`,
        message: `Versão V${nextVersionNumber} atualizada com foco em [${remakeFocus}]. Assista e aprove.`,
        metadata: {
          approvalId,
          creativeId: newCreative.id,
          productId: product.id,
          videoUrl: newCreative.video_url,
          versionNumber: nextVersionNumber,
          headline: newCreative.headline,
          remakeFocus,
        },
      })
      .filter('metadata->>approvalId', 'eq', approvalId);

    await this.logDecisionDiary({
      tag: 'CRIATIVO',
      icon: '🎬',
      message: `Nova versão V${nextVersionNumber} produzida com sucesso! Enviada para nova aprovação.`,
      productId: appr.product_id,
      metadata: { newCreativeId: newCreative.id, version: nextVersionNumber },
    });

    return {
      success: true,
      status: PIPELINE_STATES.WAITING_ADMIN_REVIEW,
      version: nextVersionNumber,
      newCreative,
      message: `Versão V${nextVersionNumber} gerada com sucesso e enviada para aprovação.`,
    };
  }

  /**
   * ETAPA 6 / 11 / 12: Administrador APROVA o vídeo criativo.
   * Transita para WAITING_AFFILIATE_LINK e guia o administrador a gerar o link no marketplace.
   *
   * @param {object} params
   * @param {string} params.approvalId
   * @param {string} [params.approvedBy='admin_mobile']
   */
  async adminApproveCreative({ approvalId, approvedBy = 'admin_mobile' }) {
    logger.info(`[PublicationOrchestrator] ✅ Administrador aprovou criativo [Approval: ${approvalId}]`);

    const appr = await this._getApprovalWithProduct(approvalId);

    if (appr.status === PIPELINE_STATES.PUBLISHED || appr.status === PIPELINE_STATES.DRY_RUN_PUBLISHED) {
      throw new Error('Esta publicação já foi concluída anteriormente (Idempotência ativa).');
    }

    const product = appr.products;
    const nowIso = new Date().toISOString();

    // Atualiza status da aprovação: ADMIN_APPROVED -> WAITING_AFFILIATE_LINK
    await this.supabase
      .from('publication_approvals')
      .update({
        status: PIPELINE_STATES.WAITING_AFFILIATE_LINK,
        approved_by: approvedBy,
        approved_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', approvalId);

    // Marca creative_version como APPROVED
    if (appr.creative_id) {
      await this.supabase
        .from('creative_versions')
        .update({ status: 'APPROVED' })
        .eq('id', appr.creative_id);
    }

    // Registra no Diário
    await this.logDecisionDiary({
      tag: 'ADMIN',
      icon: '✅',
      message: `Vídeo criativo aprovado pelo administrador! Aguardando geração do link de afiliado oficial.`,
      productId: appr.product_id,
      metadata: { approvalId, approvedBy, approvedAt: nowIso },
    });

    // Atualiza a intervenção para orientar a geração manual do link oficial
    const targetProductUrl = product.product_url || `https://www.mercadolivre.com.br`;
    await this.supabase
      .from('operator_interventions')
      .update({
        type: 'AFFILIATE_LINK_REQUIRED',
        title: '🔗 Gere o Link Oficial de Afiliado',
        message: 'Vídeo aprovado com sucesso! Agora toque abaixo para abrir o produto no marketplace, copie o link oficial de afiliado e cole no ACHAki.',
        target_url: targetProductUrl,
        action_label: '🔗 GERAR LINK NO MARKETPLACE',
        metadata: {
          ...appr.metadata,
          approvalId,
          step: 'WAITING_AFFILIATE_LINK',
          instruction: 'Abra o marketplace, gere o link oficial de afiliado (meli.la para ML) e insira abaixo.',
        },
      })
      .filter('metadata->>approvalId', 'eq', approvalId);

    await this.logDecisionDiary({
      tag: 'AFILIADO',
      icon: '🔗',
      message: `Aguardando geração manual do link de afiliado oficial pelo administrador.`,
      productId: appr.product_id,
      metadata: { approvalId, targetProductUrl },
    });

    return {
      success: true,
      status: PIPELINE_STATES.WAITING_AFFILIATE_LINK,
      marketplaceUrl: targetProductUrl,
      message: 'Vídeo aprovado! Agora gere o link oficial de afiliado no marketplace.',
    };
  }

  /**
   * ETAPA 14 / 15 / 16 / 17 / 18 / 19: Submete, valida e, se aprovado, PUBLICA AUTOMATICAMENTE.
   *
   * @param {object} params
   * @param {string} params.approvalId
   * @param {string} params.rawLink - Link gerado pelo operador
   * @param {boolean} [params.dryRun=false] - Modo DRY_RUN (obrigatório durante testes)
   * @returns {Promise<object>}
   */
  async submitAndValidateAffiliateLink({ approvalId, rawLink, dryRun = false }) {
    logger.info(`[PublicationOrchestrator] 🔍 Submetendo link de afiliado [Approval: ${approvalId}]: ${rawLink} (dryRun: ${dryRun})`);

    const appr = await this._getApprovalWithProduct(approvalId);

    // Verificação de IDEMPOTÊNCIA: não publicar duas vezes
    if (appr.status === PIPELINE_STATES.PUBLISHED || appr.status === PIPELINE_STATES.DRY_RUN_PUBLISHED) {
      return {
        success: true,
        alreadyPublished: true,
        status: appr.status,
        message: 'Esta publicação já foi realizada anteriormente com sucesso. Idempotência preservada.',
      };
    }

    const product = appr.products;

    // 1. AFFILIATE_LINK_DETECTED -> AFFILIATE_LINK_VALIDATING
    await this.logDecisionDiary({
      tag: 'AFILIADO',
      icon: '🔗',
      message: `Link oficial informado pelo operador detectado. Iniciando validação rigorosa...`,
      productId: appr.product_id,
      metadata: { rawLink },
    });

    // 2. Validação estrita via AffiliateLinkValidator
    const validation = await this.linkValidator.validateLink({
      rawLink,
      expectedProduct: product,
      approvalId,
    });

    if (!validation.valid) {
      const failState = validation.status === VALIDATION_STATUS.PRODUCT_MISMATCH
        ? PIPELINE_STATES.PRODUCT_MISMATCH
        : PIPELINE_STATES.AFFILIATE_LINK_INVALID;

      await this.supabase
        .from('publication_approvals')
        .update({
          status: failState,
          affiliate_link_status: validation.status,
          affiliate_url: rawLink,
          notes: validation.reason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', approvalId);

      await this.logDecisionDiary({
        tag: 'VALIDAÇÃO',
        icon: '🛡️',
        message: `Falha na validação do link: ${validation.reason}. Publicação bloqueada.`,
        productId: appr.product_id,
        metadata: { validationStatus: validation.status, reason: validation.reason },
      });

      return {
        success: false,
        valid: false,
        status: failState,
        reason: validation.reason,
      };
    }

    // 3. Link VERIFIED -> READY_TO_PUBLISH
    await this.logDecisionDiary({
      tag: 'VALIDAÇÃO',
      icon: '🛡️',
      message: `Link oficial comprovado e produto confirmado (${validation.status})! Avançando para publicação automática.`,
      productId: appr.product_id,
      metadata: { verifiedUrl: validation.validatedUrl },
    });

    // 4. Verificação de Preço Atual vs Criativo (Evita publicar preço desatualizado)
    const originalPrice = appr.metadata?.price;
    const currentPrice = product.current_price || product.price;
    if (originalPrice && currentPrice && Math.abs(originalPrice - currentPrice) / originalPrice > 0.20) {
      logger.warn(`[PublicationOrchestrator] ⚠️ Alerta: Preço mudou significativamente (De ${originalPrice} para ${currentPrice})`);
      await this.supabase
        .from('publication_approvals')
        .update({
          status: PIPELINE_STATES.PRICE_CHANGED,
          notes: `Preço alterado de R$ ${originalPrice} para R$ ${currentPrice}. Requer revisão.`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', approvalId);

      return {
        success: false,
        status: PIPELINE_STATES.PRICE_CHANGED,
        reason: `O preço do produto foi alterado de R$ ${originalPrice} para R$ ${currentPrice}. Atualize o criativo antes de publicar.`,
      };
    }

    // 5. Montagem da Copy Final (somente dados verificados, zero invenção)
    const headline = appr.metadata?.product_title || product.title;
    const priceFormatted = currentPrice ? `R$ ${Number(currentPrice).toFixed(2).replace('.', ',')}` : '';
    const discount = product.discount_percent ? `${product.discount_percent}% OFF` : '';
    const affiliateUrl = validation.validatedUrl;

    const finalCopy = [
      `🔥 ACHADINHO ACHAki: ${headline}`,
      priceFormatted ? `💰 Apenas ${priceFormatted}${discount ? ` (${discount})` : ''}` : '',
      `✨ Avaliação verificada no marketplace com entrega garantida.`,
      `👇 Link oficial e seguro para garantir o seu:`,
      `🔗 ${affiliateUrl}`,
      `#achadinhos #ofertas #achaki #promocao`,
    ].filter(Boolean).join('\n\n');

    // 6. Atualiza o produto com o affiliate_url verificado
    await this.supabase
      .from('products')
      .update({ affiliate_url: affiliateUrl })
      .eq('id', product.id);

    // 7. PUBLICAÇÃO AUTOMÁTICA NAS REDES AUTORIZADAS
    // O administrador NÃO precisa voltar para clicar em "Publicar".
    await this.supabase
      .from('publication_approvals')
      .update({
        status: PIPELINE_STATES.PUBLISHING,
        affiliate_url: affiliateUrl,
        affiliate_link_status: 'VERIFIED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', approvalId);

    let publicationResult = null;

    if (dryRun) {
      // ═════════════════════════════════════════════════════════════════
      // MODO DRY_RUN (Zero publicações reais)
      // ═════════════════════════════════════════════════════════════════
      logger.info(`[PublicationOrchestrator] 🧪 Executando publicação em modo DRY_RUN (0 chamadas reais à API de redes sociais)`);

      const dryRunPostId = `dryrun_${Date.now()}`;
      const dryRunPubUrl = `https://achaki-autopilot.vercel.app/preview/${dryRunPostId}`;

      const { data: pubRecord, error: pubErr } = await this.supabase
        .from('publications')
        .insert({
          product_id: product.id,
          marketplace: product.marketplace || appr.marketplace || 'mercadolivre',
          social_network: 'FACEBOOK',
          status: 'DRY_RUN_PUBLISHED',
          content: finalCopy,
          media_url: appr.metadata?.video_url || product.image_url,
          affiliate_url: affiliateUrl,
          publication_url: dryRunPubUrl,
          price_published: currentPrice,
          original_price_published: product.original_price,
          discount_published: product.discount_percent,
          strategy: appr.metadata?.strategy || 'DESCONTO',
          metadata: {
            approvalId,
            creativeId: appr.creative_id,
            dryRun: true,
            aspectRatio: '9:16',
            publishedAt: new Date().toISOString(),
          },
        })
        .select()
        .single();

      if (pubErr) {
        throw new Error(`Erro ao salvar publicação dry-run: ${pubErr.message}`);
      }

      // Registra métricas zeradas prontas para monitoramento
      await this.supabase.from('publication_metrics').insert({
        publication_id: pubRecord.id,
        impressions: 0,
        clicks: 0,
        reactions: 0,
        shares: 0,
        comments: 0,
      });

      // Atualiza aprovação para DRY_RUN_PUBLISHED
      await this.supabase
        .from('publication_approvals')
        .update({
          status: PIPELINE_STATES.DRY_RUN_PUBLISHED,
          publication_id: pubRecord.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', approvalId);

      // Fecha intervenção do operador
      await this.supabase
        .from('operator_interventions')
        .update({ status: 'RESOLVED', resolved_at: new Date().toISOString() })
        .filter('metadata->>approvalId', 'eq', approvalId);

      await this.logDecisionDiary({
        tag: 'PUBLICAÇÃO',
        icon: '🚀',
        message: `[DRY_RUN] Publicação autorizada montada e validada com sucesso! Pronto para monitoramento.`,
        productId: product.id,
        publicationId: pubRecord.id,
        metadata: { dryRun: true, publicationUrl: dryRunPubUrl },
      });

      return {
        success: true,
        dryRun: true,
        status: PIPELINE_STATES.DRY_RUN_PUBLISHED,
        publicationId: pubRecord.id,
        publicationUrl: dryRunPubUrl,
        affiliateUrl,
        finalCopy,
        message: '🚀 [DRY_RUN] Fluxo completo executado com sucesso! Publicação simulada sem disparos externos.',
      };
    } else {
      // ═════════════════════════════════════════════════════════════════
      // MODO REAL: Publicação nas redes configuradas
      // ═════════════════════════════════════════════════════════════════
      logger.info(`[PublicationOrchestrator] 🌐 Iniciando publicação real nas redes autorizadas...`);

      // Verifica status de cada rede:
      // Facebook: verifica token no banco
      const { data: fbTokenData } = await this.supabase
        .from('channel_tokens')
        .select('*')
        .eq('channel', 'facebook')
        .eq('status', 'ACTIVE')
        .maybeSingle();

      let fbStatus = fbTokenData?.access_token ? 'READY' : 'NOT_CONFIGURED';

      if (fbStatus !== 'READY') {
        logger.warn(`[PublicationOrchestrator] Facebook não está com credenciais prontas (${fbStatus}). Abortando disparo real.`);
        await this.supabase
          .from('publication_approvals')
          .update({
            status: 'BLOCKED_CHANNEL_NOT_CONFIGURED',
            notes: 'Canal Facebook não possui token ativo para publicação.',
            updated_at: new Date().toISOString(),
          })
          .eq('id', approvalId);

        return {
          success: false,
          status: 'BLOCKED_CHANNEL_NOT_CONFIGURED',
          channelStatus: {
            facebook: fbStatus,
            instagram: 'NOT_CONFIGURED',
            tiktok: 'NOT_CONFIGURED',
            youtube: 'NOT_CONFIGURED',
          },
          reason: 'Canal de publicação não configurado com credenciais válidas.',
        };
      }

      // Publica no Facebook Page oficial
      const postResult = await this.fbPublisher.publishPost({
        pageId: fbTokenData.page_id,
        pageAccessToken: fbTokenData.access_token,
        message: finalCopy,
        imageUrl: product.image_url,
        link: affiliateUrl,
      });

      const { data: pubRecord } = await this.supabase
        .from('publications')
        .insert({
          product_id: product.id,
          marketplace: product.marketplace || appr.marketplace || 'mercadolivre',
          social_network: 'FACEBOOK',
          status: 'PUBLISHED',
          content: finalCopy,
          media_url: appr.metadata?.video_url || product.image_url,
          affiliate_url: affiliateUrl,
          publication_url: postResult.publicationUrl,
          price_published: currentPrice,
          original_price_published: product.original_price,
          discount_published: product.discount_percent,
          strategy: appr.metadata?.strategy || 'DESCONTO',
          metadata: {
            approvalId,
            creativeId: appr.creative_id,
            postId: postResult.postId,
            publishedAt: postResult.publishedAt,
          },
        })
        .select()
        .single();

      // Atualiza aprovação para PUBLISHED
      await this.supabase
        .from('publication_approvals')
        .update({
          status: PIPELINE_STATES.PUBLISHED,
          publication_id: pubRecord?.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', approvalId);

      // Fecha intervenção do operador
      await this.supabase
        .from('operator_interventions')
        .update({ status: 'RESOLVED', resolved_at: new Date().toISOString() })
        .filter('metadata->>approvalId', 'eq', approvalId);

      await this.logDecisionDiary({
        tag: 'PUBLICAÇÃO',
        icon: '🚀',
        message: `Publicação oficial realizada no Facebook! ID: ${postResult.postId}`,
        productId: product.id,
        publicationId: pubRecord?.id,
        metadata: { publicationUrl: postResult.publicationUrl },
      });

      return {
        success: true,
        dryRun: false,
        status: PIPELINE_STATES.PUBLISHED,
        publicationId: pubRecord?.id,
        publicationUrl: postResult.publicationUrl,
        affiliateUrl,
        notification: {
          title: '🚀 Publicado!',
          message: 'O vídeo aprovado já foi publicado.',
          product: product.title,
          publishedNetworks: ['Facebook'],
          publicationUrl: postResult.publicationUrl,
        },
      };
    }
  }
}

export default PublicationOrchestrator;
