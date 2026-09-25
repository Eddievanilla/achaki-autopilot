/**
 * ACHAki Autopilot — ComfyUIClient
 *
 * Cliente local para comunicação direta com a API do ComfyUI (localhost:8188).
 * IMPORTANTE: Nunca exposto publicamente na internet. Acessível SOMENTE pelo worker local.
 */

import logger from '../../utils/logger.js';

export class ComfyUIClient {
  constructor({ baseUrl = null } = {}) {
    this.baseUrl = baseUrl || process.env.COMFYUI_BASE_URL || 'http://127.0.0.1:8188';
    this.enabled = process.env.COMFYUI_ENABLED !== 'false';
    this.clientId = `achaki-worker-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Checagem de disponibilidade do ComfyUI.
   */
  async healthCheck() {
    if (!this.enabled) {
      return { online: false, reason: 'COMFYUI_DISABLED_BY_ENV' };
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${this.baseUrl}/system_stats`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const stats = await res.json();
        return { online: true, stats };
      }
      return { online: false, reason: `HTTP_${res.status}` };
    } catch (err) {
      return { online: false, reason: err.message };
    }
  }

  /**
   * Lista modelos disponíveis instalados no ComfyUI.
   */
  async getModels() {
    try {
      const res = await fetch(`${this.baseUrl}/object_info/CheckpointLoaderSimple`);
      if (!res.ok) return [];
      const info = await res.json();
      return info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
    } catch (err) {
      logger.warn(`[ComfyUIClient] Falha ao listar modelos: ${err.message}`);
      return [];
    }
  }

  /**
   * Enfileira um workflow de geração no ComfyUI.
   */
  async queuePrompt(promptWorkflow) {
    try {
      const res = await fetch(`${this.baseUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptWorkflow,
          client_id: this.clientId,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`ComfyUI prompt error (HTTP ${res.status}): ${errText}`);
      }

      const data = await res.json();
      return {
        success: true,
        promptId: data.prompt_id,
        number: data.number,
      };
    } catch (err) {
      logger.error(`[ComfyUIClient] Erro ao enfileirar prompt: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Consulta o status de um job pelo promptId no histórico.
   */
  async getJobStatus(promptId) {
    try {
      const res = await fetch(`${this.baseUrl}/history/${promptId}`);
      if (!res.ok) return { completed: false, status: 'NOT_FOUND' };
      const history = await res.json();
      const jobData = history[promptId];
      if (!jobData) {
        return { completed: false, status: 'QUEUED_OR_RUNNING' };
      }

      const outputs = jobData.outputs || {};
      const status = jobData.status || {};

      return {
        completed: true,
        success: status.status_str !== 'error',
        outputs,
        status,
      };
    } catch (err) {
      return { completed: false, error: err.message };
    }
  }

  /**
   * Obtém histórico recente de jobs.
   */
  async getHistory(max = 20) {
    try {
      const res = await fetch(`${this.baseUrl}/history?max_items=${max}`);
      if (!res.ok) return {};
      return await res.json();
    } catch (err) {
      return {};
    }
  }

  /**
   * Faz o download do arquivo de output gerado pelo ComfyUI.
   */
  async getOutput(filename, subfolder = '', type = 'output') {
    try {
      const url = new URL(`${this.baseUrl}/view`);
      url.searchParams.set('filename', filename);
      if (subfolder) url.searchParams.set('subfolder', subfolder);
      if (type) url.searchParams.set('type', type);

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`Falha ao baixar output: HTTP ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      logger.error(`[ComfyUIClient] Erro ao obter output: ${err.message}`);
      throw err;
    }
  }

  /**
   * Cancela a execução do job em andamento.
   */
  async cancelJob(promptId = null) {
    try {
      const res = await fetch(`${this.baseUrl}/interrupt`, { method: 'POST' });
      return { success: res.ok };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

export default ComfyUIClient;
