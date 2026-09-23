/**
 * ACHAki Autopilot — TrackingService
 *
 * Gera identificadores e URLs rastreáveis únicas para cada oferta publicada:
 * Formato: https://achaki-autopilot.vercel.app/go/{tracking_id}
 */

import { supabase } from '../database/supabase.js';
import logger from '../utils/logger.js';

export class TrackingService {
  constructor({ baseUrl = 'https://achaki-autopilot.vercel.app' } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.client = supabase;
  }

  /**
   * Gera um ID de tracking único alfanumérico.
   * @returns {string}
   */
  generateTrackingId() {
    const timePart = Date.now().toString(36).slice(-5);
    const randPart = Math.random().toString(36).substring(2, 7);
    return `ak_${timePart}_${randPart}`;
  }

  /**
   * Monta a URL de tracking completa.
   * @param {string} trackingId
   * @returns {string}
   */
  buildTrackingUrl(trackingId) {
    return `${this.baseUrl}/go/${trackingId}`;
  }
}

export default TrackingService;
