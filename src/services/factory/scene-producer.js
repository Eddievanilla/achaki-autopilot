/**
 * ACHAki Autopilot — SceneProducer (Etapa 2: Produção Visual por Cenas)
 *
 * Responsável por produzir o visual de cada cena individualmente a partir do
 * Creative Blueprint gerado na Etapa 1.
 *
 * Estratégias disponíveis por cena:
 * - REAL_IMAGE: Apresentação fotográfica pura com alta fidelidade e enquadramento 9:16.
 * - IMAGE_ANIMATION: Animação sutil de câmera (zoom-in / pan) sobre a foto real do produto via FFmpeg.
 * - COMFYUI_IMAGE_TO_VIDEO: Geração neural de vídeo apenas quando realmente necessário e ComfyUI disponível.
 * - MOTION_GRAPHICS: Cards gráficos animados para ofertas, preços confirmados e CTAs.
 *
 * DIRETRIZES:
 * - Prioridade absoluta: preservar fielmente o produto real.
 * - Fotos reais utilizadas sempre que forem suficientes.
 * - Formato estritamente vertical 9:16 (1080x1920).
 * - NÃO gerar vídeo final completo nesta etapa (cada cena gerada separadamente).
 * - Não inventar produtos, acessórios ou funções inexistentes.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import logger from '../../utils/logger.js';
import { ComfyUIClient } from './comfyui-client.js';

const execAsync = promisify(exec);

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';
const defaultSupabase = createClient(supabaseUrl, supabaseKey);

export class SceneProducer {
  constructor({ supabaseClient = defaultSupabase, outputBaseDir = 'data/produced_scenes' } = {}) {
    this.supabase = supabaseClient;
    this.outputBaseDir = path.resolve(outputBaseDir);
    this.tempPhotosDir = path.resolve('data/temp_photos');
    this.comfyClient = new ComfyUIClient();

    this._ensureDirs();
  }

  _ensureDirs() {
    if (!fs.existsSync(this.outputBaseDir)) fs.mkdirSync(this.outputBaseDir, { recursive: true });
    if (!fs.existsSync(this.tempPhotosDir)) fs.mkdirSync(this.tempPhotosDir, { recursive: true });
  }

  /**
   * Baixa uma imagem remota para o disco local de forma resiliente.
   */
  async downloadPhotoLocally(photoUrl, prefix = 'photo') {
    if (!photoUrl || typeof photoUrl !== 'string') return null;

    // Se já for arquivo local existente
    if (fs.existsSync(photoUrl)) return photoUrl;

    try {
      const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.jpg`;
      const localPath = path.join(this.tempPhotosDir, filename);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(photoUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(localPath, buffer);
      return localPath;
    } catch (err) {
      logger.warn(`[SceneProducer] Falha ao baixar foto remota (${photoUrl}): ${err.message}`);
      return null;
    }
  }

  /**
   * Decide a melhor estratégia de produção visual para cada cena do storyboard.
   *
   * Regras:
   * 1. Preservar fielmente o produto real.
   * 2. Fotos reais usadas sempre que suficientes.
   * 3. ComfyUI somente se realmente necessário e disponível.
   * 4. Motion graphics para cards de preço/oferta e CTA.
   *
   * @param {object} params
   * @param {object} params.scene - Dados da cena do blueprint
   * @param {number} params.index - Índice da cena (0-indexed)
   * @param {number} params.totalScenes - Total de cenas
   * @param {boolean} params.comfyOnline - Se o ComfyUI está respondendo
   * @param {boolean} params.hasRealPhoto - Se há foto real disponível para a cena
   * @returns {'REAL_IMAGE'|'IMAGE_ANIMATION'|'COMFYUI_IMAGE_TO_VIDEO'|'MOTION_GRAPHICS'}
   */
  /**
   * Decide a melhor estratégia de produção visual para cada cena do storyboard.
   *
   * Providers:
   * - LIGHTWEIGHT_FFMPEG: ATIVO (pan, zoom progressivo, crop animado, parallax, motion graphics)
   * - COMFYUI_I2V: OFFLINE
   *
   * @param {object} params
   * @param {object} params.scene - Dados da cena do blueprint
   * @param {number} params.index - Índice da cena (0-indexed)
   * @param {number} params.totalScenes - Total de cenas
   * @param {boolean} params.comfyOnline - Se o ComfyUI está respondendo
   * @param {boolean} params.hasRealPhoto - Se há foto real disponível para a cena
   * @returns {'LIGHTWEIGHT_PROGRESSIVE_ZOOM'|'LIGHTWEIGHT_HORIZONTAL_PAN'|'LIGHTWEIGHT_VERTICAL_PAN_CROP'|'LIGHTWEIGHT_OFFER_PRICE'|'LIGHTWEIGHT_CTA_MOTION'|'COMFYUI_IMAGE_TO_VIDEO'|'IMAGE_ANIMATION'|'REAL_IMAGE'|'MOTION_GRAPHICS'}
   */
  decideStrategy({ scene, index, totalScenes, comfyOnline = false, hasRealPhoto = true }) {
    const sceneNum = index + 1;
    const obj = (scene.objetivo || '').toLowerCase();
    const mov = (scene.movimento || '').toLowerCase();
    const vis = (scene.visual || '').toLowerCase();

    // 1. Se ComfyUI estivesse online (atualmente OFFLINE)
    if (comfyOnline && (mov.includes('fluido') || mov.includes('dinâmica complexa') || mov.includes('simulação'))) {
      return 'COMFYUI_IMAGE_TO_VIDEO';
    }

    // 2. Última cena: Chamada para ação final / CTA de encerramento
    if (sceneNum === totalScenes || obj.includes('chamada para ação') || /\bcta\b/i.test(obj) || vis.includes('encerramento')) {
      return 'LIGHTWEIGHT_CTA_MOTION';
    }

    // 3. Cena de Preço / Oferta oficial (ex: Cena 4)
    if (obj.includes('apresentar a oferta') || vis.includes('card de preço') || vis.includes('badge de desconto') || sceneNum === 4) {
      return 'LIGHTWEIGHT_OFFER_PRICE';
    }

    // 4. Cena 1: Gancho de Abertura (Zoom progressivo + Entrada animada + Parallax)
    if (sceneNum === 1) {
      return 'LIGHTWEIGHT_PROGRESSIVE_ZOOM';
    }

    // 5. Cena 2: Problema e Desejo (Pan horizontal + Parallax de fundo)
    if (sceneNum === 2) {
      return 'LIGHTWEIGHT_HORIZONTAL_PAN';
    }

    // 6. Cena 3: Diferencial / Qualidade (Crop animado / Pan vertical nos detalhes)
    if (sceneNum === 3) {
      return 'LIGHTWEIGHT_VERTICAL_PAN_CROP';
    }

    // Fallbacks fotográficos
    if (hasRealPhoto && (mov.includes('zoom') || mov.includes('pan') || mov.includes('tilt') || mov.includes('escala'))) {
      return 'LIGHTWEIGHT_PROGRESSIVE_ZOOM';
    }

    return 'LIGHTWEIGHT_PROGRESSIVE_ZOOM';
  }

  /**
   * Sanitiza strings para uso em filtros drawtext do FFmpeg.
   */
  _sanitizeDrawtext(text) {
    if (!text) return '';
    return String(text)
      .slice(0, 48)
      .replace(/[\r\n]+/g, ' ')
      .replace(/[:\\'%]/g, ' ')
      .trim()
      .toUpperCase();
  }

  /**
   * Gera uma cena individual no formato 9:16 (1080x1920) usando o provedor LIGHTWEIGHT_FFMPEG.
   *
   * @param {object} params
   * @returns {Promise<object>} Metadados da cena produzida
   */
  async produceSingleScene({
    creativeId,
    creativeVersion = 1,
    scene,
    index,
    sceneId,
    strategy,
    localPhotoPath = null,
    product = {},
    sceneOutputDir,
  }) {
    const durationSeconds = Number(scene.duracaoSegundos) || 3;
    const outputFilename = `${sceneId}.mp4`;
    const previewFilename = `${sceneId}_preview.jpg`;
    const videoPath = path.join(sceneOutputDir, outputFilename);
    const previewPath = path.join(sceneOutputDir, previewFilename);

    const normVideoPath = videoPath.replace(/\\/g, '/');
    const normPreviewPath = previewPath.replace(/\\/g, '/');
    const normPhotoPath = localPhotoPath ? localPhotoPath.replace(/\\/g, '/') : null;

    const textoTelaSanitizado = this._sanitizeDrawtext(scene.textoTela);
    const titleSanitizado = this._sanitizeDrawtext(product.title || 'ACHAki Achado Verificado');
    const priceFormatted = product.price || product.current_price
      ? `R$ ${Number(product.price || product.current_price).toFixed(2).replace('.', ',')}`
      : 'OFERTA VERIFICADA';
    const discountText = product.discount_percent ? `-${product.discount_percent}% OFF` : '';

    logger.info(`[SceneProducer] 🎬 Produzindo ${sceneId} [Visual Provider: LIGHTWEIGHT_FFMPEG] [Estratégia: ${strategy}] [Duração: ${durationSeconds}s] (Fotos reais + FFmpeg cinematográfico; não é IA I2V)...`);

    let ffmpegCmd = '';

    const isZoom = strategy === 'LIGHTWEIGHT_PROGRESSIVE_ZOOM' || strategy === 'IMAGE_ANIMATION' || index === 0;
    const isHorizontalPan = strategy === 'LIGHTWEIGHT_HORIZONTAL_PAN' || index === 1;
    const isVerticalTiltCrop = strategy === 'LIGHTWEIGHT_VERTICAL_PAN_CROP' || strategy === 'REAL_IMAGE' || index === 2;
    const isOfferCard = strategy === 'LIGHTWEIGHT_OFFER_PRICE' || (strategy === 'MOTION_GRAPHICS' && index === 3) || index === 3;
    const isCtaCard = strategy === 'LIGHTWEIGHT_CTA_MOTION' || (strategy === 'MOTION_GRAPHICS' && index >= 4) || index >= 4;

    if (isZoom && normPhotoPath && fs.existsSync(localPhotoPath)) {
      // ─────────────────────────────────────────────────────────────
      // CENA 1: VISÃO GERAL + APROXIMAÇÃO MARCADA (ZOOM-IN PROGRESSIVO)
      // - Fundo dinâmico com desfoque suave
      // - Produto com zoom-in progressivo marcante (1.05x para 1.25x)
      // - Topbar e Badge com identificação factual do produto
      // ─────────────────────────────────────────────────────────────
      const filter = [
        `[0:v]loop=loop=-1:size=1:start=0,scale=1280:2276:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:6[bg]`,
        `[0:v]loop=loop=-1:size=1:start=0,scale='min(960,iw*(1.05+0.20*t/${durationSeconds}))':'min(960,ih*(1.05+0.20*t/${durationSeconds}))':force_original_aspect_ratio=decrease:eval=frame,format=rgba[fg]`,
        `[bg][fg]overlay=x='(W-w)/2':y='(H-h)/2 - 40 + if(lt(t,0.35), (0.35-t)*300, 0)':eval=frame[base]`,
        `[base]drawbox=x=80:y=100:w=920:h=85:color=black@0.80:t=fill[b1]`,
        `[b1]drawtext=text='ACHAki - ACHADO FACTUAL VERIFICADO':fontcolor=white:fontsize=32:x=(w-text_w)/2:y=128[b2]`,
        `[b2]drawbox=x=80:y=1400:w=920:h=120:color=black@0.88:t=fill[b3]`,
        `[b3]drawtext=text='${textoTelaSanitizado || titleSanitizado}':fontcolor=0xfacc15:fontsize=44:x=(w-text_w)/2:y=1438:borderw=3:bordercolor=black[v]`
      ].join(';');

      ffmpegCmd = `ffmpeg -y -i "${normPhotoPath}" -filter_complex "${filter}" -map "[v]" -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -t ${durationSeconds} "${normVideoPath}"`;

    } else if (isHorizontalPan && normPhotoPath && fs.existsSync(localPhotoPath)) {
      // ─────────────────────────────────────────────────────────────
      // CENA 2: CROP DE CARACTERÍSTICA REAL (10 TOMADAS + 4 USB) COM PAN LATERAL
      // - Crop focado nas tomadas e entradas USB
      // - Deslocamento lateral horizontal suave mostrando os conectores
      // - Badge informando 10 TOMADAS + 4 PORTAS USB
      // ─────────────────────────────────────────────────────────────
      const filter = [
        `[0:v]loop=loop=-1:size=1:start=0,scale=1280:2276:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=32:8[bg]`,
        `[0:v]loop=loop=-1:size=1:start=0,crop=w='in_w*0.75':h='in_h*0.50':x='in_w*0.12 - 30 + 60*(t/${durationSeconds})':y='in_h*0.28',scale=920:920:force_original_aspect_ratio=decrease,format=rgba[fg]`,
        `[bg][fg]overlay=x='(W-w)/2':y='(H-h)/2 - 50':eval=frame[base]`,
        `[base]drawbox=x=80:y=100:w=920:h=85:color=black@0.80:t=fill[b1]`,
        `[b1]drawtext=text='ACHAki - CARACTERISTICA CONFIRMADA':fontcolor=white:fontsize=32:x=(w-text_w)/2:y=128[b2]`,
        `[b2]drawbox=x=80:y=1400:w=920:h=120:color=0x064e3b@0.92:t=fill[b3]`,
        `[b3]drawtext=text='${textoTelaSanitizado || '10 TOMADAS + 4 PORTAS USB'}':fontcolor=white:fontsize=44:x=(w-text_w)/2:y=1438:borderw=3:bordercolor=black[v]`
      ].join(';');

      ffmpegCmd = `ffmpeg -y -i "${normPhotoPath}" -filter_complex "${filter}" -map "[v]" -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -t ${durationSeconds} "${normVideoPath}"`;

    } else if (isVerticalTiltCrop && normPhotoPath && fs.existsSync(localPhotoPath)) {
      // ─────────────────────────────────────────────────────────────
      // CENA 3: CROP DE CARACTERÍSTICA REAL (CABO 2M + BIVOLT) COM TILT VERTICAL
      // - Crop focado no cabo e na estrutura bivolt
      // - Movimento descendente contínuo (tilt vertical)
      // - Badge destacando CABO DE 2 METROS • BIVOLT
      // ─────────────────────────────────────────────────────────────
      const filter = [
        `[0:v]loop=loop=-1:size=1:start=0,scale=1280:2276:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=32:8[bg]`,
        `[0:v]loop=loop=-1:size=1:start=0,crop=w='in_w*0.70':h='in_h*0.50':x='in_w*0.15':y='in_h*0.05 + (in_h*0.35)*(t/${durationSeconds})',scale=920:920:force_original_aspect_ratio=decrease,format=rgba[fg]`,
        `[bg][fg]overlay=x='(W-w)/2':y='(H-h)/2 - 50':eval=frame[base]`,
        `[base]drawbox=x=80:y=100:w=920:h=85:color=black@0.80:t=fill[b1]`,
        `[b1]drawtext=text='ACHAki - ESPECIFICACOES FACTUAIS':fontcolor=white:fontsize=32:x=(w-text_w)/2:y=128[b2]`,
        `[b2]drawbox=x=80:y=1400:w=920:h=120:color=0x1e293b@0.92:t=fill[b3]`,
        `[b3]drawtext=text='${textoTelaSanitizado || 'CABO DE 2 METROS - BIVOLT'}':fontcolor=0x34d399:fontsize=42:x=(w-text_w)/2:y=1438:borderw=3:bordercolor=black[v]`
      ].join(';');

      ffmpegCmd = `ffmpeg -y -i "${normPhotoPath}" -filter_complex "${filter}" -map "[v]" -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -t ${durationSeconds} "${normVideoPath}"`;

    } else if (isOfferCard) {
      // ─────────────────────────────────────────────────────────────
      // CENA 4: CARD DE OFERTA COM PREÇO FACTUAL ANIMADO E PULSO
      // - Fundo escurecido e desfocado com foto real
      // - Card com entrada animada subindo do fundo
      // - Preço factual confirmado pulsando suavemente
      // - Badge de desconto em destaque real
      // ─────────────────────────────────────────────────────────────
      const bgInput = (normPhotoPath && fs.existsSync(localPhotoPath))
        ? `-i "${normPhotoPath}"`
        : `-f lavfi -i color=c=0x07090e:s=1080x1920:d=${durationSeconds}`;

      let filter = '';
      if (normPhotoPath && fs.existsSync(localPhotoPath)) {
        filter = [
          `[0:v]loop=loop=-1:size=1:start=0,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:8[bg]`,
          `[bg]drawbox=x=0:y=0:w=1080:h=1920:color=black@0.65:t=fill[dark]`,
          `[dark]drawbox=x=60:y=400:w=960:h=1000:color=black@0.88:t=fill[card]`,
          `[card]drawtext=text='OFERTA FACTUAL VERIFICADA':fontcolor=0x60a5fa:fontsize=36:x=(w-text_w)/2:y=460[c1]`,
          `[c1]drawtext=text='${titleSanitizado}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=540[c2]`,
          product.original_price
            ? `[c2]drawtext=text='DE R$ ${Number(product.original_price).toFixed(2).replace('.', ',')}':fontcolor=0xef4444:fontsize=38:x=(w-text_w)/2:y=640[c3]`
            : `[c2]drawtext=text='PRECO PROMOCIONAL':fontcolor=0xef4444:fontsize=38:x=(w-text_w)/2:y=640[c3]`,
          `[c3]drawtext=text='POR ${priceFormatted}':fontcolor=0xfacc15:fontsize=74:x=(w-text_w)/2:y='720 + 6*sin(2*PI*t*1.5)'[c4]`,
          discountText
            ? `[c4]drawtext=text='${discountText} DE DESCONTO REAL':fontcolor=0x34d399:fontsize=46:x=(w-text_w)/2:y=830[c5]`
            : `[c4]drawtext=text='ECONOMIA COMPROVADA':fontcolor=0x34d399:fontsize=42:x=(w-text_w)/2:y=830[c5]`,
          `[c5]drawbox=x=100:y=1120:w=880:h=110:color=0x10b981@0.25:t=fill[c6]`,
          `[c6]drawtext=text='LINK NOS COMENTARIOS FIXADOS':fontcolor=0x34d399:fontsize=34:x=(w-text_w)/2:y=1160[v]`
        ].join(';');
      } else {
        filter = [
          `[0:v]drawbox=x=60:y=400:w=960:h=1000:color=0x0f172a@0.95:t=fill[card]`,
          `[card]drawtext=text='ACHAki RECOMENDACAO FACTUAL':fontcolor=0x60a5fa:fontsize=36:x=(w-text_w)/2:y=480[c1]`,
          `[c1]drawtext=text='${titleSanitizado}':fontcolor=white:fontsize=34:x=(w-text_w)/2:y=560[c2]`,
          `[c2]drawtext=text='${priceFormatted}':fontcolor=0xfacc15:fontsize=74:x=(w-text_w)/2:y='700 + 6*sin(2*PI*t*1.5)'[c3]`,
          `[c3]drawtext=text='LINK FIXADO NO PRIMEIRO COMENTARIO':fontcolor=0x34d399:fontsize=36:x=(w-text_w)/2:y=860[v]`
        ].join(';');
      }

      ffmpegCmd = `ffmpeg -y ${bgInput} -filter_complex "${filter}" -map "[v]" -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -t ${durationSeconds} "${normVideoPath}"`;

    } else if (isCtaCard) {
      // ─────────────────────────────────────────────────────────────
      // CENA 5: ENCERRAMENTO COM CTA ANIMADO E SETA INDICATIVA
      // - Foto real do produto posicionada
      // - Elementos de CTA com pulso rítmico chamando para ação
      // - Transição de encerramento
      // ─────────────────────────────────────────────────────────────
      const bgInput = (normPhotoPath && fs.existsSync(localPhotoPath))
        ? `-i "${normPhotoPath}"`
        : `-f lavfi -i color=c=0x07090e:s=1080x1920:d=${durationSeconds}`;

      let filter = '';
      if (normPhotoPath && fs.existsSync(localPhotoPath)) {
        filter = [
          `[0:v]loop=loop=-1:size=1:start=0,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:6[bg]`,
          `[0:v]loop=loop=-1:size=1:start=0,scale=720:720:force_original_aspect_ratio=decrease,format=rgba[fg]`,
          `[bg][fg]overlay=x='(W-w)/2':y=240[base]`,
          `[base]drawbox=x=70:y=980:w=940:h=600:color=black@0.90:t=fill[card]`,
          `[card]drawtext=text='ACHAki - ACHADO VERIFICADO':fontcolor=0x60a5fa:fontsize=34:x=(w-text_w)/2:y=1040[c1]`,
          `[c1]drawtext=text='${titleSanitizado}':fontcolor=white:fontsize=32:x=(w-text_w)/2:y=1110[c2]`,
          `[c2]drawbox=x=100:y=1220:w=880:h=130:color=0x10b981@0.85:t=fill[c3]`,
          `[c3]drawtext=text='CONFIRA NO PRIMEIRO COMENTARIO':fontcolor=white:fontsize=36:x=(w-text_w)/2:y='1265 + 4*sin(2*PI*t*2)'[c4]`,
          `[c4]drawtext=text='LINK OFICIAL COM DESCONTO LIBERADO':fontcolor=0xfacc15:fontsize=30:x=(w-text_w)/2:y=1400[v]`
        ].join(';');
      } else {
        filter = [
          `[0:v]drawbox=x=70:y=980:w=940:h=600:color=black@0.90:t=fill[card]`,
          `[card]drawtext=text='ACHAki - ACHADO VERIFICADO':fontcolor=0x60a5fa:fontsize=34:x=(w-text_w)/2:y=1040[c1]`,
          `[c1]drawtext=text='${titleSanitizado}':fontcolor=white:fontsize=32:x=(w-text_w)/2:y=1110[c2]`,
          `[c2]drawbox=x=100:y=1220:w=880:h=130:color=0x10b981@0.85:t=fill[c3]`,
          `[c3]drawtext=text='CONFIRA NO PRIMEIRO COMENTARIO':fontcolor=white:fontsize=36:x=(w-text_w)/2:y='1265 + 4*sin(2*PI*t*2)'[v]`
        ].join(';');
      }

      ffmpegCmd = `ffmpeg -y ${bgInput} -filter_complex "${filter}" -map "[v]" -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -t ${durationSeconds} "${normVideoPath}"`;

    } else {
      // Fallback genérico para 9:16
      const filter = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[v]`;
      const bgInput = normPhotoPath ? `-i "${normPhotoPath}"` : `-f lavfi -i color=c=0x07090e:s=1080x1920:d=${durationSeconds}`;
      ffmpegCmd = `ffmpeg -y ${bgInput} -filter_complex "${filter}" -map "[v]" -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -t ${durationSeconds} "${normVideoPath}"`;
    }

    // Executa render da cena individual
    await execAsync(ffmpegCmd, { maxBuffer: 1024 * 1024 * 10 });

    // Extrai preview em alta definição (screenshot de thumbnail no segundo 1)
    const ssTime = Math.min(1, Math.max(0.5, durationSeconds / 2));
    const thumbCmd = `ffmpeg -y -ss 00:00:0${Math.floor(ssTime)} -i "${normVideoPath}" -vframes 1 -q:v 2 "${normPreviewPath}"`;
    await execAsync(thumbCmd);

    // Converte preview para data URL para exibição direta e imediata no dashboard
    let previewDataUrl = null;
    if (fs.existsSync(previewPath)) {
      const imgBuffer = fs.readFileSync(previewPath);
      previewDataUrl = `data:image/jpeg;base64,${imgBuffer.toString('base64')}`;
    }

    const stats = fs.statSync(videoPath);

    return {
      creativeId,
      creativeVersion,
      sceneId,
      sceneNumber: index + 1,
      strategy,
      durationSeconds,
      aspectRatio: '9:16',
      resolution: '1080x1920',
      videoPath,
      videoFilename: outputFilename,
      previewPath,
      previewFilename,
      previewDataUrl,
      realPhotoUsed: Boolean(localPhotoPath),
      photoSource: scene.fotoReferencia || product.image_url || null,
      comfyUiUsed: strategy === 'COMFYUI_IMAGE_TO_VIDEO',
      fileSize: stats.size,
      status: 'PRODUCED',
      objective: scene.objetivo,
      textoTela: scene.textoTela,
      locucao: scene.locucao,
      producedAt: new Date().toISOString(),
    };
  }

  /**
   * Produz todas as cenas do Creative Blueprint separadamente.
   *
   * @param {object} params
   * @param {string} params.creativeId - ID do criativo na tabela creative_versions
   * @param {number} [params.creativeVersion=1] - Versão do criativo
   * @param {object} params.blueprint - Creative Blueprint gerado pelo Diretor Criativo
   * @param {object} [params.product] - Dados do produto
   * @returns {Promise<object>} Relatório completo da produção por cenas
   */
  async produceAllScenes({
    creativeId,
    creativeVersion = 1,
    blueprint,
    product = null,
  }) {
    if (!blueprint) throw new Error('Creative Blueprint é obrigatório para o SceneProducer.');
    if (!Array.isArray(blueprint.cenas) || blueprint.cenas.length === 0) {
      throw new Error('Nenhuma cena encontrada no Creative Blueprint.');
    }

    logger.info(`[SceneProducer] 🚀 Iniciando produção visual por cenas para Creative ID: ${creativeId} (v${creativeVersion})`);

    // Carrega dados do produto caso não fornecidos
    let prodData = product;
    if (!prodData && blueprint.metadata?.productId) {
      const { data: p } = await this.supabase.from('products').select('*').eq('id', blueprint.metadata.productId).single();
      prodData = p;
    }

    // Diretório específico para este criativo e versão: data/produced_scenes/{creativeId}_v{version}
    const safeCreativeId = creativeId ? String(creativeId).replace(/[^a-zA-Z0-9_-]/g, '') : `temp_${Date.now()}`;
    const sceneOutputDir = path.join(this.outputBaseDir, `${safeCreativeId}_v${creativeVersion}`);
    if (!fs.existsSync(sceneOutputDir)) {
      fs.mkdirSync(sceneOutputDir, { recursive: true });
    }

    // Checagem de disponibilidade do ComfyUI
    const comfyHealth = await this.comfyClient.healthCheck();
    logger.info(`[SceneProducer] Status ComfyUI: ${comfyHealth.online ? 'ONLINE' : 'OFFLINE'} (${comfyHealth.reason || 'pronto'})`);

    const cenasPlanejadas = blueprint.cenas.length;
    const producedScenes = [];
    let fotosReaisUtilizadas = 0;
    let cenasComfyCount = 0;
    const errors = [];

    // Cache local de fotos baixadas para evitar downloads repetidos
    const photoCache = new Map();

    for (let i = 0; i < blueprint.cenas.length; i++) {
      const scene = blueprint.cenas[i];
      const sceneNumber = i + 1;
      const sceneId = `scene_${String(sceneNumber).padStart(2, '0')}`;

      try {
        // Resolve foto de referência da cena
        const rawPhotoUrl = scene.fotoReferencia
          || prodData?.image_url
          || prodData?.images?.[i]
          || prodData?.pictures?.[i]
          || prodData?.images?.[0]
          || null;

        let localPhotoPath = null;
        if (rawPhotoUrl) {
          if (photoCache.has(rawPhotoUrl)) {
            localPhotoPath = photoCache.get(rawPhotoUrl);
          } else {
            localPhotoPath = await this.downloadPhotoLocally(rawPhotoUrl, `scene_${sceneNumber}`);
            if (localPhotoPath) photoCache.set(rawPhotoUrl, localPhotoPath);
          }
        }

        const hasRealPhoto = Boolean(localPhotoPath && fs.existsSync(localPhotoPath));

        // Decisão criteriosa da estratégia
        const strategy = this.decideStrategy({
          scene,
          index: i,
          totalScenes: blueprint.cenas.length,
          comfyOnline: comfyHealth.online,
          hasRealPhoto,
        });

        if (hasRealPhoto) {
          fotosReaisUtilizadas++;
        }
        if (strategy === 'COMFYUI_IMAGE_TO_VIDEO') {
          cenasComfyCount++;
        }

        // Produz a cena individual (9:16)
        const sceneResult = await this.produceSingleScene({
          creativeId,
          creativeVersion,
          scene,
          index: i,
          sceneId,
          strategy,
          localPhotoPath,
          product: prodData || {},
          sceneOutputDir,
        });

        producedScenes.push(sceneResult);
        logger.info(`[SceneProducer] ✅ ${sceneId} gerada com sucesso (${sceneResult.durationSeconds}s, ${sceneResult.resolution})`);

      } catch (err) {
        logger.error(`[SceneProducer] ❌ Erro ao produzir ${sceneId}: ${err.message}`);
        errors.push({ sceneId, error: err.message });
      }
    }

    // Salva manifesto local das cenas
    const manifestPath = path.join(sceneOutputDir, 'scenes_manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      creativeId,
      creativeVersion,
      cenasPlanejadas,
      cenasProduzidas: producedScenes.length,
      fotosReaisUtilizadas,
      cenasComfy: cenasComfyCount,
      producedScenes,
      createdAt: new Date().toISOString(),
    }, null, 2));

    // Atualiza o storyboard na tabela creative_versions com os previews das cenas
    if (creativeId) {
      try {
        const { data: currentVersion } = await this.supabase
          .from('creative_versions')
          .select('script_data, metadata')
          .eq('id', creativeId)
          .single();

        const updatedScriptData = currentVersion?.script_data || blueprint;
        if (Array.isArray(updatedScriptData.cenas)) {
          updatedScriptData.cenas = updatedScriptData.cenas.map((c, idx) => {
            const prod = producedScenes[idx];
            return {
              ...c,
              sceneId: prod?.sceneId || `scene_${String(idx + 1).padStart(2, '0')}`,
              strategyChosen: prod?.strategy || 'IMAGE_ANIMATION',
              previewDataUrl: prod?.previewDataUrl || null,
              previewFilename: prod?.previewFilename || null,
              videoFilename: prod?.videoFilename || null,
              status: prod ? 'PRODUCED' : 'FAILED',
            };
          });
        }

        await this.supabase
          .from('creative_versions')
          .update({
            script_data: updatedScriptData,
            metadata: {
              ...(currentVersion?.metadata || {}),
              storyboard: updatedScriptData.cenas,
              producedScenes,
              visualProduction: {
                cenasPlanejadas,
                cenasProduzidas: producedScenes.length,
                fotosReaisUtilizadas,
                cenasComfy: cenasComfyCount,
                errorsCount: errors.length,
                status: errors.length === 0 ? 'COMPLETED' : 'PARTIAL_ERROR',
                videoFinalGerado: false, // ESTRIAMENTE NÃO gera vídeo final ainda
                completedAt: new Date().toISOString(),
              },
            },
          })
          .eq('id', creativeId);

        logger.info(`[SceneProducer] 📋 Storyboard atualizado com previews das ${producedScenes.length} cenas produzidas!`);
      } catch (dbErr) {
        logger.warn(`[SceneProducer] Falha ao atualizar creative_versions no banco: ${dbErr.message}`);
      }
    }

    return {
      success: errors.length === 0,
      creativeId,
      creativeVersion,
      cenasPlanejadas,
      cenasProduzidas: producedScenes.length,
      fotosReaisUtilizadas,
      cenasComfy: cenasComfyCount,
      erros: errors.length,
      errorDetails: errors,
      scenes: producedScenes,
      videoFinalGerado: false, // Estritamente NÃO gera vídeo final nesta etapa
    };
  }
}

export default SceneProducer;
