/**
 * ACHAki Autopilot — CreativeProviderRouter
 *
 * Roteador de provedores de geração de criativos.
 * Prioriza execução LOCAL e BAIXO CUSTO.
 *
 * Provedores:
 * - LOCAL_COMFYUI: Modelo generativo de vídeo (Wan 2.2 / SVD) rodando no PC do operador
 * - COMPOSITOR_ONLY: Composição 9:16 nativa FFmpeg (fotos reais, pan/zoom, motion, overlay, áudio)
 * - CLOUD_VIDEO: Provedor cloud externo (ex: Veo). DESABILITADO por padrão (CLOUD_VIDEO_ENABLED=false)
 */

import logger from '../../utils/logger.js';
import { LocalHardwareProbe } from './local-hardware-probe.js';

export const CREATIVE_PROVIDERS = {
  LOCAL_COMFYUI: 'LOCAL_COMFYUI',
  COMPOSITOR_ONLY: 'COMPOSITOR_ONLY',
  CLOUD_VIDEO: 'CLOUD_VIDEO',
};

export const ROUTER_MODES = {
  LOCAL_ONLY: 'LOCAL_ONLY',
  COST_OPTIMIZED: 'COST_OPTIMIZED',
  QUALITY_FIRST: 'QUALITY_FIRST',
};

export class CreativeProviderRouter {
  /**
   * Decide o melhor provedor para um job específico considerando hardware, custos e regras.
   *
   * @param {object} params
   * @param {object} [params.hardwareProbe]
   * @param {'LOCAL_ONLY'|'COST_OPTIMIZED'|'QUALITY_FIRST'} [params.mode]
   * @param {string} [params.preferredProvider]
   * @returns {Promise<{ provider: string, reason: string, hardware: object, cloudAllowed: boolean }>}
   */
  static async routeJob({
    hardwareProbe = null,
    mode = null,
    preferredProvider = null,
  } = {}) {
    const activeMode = mode || process.env.CREATIVE_PROVIDER_MODE || ROUTER_MODES.COST_OPTIMIZED;
    const cloudVideoEnabled = process.env.CLOUD_VIDEO_ENABLED === 'true';

    // 1. Executa ou reutiliza sonda de hardware
    const hw = hardwareProbe || await LocalHardwareProbe.probe();

    // 2. Se o operador forçou um provedor específico
    if (preferredProvider === CREATIVE_PROVIDERS.LOCAL_COMFYUI) {
      if (hw.comfyui?.online && hw.wanModelAvailable) {
        return {
          provider: CREATIVE_PROVIDERS.LOCAL_COMFYUI,
          reason: 'ComfyUI online com modelo de vídeo local detectado.',
          hardware: hw,
          cloudAllowed: false,
        };
      }
      if (!hw.comfyui?.online) {
        return {
          provider: CREATIVE_PROVIDERS.COMPOSITOR_ONLY,
          reason: 'ComfyUI offline na porta 8188. Redirecionando para COMPOSITOR_ONLY (FFmpeg) para não travar produção.',
          fallbackFrom: CREATIVE_PROVIDERS.LOCAL_COMFYUI,
          hardware: hw,
          cloudAllowed: false,
        };
      }
    }

    // 3. Modo LOCAL_ONLY: nunca consulta nuvem
    if (activeMode === ROUTER_MODES.LOCAL_ONLY) {
      if (hw.comfyui?.online && hw.wanModelAvailable) {
        return {
          provider: CREATIVE_PROVIDERS.LOCAL_COMFYUI,
          reason: 'Modo LOCAL_ONLY: ComfyUI disponível localmente.',
          hardware: hw,
          cloudAllowed: false,
        };
      }
      return {
        provider: CREATIVE_PROVIDERS.COMPOSITOR_ONLY,
        reason: 'Modo LOCAL_ONLY: Usando composição FFmpeg de alta qualidade com imagens reais.',
        hardware: hw,
        cloudAllowed: false,
      };
    }

    // 4. Modo COST_OPTIMIZED (Padrão): Prioriza local custo zero
    if (activeMode === ROUTER_MODES.COST_OPTIMIZED) {
      if (hw.comfyui?.online && hw.wanModelAvailable) {
        return {
          provider: CREATIVE_PROVIDERS.LOCAL_COMFYUI,
          reason: 'Modo COST_OPTIMIZED: ComfyUI local ativo com modelo de vídeo.',
          hardware: hw,
          cloudAllowed: false,
        };
      }
      return {
        provider: CREATIVE_PROVIDERS.COMPOSITOR_ONLY,
        reason: 'Modo COST_OPTIMIZED: Composição FFmpeg nativa 9:16 (custo zero, rápido e sem dependência externa).',
        hardware: hw,
        cloudAllowed: false,
      };
    }

    // 5. Modo QUALITY_FIRST: Pode avaliar nuvem APENAS se explicitamente autorizada
    if (activeMode === ROUTER_MODES.QUALITY_FIRST && cloudVideoEnabled) {
      return {
        provider: CREATIVE_PROVIDERS.CLOUD_VIDEO,
        reason: 'Modo QUALITY_FIRST com CLOUD_VIDEO_ENABLED ativo e autorizado.',
        hardware: hw,
        cloudAllowed: true,
      };
    }

    // Fallback seguro padrão
    return {
      provider: CREATIVE_PROVIDERS.COMPOSITOR_ONLY,
      reason: 'Roteamento seguro: Composição FFmpeg nativa selecionada.',
      hardware: hw,
      cloudAllowed: false,
    };
  }
}

export default CreativeProviderRouter;
