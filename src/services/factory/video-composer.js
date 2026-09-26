/**
 * ACHAki Autopilot — VideoComposer
 *
 * Compositor de vídeo vertical 9:16 (1080x1920) estilo produtora de Reels/TikTok.
 * Utiliza FFmpeg local (Open-Source / Custo Zero).
 *
 * Recursos:
 * - Suporte a locução neural humanizada (Voiceover MP3)
 * - Fundo desfocado dinâmico (blurred background)
 * - Legendas dinâmicas sincronizadas em 3 atos (Gancho -> Solução/Qualidade -> Desconto/CTA)
 * - Tarja superior de produto verificado ACHAki
 * - Card inferior de preço e desconto real
 * - Extração de thumbnail em alta resolução
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import logger from '../../utils/logger.js';

const execAsync = promisify(exec);

export class VideoComposer {
  constructor() {
    this.outputDir = path.resolve('data/generated_creatives');
    this._ensureOutputDir();
  }

  _ensureOutputDir() {
    try {
      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true });
      }
    } catch (e) {
      // Ignora erro em ambientes de filesystem read-only (Vercel)
    }
  }

  /**
   * Compõe um vídeo vertical 9:16 completo com locução neural e legendas de produtora.
   *
   * @param {object} params
   * @param {string} params.imagePath - Caminho local da imagem principal do produto
   * @param {string} [params.audioPath] - Caminho da locução neural gerada pelo VoiceoverService
   * @param {string} [params.title] - Título do produto
   * @param {number} [params.price] - Preço com desconto verificado
   * @param {number} [params.discountPercent] - Percentual de desconto
   * @param {string} [params.headline] - Gancho do Ato 1 (0 a 4s)
   * @param {string} [params.bodyText] - Benefício/Solução do Ato 2 (4 a 9s)
   * @param {string} [params.ctaText] - Chamada do Ato 3 (9s+)
   * @param {number} [params.duration=14] - Duração total em segundos
   * @param {string} [params.outputFilename] - Nome do arquivo de saída
   * @returns {Promise<{ videoPath: string, thumbnailPath: string, duration: number, resolution: string, fileSize: number }>}
   */
  async composeProductVideo({
    imagePath,
    audioPath = null,
    title = 'Achadinho Verificado',
    price = 0,
    discountPercent = 0,
    headline = 'OLHA ESSE ACHADINHO!',
    bodyText = 'PRÁTICO E DE ALTA QUALIDADE',
    ctaText = 'OFERTA COM DESCONTO REAL',
    duration = 14,
    outputFilename = null,
  }) {
    try {
      const id = Date.now();
      const filename = outputFilename || `creative_9_16_${id}.mp4`;
      const videoPath = path.join(this.outputDir, filename);
      const thumbnailPath = path.join(this.outputDir, `thumb_${id}.jpg`);

      // Sanitiza textos para drawtext do FFmpeg
      const cleanTitle = (title || 'Produto ACHAki').slice(0, 36).replace(/[:'\\]/g, ' ').toUpperCase();
      const cleanHook = (headline || 'OLHA ESSE ACHADINHO!').slice(0, 42).replace(/[:'\\]/g, ' ').toUpperCase();
      const cleanBody = (bodyText || 'PRATICO E DE ALTA QUALIDADE').slice(0, 42).replace(/[:'\\]/g, ' ').toUpperCase();
      const cleanCta = (ctaText || 'OFERTA COM DESCONTO REAL').slice(0, 42).replace(/[:'\\]/g, ' ').toUpperCase();
      const priceText = price > 0 ? `R$ ${Number(price).toFixed(2).replace('.', ',')}` : '';
      const discountText = discountPercent > 0 ? `(-${discountPercent}% OFF)` : '';

      logger.info(`[VideoComposer] 🎬 Renderizando vídeo estilo produtora 9:16 para "${cleanTitle}"...`);

      const normalizedImg = imagePath.replace(/\\/g, '/');
      const normalizedVideo = videoPath.replace(/\\/g, '/');
      const hasAudio = audioPath && fs.existsSync(audioPath);
      const normalizedAudio = hasAudio ? audioPath.replace(/\\/g, '/') : null;

      // ─────────────────────────────────────────────────────────────
      // FilterGraph Profissional de 3 Atos com Sincronia de Roteiro:
      // - [bg]: Fundo em escala 1080x1920 com desfoque elegante
      // - [fg]: Produto no centro nítido
      // - Ato 1 (0 a 4s): Gancho de impacto em amarelo vibrante
      // - Ato 2 (4 a 9s): Destaque da característica / solução em branco
      // - Ato 3 (9s+): Oferta e chamada para ação em verde neon
      // - Bottom Badge: Nome do produto + Preço em destaque
      // ─────────────────────────────────────────────────────────────
      const filterGraph = [
        `[0:v]loop=loop=-1:size=1:start=0,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5[bg]`,
        `[0:v]loop=loop=-1:size=1:start=0,scale=880:880:force_original_aspect_ratio=decrease,format=rgba[fg]`,
        `[bg][fg]overlay=(W-w)/2:(H-h)/2-80[base]`,
        // Topbar
        `[base]drawbox=x=60:y=100:w=960:h=90:color=black@0.75:t=fill[b1]`,
        `[b1]drawtext=text='ACHAki - ACHADINHO RECOMENDADO':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=125[b2]`,
        // Ato 1 (0 a 4s)
        `[b2]drawtext=text='${cleanHook}':fontcolor=yellow:fontsize=46:x=(w-text_w)/2:y=1410:enable='between(t,0,4)'[b3]`,
        // Ato 2 (4 a 9s)
        `[b3]drawtext=text='${cleanBody}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=1410:enable='between(t,4,9)'[b4]`,
        // Ato 3 (9s+)
        `[b4]drawtext=text='${cleanCta}':fontcolor=green:fontsize=44:x=(w-text_w)/2:y=1410:enable='gte(t,9)'[b5]`,
        // Card inferior
        `[b5]drawbox=x=60:y=1510:w=960:h=200:color=black@0.85:t=fill[b6]`,
        `[b6]drawtext=text='${cleanTitle}':fontcolor=white:fontsize=34:x=90:y=1545[b7]`,
        `[b7]drawtext=text='${priceText} ${discountText}':fontcolor=yellow:fontsize=48:x=90:y=1610[b8]`,
        `[b8]drawtext=text='Link oficial de afiliado na bio / comentarios':fontcolor=white@0.7:fontsize=24:x=90:y=1675[v]`
      ].join(';');

      let cmd = '';
      if (hasAudio) {
        // Usa locução neural real como faixa de áudio
        cmd = `ffmpeg -y -i "${normalizedImg}" -i "${normalizedAudio}" -filter_complex "${filterGraph}" -map "[v]" -map 1:a -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 192k -t ${duration} "${normalizedVideo}"`;
      } else {
        // Fallback sonoro suave se áudio não estiver presente
        const audioFilter = `aevalsrc='sin(2*PI*220*t)*0.05':s=44100:d=${duration}[a]`;
        cmd = `ffmpeg -y -i "${normalizedImg}" -filter_complex "${filterGraph};${audioFilter}" -map "[v]" -map "[a]" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 128k -t ${duration} "${normalizedVideo}"`;
      }

      await execAsync(cmd, { maxBuffer: 1024 * 1024 * 10 });

      // Extrai thumbnail em alta qualidade no segundo 1
      const thumbCmd = `ffmpeg -y -ss 00:00:01 -i "${normalizedVideo}" -vframes 1 -q:v 2 "${thumbnailPath.replace(/\\/g, '/')}"`;
      await execAsync(thumbCmd);

      const stats = fs.statSync(videoPath);

      logger.info(`[VideoComposer] ✅ Vídeo 9:16 estilo produtora renderizado com sucesso: ${filename} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

      return {
        videoPath,
        thumbnailPath,
        duration,
        resolution: '1080x1920',
        fileSize: stats.size,
      };
    } catch (err) {
      logger.error(`[VideoComposer] Erro na composição FFmpeg: ${err.message}`);
      throw err;
    }
  }
}

export default new VideoComposer();
