/**
 * ACHAki Autopilot — InterventionManager
 *
 * Gerenciador central de solicitações de intervenção humana quando o robô
 * esbarra em desafios (CAPTCHA, Verificação de Conta, Login ou OAuth).
 *
 * Princípios:
 * 1. O robô NUNCA burla CAPTCHAs ou sistemas de segurança.
 * 2. Quando um desafio impede uma etapa, o robô solicita intervenção do operador
 *    de forma clara no Centro de Comando, fornecendo botão direto para a página do desafio.
 * 3. O operador intervém no navegador, e o robô detecta a resolução.
 */

import { supabase } from '../database/supabase.js';
import logger from '../utils/logger.js';
import eventLogger from './event-logger.js';

class InterventionManager {
  /**
   * Registra uma intervenção pendente no banco para exibição imediata no Centro de Comando.
   *
   * @param {object} params
   * @param {'CAPTCHA'|'SECURITY_CHALLENGE'|'LOGIN'|'OAUTH_DISCONNECTED'} params.type
   * @param {'mercadolivre'|'shopee'|'amazon'|'facebook'|'aliexpress'} params.marketplace
   * @param {string} params.title - Título claro do desafio
   * @param {string} params.message - Descrição objetiva do que o operador deve fazer
   * @param {string} params.targetUrl - URL exata para direcionamento do operador
   * @param {string} [params.actionLabel='Resolver Desafio ↗']
   * @param {object} [params.metadata]
   */
  async requestIntervention({
    type,
    marketplace,
    title,
    message,
    targetUrl,
    actionLabel = 'Resolver Desafio ↗',
    metadata = {},
  }) {
    try {
      logger.warn(`[InterventionManager] ⚠️ Solicitação de Intervenção Operacional: [${marketplace}] ${title}`);

      // Verifica se já existe uma intervenção PENDING idêntica aberta recentemente (últimos 15 min)
      const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      let query = supabase
        .from('operator_interventions')
        .select('id')
        .eq('status', 'PENDING')
        .eq('type', type)
        .eq('marketplace', marketplace)
        .gte('created_at', fifteenMinAgo);

      if (metadata?.approvalId) {
        query = query.filter('metadata->>approvalId', 'eq', metadata.approvalId);
      }

      const { data: existing } = await query.maybeSingle();

      let recordId = existing?.id;

      if (!recordId) {
        const { data: inserted, error: insertErr } = await supabase
          .from('operator_interventions')
          .insert({
            type,
            marketplace,
            title,
            message,
            target_url: targetUrl,
            action_label: actionLabel,
            status: 'PENDING',
            creative_id: metadata?.creativeId || null,
            product_id: metadata?.productId || null,
            metadata: {
              ...metadata,
              requestedAt: new Date().toISOString(),
            },
          })
          .select('id')
          .single();

        if (insertErr) {
          logger.error(`[InterventionManager] Falha ao gravar intervenção: ${insertErr.message}`);
        } else {
          recordId = inserted?.id;
        }
      }

      // Registra evento no Log ao Vivo do Centro de Comando
      await eventLogger.warning('ROBOT', `Intervenção solicitada: ${title}. Botão de resolução disponível no painel.`, {
        action: 'HUMAN_INTERVENTION_REQUIRED',
        metadata: {
          type,
          marketplace,
          targetUrl,
          interventionId: recordId,
        },
      });

      return { success: true, id: recordId };
    } catch (err) {
      logger.error(`[InterventionManager] Erro: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Marca uma intervenção como resolvida.
   *
   * @param {string} id
   */
  async resolveIntervention(id) {
    try {
      await supabase
        .from('operator_interventions')
        .update({
          status: 'RESOLVED',
          resolved_at: new Date().toISOString(),
        })
        .eq('id', id);

      logger.info(`[InterventionManager] ✓ Intervenção ${id} marcada como resolvida.`);
    } catch (err) {
      logger.error(`[InterventionManager] Erro ao resolver: ${err.message}`);
    }
  }

  /**
   * Resolve todas as intervenções pendentes de um tipo/marketplace específico.
   *
   * @param {string} marketplace
   * @param {string} [type]
   */
  async resolveAllFor(marketplace, type = null) {
    try {
      let query = supabase
        .from('operator_interventions')
        .update({
          status: 'RESOLVED',
          resolved_at: new Date().toISOString(),
        })
        .eq('status', 'PENDING')
        .eq('marketplace', marketplace);

      if (type) {
        query = query.eq('type', type);
      }

      await query;
      logger.info(`[InterventionManager] Intervenções pendentes de ${marketplace} marcadas como resolvidas.`);
    } catch (err) {
      logger.error(`[InterventionManager] Erro ao limpar intervenções: ${err.message}`);
    }
  }

  /**
   * Consulta as intervenções ativas (PENDING).
   */
  async getActiveInterventions() {
    try {
      const { data, error } = await supabase
        .from('operator_interventions')
        .select('*')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data || [];
    } catch (err) {
      logger.warn(`[InterventionManager] Falha ao consultar ativas: ${err.message}`);
      return [];
    }
  }

  /**
   * Aguarda ativamente até que o operador resolva a intervenção.
   *
   * @param {string} id - ID da intervenção
   * @param {number} [timeoutMs=300000] - Tempo limite em ms (padrão 5 min)
   * @param {Function} [checkBrowserResolved] - Função opcional para checar se o browser já desatravancou
   * @returns {Promise<boolean>}
   */
  async waitForResolution(id, timeoutMs = 300000, checkBrowserResolved = null) {
    const startTime = Date.now();
    const intervalMs = 4000;

    logger.info(`[InterventionManager] ⏸ Aguardando intervenção humana (ID: ${id || 'geral'})...`);

    while (Date.now() - startTime < timeoutMs) {
      if (checkBrowserResolved) {
        try {
          const browserOk = await checkBrowserResolved();
          if (browserOk) {
            logger.info('[InterventionManager] ✓ Resolução detectada diretamente pelo navegador!');
            if (id) await this.resolveIntervention(id);
            return true;
          }
        } catch (e) {}
      }

      if (id) {
        try {
          const { data } = await supabase
            .from('operator_interventions')
            .select('status')
            .eq('id', id)
            .maybeSingle();

          if (data && data.status === 'RESOLVED') {
            logger.info(`[InterventionManager] ✓ Intervenção ${id} confirmada como resolvida pelo operador!`);
            return true;
          }
        } catch (e) {}
      }

      await new Promise(r => setTimeout(r, intervalMs));
    }

    logger.warn(`[InterventionManager] ⏱ Tempo limite de espera esgotado (${Math.round(timeoutMs / 1000)}s).`);
    return false;
  }
}

export default new InterventionManager();
