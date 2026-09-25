/**
 * ACHAki Autopilot — CreativeStorageService
 *
 * Gerencia validação e upload de vídeos e thumbnails finais para o Supabase Storage
 * no bucket `creative-assets`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { supabase } from '../../database/supabase.js';
import logger from '../../utils/logger.js';

export class CreativeStorageService {
  constructor() {
    this.bucketName = 'creative-assets';
  }

  /**
   * Valida integridade do arquivo local antes de tentar upload.
   */
  validateLocalFile(filePath, expectedType = 'video') {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Arquivo não encontrado para upload: ${filePath}`);
    }
    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      throw new Error(`Arquivo corrompido ou vazio (0 bytes): ${filePath}`);
    }
    if (expectedType === 'video' && stats.size < 10000) {
      throw new Error(`Arquivo de vídeo muito pequeno (${stats.size} bytes). Provável erro de renderização.`);
    }
    return {
      size: stats.size,
      extension: path.extname(filePath).toLowerCase(),
    };
  }

  /**
   * Faz upload de criativo e thumbnail para o Supabase Storage.
   *
   * @param {object} params
   * @param {string} params.productId
   * @param {string} params.creativeId
   * @param {number} [params.version=1]
   * @param {string} params.videoPath
   * @param {string} [params.thumbnailPath]
   * @returns {Promise<{ videoUrl: string, thumbnailUrl: string, storagePath: string }>}
   */
  async uploadCreativePackage({
    productId,
    creativeId,
    version = 1,
    videoPath,
    thumbnailPath = null,
  }) {
    try {
      this.validateLocalFile(videoPath, 'video');
      if (thumbnailPath) {
        this.validateLocalFile(thumbnailPath, 'image');
      }

      const basePath = `creatives/${productId}/${creativeId}/v${version}`;
      const videoStoragePath = `${basePath}/final.mp4`;
      const thumbStoragePath = `${basePath}/thumbnail.jpg`;

      logger.info(`[CreativeStorageService] Enviando vídeo para Supabase Storage [${this.bucketName}:${videoStoragePath}]...`);

      // 1. Upload do vídeo MP4
      const videoBuffer = fs.readFileSync(videoPath);
      const { error: vidErr } = await supabase.storage
        .from(this.bucketName)
        .upload(videoStoragePath, videoBuffer, {
          contentType: 'video/mp4',
          upsert: true,
        });

      if (vidErr) {
        throw new Error(`Falha no upload do vídeo para o Storage: ${vidErr.message}`);
      }

      const { data: vidUrlData } = supabase.storage
        .from(this.bucketName)
        .getPublicUrl(videoStoragePath);

      const videoUrl = vidUrlData?.publicUrl;

      // 2. Upload da thumbnail JPEG
      let thumbnailUrl = null;
      if (thumbnailPath && fs.existsSync(thumbnailPath)) {
        const thumbBuffer = fs.readFileSync(thumbnailPath);
        const { error: thumbErr } = await supabase.storage
          .from(this.bucketName)
          .upload(thumbStoragePath, thumbBuffer, {
            contentType: 'image/jpeg',
            upsert: true,
          });

        if (!thumbErr) {
          const { data: thumbUrlData } = supabase.storage
            .from(this.bucketName)
            .getPublicUrl(thumbStoragePath);
          thumbnailUrl = thumbUrlData?.publicUrl;
        }
      }

      logger.info(`[CreativeStorageService] ✅ Upload concluído com sucesso: ${videoUrl}`);

      return {
        videoUrl,
        thumbnailUrl: thumbnailUrl || videoUrl,
        storagePath: videoStoragePath,
      };
    } catch (err) {
      logger.error(`[CreativeStorageService] Erro no upload de criativo: ${err.message}`);
      throw err;
    }
  }
}

export default new CreativeStorageService();
