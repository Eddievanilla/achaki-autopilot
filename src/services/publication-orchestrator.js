/**
 * ACHAki Autopilot — PublicationOrchestrator
 *
 * Entrada atual: produto selecionado -> solicitação manual de link -> AFFILIATE_LINK_READY.
 * Nenhum criativo ou publicação é iniciado pela seleção ou pela validação do link.
 * Os métodos de revisão de criativos existentes permanecem separados dessa entrada.
 */

import ManualAffiliateFlow from './manual-affiliate-flow.js';
import { supabase } from '../database/supabase.js';
import logger from '../utils/logger.js';
import eventLogger from './event-logger.js';
import { CreativeAgent } from '../agents/creative-agent.js';
import { AffiliateLinkValidator } from './affiliate-link-validator.js';
import FacebookPublisher from '../publishers/facebook-publisher.js';
import interventionManager from './intervention-manager.js';
import StrategyLearningEngine from './growth/strategy-learning-engine.js';
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
  AFFILIATE_LINK_READY: 'AFFILIATE_LINK_READY',
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
   * Registra somente uma solicitação manual de link para o produto.
   *
   * @param {object} params
   * @param {object} params.product - Produto com preço, título, marketplace, etc.
   * @param {string} [params.strategy='DESCONTO'] - Estratégia orgânica selecionada
   * @returns {Promise<object>} Objeto da aprovação criada
   */
  async startPipelineForProduct({ product }) {
    const request = await new ManualAffiliateFlow({ supabaseClient: this.supabase }).selectProduct(product);
    return { success: true, interventionId: request.id, status: request.metadata.step };
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
   * Submete e valida o link. Encerra em AFFILIATE_LINK_READY sem publicação.
   *
   * @param {object} params
   * @param {string} params.approvalId
   * @param {string} params.rawLink - Link gerado pelo operador
   * @param {boolean} [params.dryRun=false] - Modo DRY_RUN (obrigatório durante testes)
   * @returns {Promise<object>}
   */
  async submitAndValidateAffiliateLink({ approvalId, rawLink }) {
    const appr = await this._getApprovalWithProduct(approvalId);
    if ([PIPELINE_STATES.PUBLISHED, PIPELINE_STATES.DRY_RUN_PUBLISHED].includes(appr.status)) {
      return { success: false, status: appr.status, reason: 'Aprovação já encerrada.' };
    }
    const flow = new ManualAffiliateFlow({ supabaseClient: this.supabase, validator: this.linkValidator });
    const request = await flow.selectProduct(appr.products);
    const result = await flow.saveDetectedLink(request.id, rawLink);
    if (result.success) {
      const { error } = await this.supabase.from('publication_approvals').update({
        status: PIPELINE_STATES.AFFILIATE_LINK_READY, affiliate_url: result.affiliateUrl,
        affiliate_link_status: 'VERIFIED', updated_at: new Date().toISOString(),
      }).eq('id', approvalId);
      if (error) throw new Error(error.message);
    }
    return result;
  }
}

export default PublicationOrchestrator;
