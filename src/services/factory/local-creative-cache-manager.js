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
      path.resolve('data/produced_scenes'),
      path.resolve('data/temp_photos'),
    ];
    this.retentionHours = Number(process.env.LOCAL_CREATIVE_RETENTION_HOURS || 12);
  }

  /**
   * Calcula o tamanho total de um diretório em bytes.
   */
  _getDirSize(dirPath) {
    let totalSize = 0;
    try {
      if (!fs.existsSync(dirPath)) return 0;
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          totalSize += this._getDirSize(fullPath);
        } else {
          totalSize += stat.size;
        }
      }
    } catch (_) {}
    return totalSize;
  }

  /**
   * Remove imediatamente todos os assets intermediários de um job após o upload para o Storage.
   * Garante ZERO BYTES de acúmulo no disco da máquina local.
   *
   * @param {object} params
   * @param {string} params.creativeId - ID do job / criativo
   * @param {number} [params.version=1] - Versão do criativo
   * @returns {Promise<{ freedBytes: number }>}
   */
  async cleanJobArtifacts({ creativeId, version = 1 } = {}) {
    if (!creativeId) return { freedBytes: 0 };
    const safeId = String(creativeId).replace(/[^a-zA-Z0-9_-]/g, '');
    let freedBytes = 0;

    // 1. Remove diretório completo de cenas intermediárias
    const sceneDir = path.resolve(`data/produced_scenes/${safeId}_v${version}`);
    if (fs.existsSync(sceneDir)) {
      try {
        const size = this._getDirSize(sceneDir);
        freedBytes += size;
        fs.rmSync(sceneDir, { recursive: true, force: true });
        logger.info(`[LocalCreativeCacheManager] 🧹 Limpeza pós-upload: pasta de cenas removida: ${sceneDir} (${(size / 1024 / 1024).toFixed(2)} MB liberados).`);
      } catch (err) {
        logger.warn(`[LocalCreativeCacheManager] Aviso ao remover pasta de cenas: ${err.message}`);
      }
    }

    // 2. Remove arquivos temporários de render/áudio em generated_creatives
    const genDir = path.resolve('data/generated_creatives');
    if (fs.existsSync(genDir)) {
      try {
        const files = fs.readdirSync(genDir);
        for (const f of files) {
          // Arquivos específicos do job (exceto o master final mp4 se ainda estiver no pipeline)
          if (f.includes(safeId) && (f.endsWith('.txt') || f.endsWith('.mp3') || f.includes('temp_') || f.includes('assembled_raw'))) {
            const p = path.join(genDir, f);
            try {
              const sz = fs.statSync(p).size;
              freedBytes += sz;
              fs.unlinkSync(p);
            } catch (_) {}
          }
        }
      } catch (_) {}
    }

    return { freedBytes };
  }

  /**
   * Executa a varredura e limpeza periódica de arquivos intermediários expirados (> 12h).
   */
  async cleanExpiredCache() {
    const maxAgeMs = this.retentionHours * 60 * 60 * 1000;
    const now = Date.now();
    let deletedCount = 0;
    let freedBytes = 0;

    for (const dir of this.tempDirs) {
      if (!fs.existsSync(dir)) continue;

      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          // NUNCA apagar modelos, workflows ou arquivos de configuração
          if (item.endsWith('.safetensors') || item.endsWith('.gguf') || item.endsWith('.json') || item.endsWith('.ckpt')) {
            continue;
          }

          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            // Se for diretório de cenas antigo (> maxAgeMs), remove recursivamente
            if ((now - stat.mtimeMs) > maxAgeMs) {
              const dirSize = this._getDirSize(fullPath);
              freedBytes += dirSize;
              fs.rmSync(fullPath, { recursive: true, force: true });
              deletedCount++;
            }
          } else if (stat.isFile() && (now - stat.mtimeMs) > maxAgeMs) {
            freedBytes += stat.size;
            fs.unlinkSync(fullPath);
            deletedCount++;
          }
        }
      } catch (err) {
        logger.warn(`[LocalCreativeCacheManager] Erro ao varrer diretório ${dir}: ${err.message}`);
      }
    }

    if (deletedCount > 0) {
      logger.info(`[LocalCreativeCacheManager] Limpeza de cache expirado: ${deletedCount} itens removidos (${(freedBytes / 1024 / 1024).toFixed(2)} MB liberados).`);
    }

    return { deletedCount, freedBytes };
  }
}

export default new LocalCreativeCacheManager();
