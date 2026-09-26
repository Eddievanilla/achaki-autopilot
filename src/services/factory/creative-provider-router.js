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
  LIGHTWEIGHT_FFMPEG: 'LIGHTWEIGHT_FFMPEG',
  COMFYUI_I2V: 'COMFYUI_I2V',
  // Aliases para retrocompatibilidade
  LOCAL_COMFYUI: 'COMFYUI_I2V',
  COMPOSITOR_ONLY: 'LIGHTWEIGHT_FFMPEG',
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
   * Providers disponíveis:
   * - LIGHTWEIGHT_FFMPEG: ATIVO (usa fotos reais do produto, animações cinematográficas de câmera e FFmpeg).
   * - COMFYUI_I2V: OFFLINE (modelo generativo indisponível).
   *
   * IMPORTANTE: Não fingir que LIGHTWEIGHT_FFMPEG é Image-to-Video por IA.
   *
   * @param {object} params
   * @param {object} [params.hardwareProbe]
   * @param {'LOCAL_ONLY'|'COST_OPTIMIZED'|'QUALITY_FIRST'} [params.mode]
   * @param {string} [params.preferredProvider]
   * @returns {Promise<{ provider: string, visual_provider: string, reason: string, hardware: object, comfyui_status: string, lightweight_status: string, is_ai_video: boolean }>}
   */
  static async routeJob({
    hardwareProbe = null,
    mode = null,
    preferredProvider = null,
  } = {}) {
    const activeMode = mode || process.env.CREATIVE_PROVIDER_MODE || ROUTER_MODES.COST_OPTIMIZED;

    // 1. Executa ou reutiliza sonda de hardware
    const hw = hardwareProbe || await LocalHardwareProbe.probe();

    const comfyuiOnline = Boolean(hw.comfyui?.online && hw.wanModelAvailable);

    // Se ComfyUI estivesse ativo (atualmente OFFLINE)
    if (comfyuiOnline && preferredProvider === CREATIVE_PROVIDERS.COMFYUI_I2V) {
      return {
        provider: CREATIVE_PROVIDERS.COMFYUI_I2V,
        visual_provider: CREATIVE_PROVIDERS.COMFYUI_I2V,
        reason: 'ComfyUI I2V online com modelo local detectado.',
        hardware: hw,
        comfyui_status: 'ONLINE',
        lightweight_status: 'AVAILABLE',
        is_ai_video: true,
        cloudAllowed: false,
      };
    }

    // Provedor padrão ATIVO no momento: LIGHTWEIGHT_FFMPEG
    // (ComfyUI I2V permanece OFFLINE)
    return {
      provider: CREATIVE_PROVIDERS.LIGHTWEIGHT_FFMPEG,
      visual_provider: CREATIVE_PROVIDERS.LIGHTWEIGHT_FFMPEG,
      reason: 'LIGHTWEIGHT_FFMPEG ativo: fotos reais do produto animadas via FFmpeg com pan, zoom, parallax e motion graphics (ComfyUI I2V permanece offline; não é I2V neural).',
      hardware: hw,
      comfyui_status: comfyuiOnline ? 'ONLINE' : 'OFFLINE',
      lightweight_status: 'ACTIVE',
      is_ai_video: false,
      cloudAllowed: false,
    };
  }
}

export default CreativeProviderRouter;
