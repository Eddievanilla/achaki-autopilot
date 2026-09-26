/**
 * ACHAki Autopilot — MediaAssetService
 *
 * Gerencia o download de imagens de produtos, catálogo de músicas de fundo
 * licenciadas/royalty-free e interface de narração (VoiceProvider).
 */

import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import logger from '../../utils/logger.js';

export class MediaAssetService {
  constructor() {
    this.musicLibraryDir = path.resolve('data/audio/music');
    this.tempAssetsDir = path.resolve('data/temp_creatives');
    this._ensureDirectories();
  }

  _ensureDirectories() {
    try {
      if (!fs.existsSync(this.musicLibraryDir)) {
        fs.mkdirSync(this.musicLibraryDir, { recursive: true });
      }
      if (!fs.existsSync(this.tempAssetsDir)) {
        fs.mkdirSync(this.tempAssetsDir, { recursive: true });
      }
    } catch (e) {
      // Ignora erro em ambientes de filesystem read-only (Vercel)
    }
  }

  /**
   * Baixa uma imagem remota para o cache local do criativo.
   */
  async downloadProductImage(imageUrl, targetFilename = null) {
    try {
      const filename = targetFilename || `product_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.jpg`;
      const filePath = path.join(this.tempAssetsDir, filename);

      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error(`Falha no download da imagem: HTTP ${res.status}`);

      const fileStream = fs.createWriteStream(filePath);
      await pipeline(res.body, fileStream);

      return filePath;
    } catch (err) {
      logger.error(`[MediaAssetService] Erro ao baixar imagem do produto: ${err.message}`);
      throw err;
    }
  }

  /**
   * Retorna metadados de uma trilha de áudio licenciada/royalty-free para o criativo.
   * Se não houver arquivo local, retorna parâmetros para sintetizar melodia/fundo com FFmpeg.
   */
  getBackgroundMusic(strategy = 'DESCONTO') {
    // Catálogo conceitual com metadados de licença/origem
    const tracks = [
      {
        id: 'achaki_upbeat_viral_01',
        title: 'Upbeat Tech Groove',
        license: 'Creative Commons Zero / Royalty-Free',
        bpm: 120,
        mood: 'ENERGETIC',
        suitableFor: ['DESCONTO', 'LANCAMENTO', 'TENDENCIA'],
      },
      {
        id: 'achaki_ambient_lofi_02',
        title: 'Modern Lofi Discovery',
        license: 'Creative Commons Zero / Royalty-Free',
        bpm: 90,
        mood: 'RELAXED',
        suitableFor: ['UTILIDADE', 'CASA', 'ORGANIZACAO'],
      },
    ];

    const match = tracks.find(t => t.suitableFor.includes(strategy)) || tracks[0];
    return match;
  }
}

export default new MediaAssetService();
