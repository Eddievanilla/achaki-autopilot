/**
 * ACHAki Autopilot — LocalCreativeCacheManager
 *
 * Gerencia o ciclo de vida dos arquivos temporários e intermediários gerados
 * pela fábrica de criativos, liberando espaço em disco sem remover modelos ou workflows.
 */

import fs from 'node:fs';
import path from 'node:path';
import logger from '../../utils/logger.js';

export class LocalCreativeCacheManager {
  constructor() {
    this.tempDirs = [
      path.resolve('data/temp_creatives'),
      path.resolve('data/generated_creatives'),
    ];
    this.retentionDays = Number(process.env.LOCAL_CREATIVE_RETENTION_DAYS || 7);
  }

  /**
   * Executa a varredura e limpeza de arquivos intermediários expirados.
   */
  async cleanExpiredCache() {
    const maxAgeMs = this.retentionDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let deletedCount = 0;
    let freedBytes = 0;

    for (const dir of this.tempDirs) {
      if (!fs.existsSync(dir)) continue;

      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          // NUNCA apagar modelos, workflows ou arquivos de configuração
          if (file.endsWith('.safetensors') || file.endsWith('.gguf') || file.endsWith('.json') || file.endsWith('.ckpt')) {
            continue;
          }

          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);

          if (stat.isFile() && (now - stat.mtimeMs) > maxAgeMs) {
            freedBytes += stat.size;
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        }
      } catch (err) {
        logger.warn(`[LocalCreativeCacheManager] Erro ao varrer diretório ${dir}: ${err.message}`);
      }
    }

    if (deletedCount > 0) {
      logger.info(`[LocalCreativeCacheManager] Limpeza concluída: ${deletedCount} arquivos temporários removidos (${(freedBytes / 1024 / 1024).toFixed(2)} MB liberados).`);
    }

    return { deletedCount, freedBytes };
  }
}

export default new LocalCreativeCacheManager();
