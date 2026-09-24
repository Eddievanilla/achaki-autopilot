/**
 * ACHAki Autopilot — MediaAssetService
 *
 * Coleta, valida, armazena e deduplica mídias oficiais (imagens e vídeos)
 * dos produtos catalogados nos marketplaces.
 *
 * REGRAS DE SEGURANÇA E CONFORMIDADE:
 *  - Prioriza mídia oficial do marketplace (CDN oficial / dados estruturados).
 *  - NUNCA burla CAPTCHA.
 *  - NUNCA baixa conteúdo de usuários aleatórios ou concorrentes.
 *  - NUNCA remove marcas d'água.
 *  - Deduplicação estrita via SHA-256 (evita downloads e uploads duplicados).
 *  - Armazenamento permanente no Supabase Storage (bucket `creative-assets`).
 *  - Se não houver vídeo oficial: VIDEO_AVAILABLE = false (Zero fake video).
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { supabase } from '../database/supabase.js';
import logger from '../utils/logger.js';

export class MediaAssetService {
  /**
   * @param {object} [options]
   * @param {import('@supabase/supabase-js').SupabaseClient} [options.supabaseClient]
   * @param {string} [options.storageBucket='creative-assets']
   */
  constructor({ supabaseClient = supabase, storageBucket = 'creative-assets' } = {}) {
    this.supabase = supabaseClient;
    this.bucket = storageBucket;
  }

  /**
   * Procura automaticamente as mídias oficiais disponíveis para um produto.
   *
   * @param {object} product
   * @returns {Promise<Array<{
   *   type: 'IMAGE' | 'VIDEO',
   *   url: string,
   *   source: string,
   *   isPrimary: boolean,
   *   thumbnailUrl?: string,
   *   width?: number,
   *   height?: number,
   *   duration?: number
   * }>>}
   */
  async discoverProductMedia(product) {
    if (!product || (!product.image_url && !product.product_url)) {
      return [];
    }

    const discovered = [];
    const seenUrls = new Set();

    const addCandidate = ({ type, url, source, isPrimary = false, thumbnailUrl = null, width = null, height = null, duration = null }) => {
      if (!url || typeof url !== 'string' || !url.startsWith('http')) return;
      const cleanUrl = url.split('?')[0];
      if (seenUrls.has(cleanUrl)) return;
      seenUrls.add(cleanUrl);
      discovered.push({ type, url, source, isPrimary, thumbnailUrl, width, height, duration });
    };

    // 1. Imagem Principal Oficial já persistida no produto
    if (product.image_url) {
      addCandidate({
        type: 'IMAGE',
        url: product.image_url,
        source: 'MARKETPLACE',
        isPrimary: true,
      });
    }

    // 2. Extração via dados estruturados e galeria oficial
    if (product.product_url) {
      try {
        const res = await fetch(product.product_url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
          },
          signal: AbortSignal.timeout(8000),
        });

        if (res.ok) {
          const html = await res.text();

          // A) JSON-LD Structured Data
          const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
          let match;
          while ((match = jsonLdRegex.exec(html)) !== null) {
            try {
              const data = JSON.parse(match[1]);
              if (data.image) {
                const imgs = Array.isArray(data.image) ? data.image : [data.image];
                imgs.forEach(u => addCandidate({ type: 'IMAGE', url: u, source: 'MARKETPLACE' }));
              }
              if (data.video) {
                const vidUrl = typeof data.video === 'string' ? data.video : (data.video.contentUrl || data.video.url);
                if (vidUrl) {
                  addCandidate({
                    type: 'VIDEO',
                    url: vidUrl,
                    source: 'MARKETPLACE',
                    thumbnailUrl: data.video.thumbnailUrl || null,
                    duration: data.video.duration ? parseFloat(data.video.duration) : null,
                  });
                }
              }
            } catch {}
          }

          // B) Imagens de alta resolução no CDN Mercado Livre (D_NQ_NP_ ou D_Q_NP_)
          const mlImgRegex = /https:\/\/http2\.mlstatic\.com\/D_[A-Z0-9_]+-[A-Z0-9_-]+\.(?:webp|jpg|jpeg|png)/gi;
          const foundImgs = html.match(mlImgRegex) || [];
          for (const rawUrl of foundImgs) {
            // Normaliza para resolução máxima
            const highRes = rawUrl
              .replace(/\/D_NQ_NP_[0-9]+-/, '/D_NQ_NP_2X_')
              .replace(/\/D_Q_NP_[0-9]+-/, '/D_Q_NP_2X_');
            addCandidate({ type: 'IMAGE', url: highRes, source: 'LISTING_GALLERY' });
          }

          // C) Detecção de Vídeo Oficial (tag <video> ou link direto .mp4 / .webm)
          const videoRegex = /https?:\/\/[^\s"'<>]+\.(?:mp4|webm)/gi;
          const foundVids = html.match(videoRegex) || [];
          for (const vUrl of foundVids) {
            if (!vUrl.includes('ads') && !vUrl.includes('tracker') && !vUrl.includes('pixel')) {
              addCandidate({ type: 'VIDEO', url: vUrl, source: 'MARKETPLACE' });
            }
          }
        }
      } catch (err) {
        logger.warn(`[MediaAssetService] Busca secundária via HTTP para "${product.title}" finalizou com fallback: ${err.message}`);
      }
    }

    return discovered;
  }

  /**
   * Baixa, calcula checksum, deduplica e faz upload para o Supabase Storage.
   *
   * @param {object} product
   * @param {object} candidate
   * @returns {Promise<{ ok: boolean, asset?: object, isDuplicate?: boolean, error?: string }>}
   */
  async processAndStoreMedia(product, candidate) {
    if (!candidate || !candidate.url) {
      return { ok: false, error: 'URL da mídia ausente' };
    }

    try {
      // 1. Download do buffer
      const res = await fetch(candidate.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        return { ok: false, error: `Falha no download HTTP ${res.status}: ${candidate.url}` };
      }

      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      if (buffer.byteLength === 0) {
        return { ok: false, error: 'Arquivo com 0 bytes baixado' };
      }

      // 2. Cálculo do Checksum SHA-256 para deduplicação rigorosa
      const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

      // 3. Verificação de deduplicação no banco
      const { data: existingAsset } = await this.supabase
        .from('creative_assets')
        .select('*')
        .eq('product_id', product.id)
        .eq('checksum', checksum)
        .maybeSingle();

      if (existingAsset) {
        return { ok: true, asset: existingAsset, isDuplicate: true };
      }

      // 4. Detecção de MIME Type e Extensão
      let mimeType = res.headers.get('content-type') || (candidate.type === 'VIDEO' ? 'video/mp4' : 'image/webp');
      mimeType = mimeType.split(';')[0].trim().toLowerCase();

      let ext = 'webp';
      if (mimeType.includes('png')) ext = 'png';
      else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
      else if (mimeType.includes('mp4')) ext = 'mp4';
      else if (mimeType.includes('webm')) ext = 'webm';
      else if (mimeType.includes('gif')) ext = 'gif';

      const folderType = candidate.type === 'VIDEO' ? 'videos' : 'images';
      const mktId = product.marketplace_product_id ? product.marketplace_product_id.replace(/[^A-Za-z0-9_-]/g, '') : product.id;
      const storagePath = `mercadolivre/${mktId}/${folderType}/${checksum.slice(0, 16)}.${ext}`;

      // 5. Upload seguro para o Supabase Storage
      const { error: uploadError } = await this.supabase.storage
        .from(this.bucket)
        .upload(storagePath, buffer, {
          contentType: mimeType,
          upsert: true,
        });

      if (uploadError) {
        logger.error(`[MediaAssetService] Erro no upload para storage: ${uploadError.message}`);
        return { ok: false, error: `Erro no Supabase Storage: ${uploadError.message}` };
      }

      // 6. Resolução da URL pública permanente
      const { data: pubUrlData } = this.supabase.storage
        .from(this.bucket)
        .getPublicUrl(storagePath);

      const storageUrl = pubUrlData?.publicUrl || '';
      const thumbnailUrl = candidate.type === 'VIDEO' ? (candidate.thumbnailUrl || storageUrl) : storageUrl;

      // 7. Registro na tabela creative_assets
      const assetPayload = {
        product_id: product.id,
        marketplace: product.marketplace || 'mercadolivre',
        marketplace_product_id: product.marketplace_product_id || null,
        type: candidate.type,
        source_url: candidate.url,
        storage_url: storageUrl,
        thumbnail_url: thumbnailUrl,
        mime_type: mimeType,
        width: candidate.width || (candidate.type === 'IMAGE' ? 1200 : null),
        height: candidate.height || (candidate.type === 'IMAGE' ? 1200 : null),
        duration: candidate.duration || null,
        file_size: buffer.byteLength,
        checksum,
        source: candidate.source || 'MARKETPLACE',
        usage_status: 'AVAILABLE',
        metadata: {
          originalUrl: candidate.url,
          isPrimary: Boolean(candidate.isPrimary),
          storagePath,
          syncedAt: new Date().toISOString(),
        },
      };

      const { data: insertedAsset, error: insertError } = await this.supabase
        .from('creative_assets')
        .insert(assetPayload)
        .select()
        .single();

      if (insertError) {
        logger.error(`[MediaAssetService] Erro ao registrar creative_asset: ${insertError.message}`);
        return { ok: false, error: `Erro no banco: ${insertError.message}` };
      }

      logger.info(`[MediaAssetService] ✔ Asset salvo (${candidate.type}): ${storagePath} (${Math.round(buffer.byteLength / 1024)} KB)`);
      return { ok: true, asset: insertedAsset, isDuplicate: false };
    } catch (err) {
      logger.error(`[MediaAssetService] Exceção em processAndStoreMedia: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Sincroniza todas as mídias disponíveis para um produto.
   *
   * @param {object} product
   * @returns {Promise<{
   *   success: boolean,
   *   product: object,
   *   assets: Array<object>,
   *   totalImages: number,
   *   totalVideos: number,
   *   videoAvailable: boolean,
   *   newStoredCount: number,
   *   duplicateCount: number
   * }>}
   */
  async syncProductAssets(product) {
    if (!product || !product.id) {
      throw new Error('Produto inválido para syncProductAssets');
    }

    logger.info(`[MediaAssetService] Iniciando sincronização de mídias para "${product.title}" (${product.id})...`);

    const candidates = await this.discoverProductMedia(product);
    const storedAssets = [];
    let newStoredCount = 0;
    let duplicateCount = 0;

    for (const cand of candidates) {
      const res = await this.processAndStoreMedia(product, cand);
      if (res.ok && res.asset) {
        storedAssets.push(res.asset);
        if (res.isDuplicate) duplicateCount++;
        else newStoredCount++;
      }
    }

    const totalImages = storedAssets.filter(a => a.type === 'IMAGE').length;
    const totalVideos = storedAssets.filter(a => a.type === 'VIDEO').length;
    const videoAvailable = totalVideos > 0;

    logger.info(`[MediaAssetService] Sincronização concluída: ${totalImages} imagens, ${totalVideos} vídeos (${newStoredCount} novos, ${duplicateCount} já existentes).`);

    return {
      success: true,
      product: { id: product.id, title: product.title },
      assets: storedAssets,
      totalImages,
      totalVideos,
      videoAvailable,
      newStoredCount,
      duplicateCount,
    };
  }

  /**
   * Lista todos os criativos armazenados com dados do produto e métricas agregadas.
   *
   * @param {object} [filter]
   * @returns {Promise<Array<object>>}
   */
  async listCreativeAssets(filter = {}) {
    let query = this.supabase
      .from('creative_assets')
      .select(`
        id,
        product_id,
        marketplace,
        marketplace_product_id,
        type,
        source_url,
        storage_url,
        thumbnail_url,
        mime_type,
        width,
        height,
        duration,
        file_size,
        checksum,
        source,
        usage_status,
        metadata,
        created_at,
        products (
          id,
          title,
          category,
          marketplace,
          product_url
        ),
        creative_usage (
          id,
          format,
          channel,
          commercial_angle,
          used_at
        ),
        creative_performance (
          impressions,
          clicks,
          ctr,
          conversions,
          shares
        )
      `)
      .order('created_at', { ascending: false });

    if (filter.type) {
      query = query.eq('type', filter.type);
    }
    if (filter.productId) {
      query = query.eq('product_id', filter.productId);
    }
    if (filter.marketplace) {
      query = query.eq('marketplace', filter.marketplace);
    }
    if (filter.usageStatus) {
      query = query.eq('usage_status', filter.usageStatus);
    }

    const { data, error } = await query;
    if (error) {
      logger.error(`[MediaAssetService] Erro ao listar criativos: ${error.message}`);
      return [];
    }

    return (data || []).map(a => {
      const usageCount = a.creative_usage ? a.creative_usage.length : 0;
      let totalClicks = 0;
      let totalImpressions = 0;
      let totalConversions = 0;

      if (Array.isArray(a.creative_performance)) {
        a.creative_performance.forEach(p => {
          totalClicks += (p.clicks || 0);
          totalImpressions += (p.impressions || 0);
          totalConversions += (p.conversions || 0);
        });
      }

      const ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(1) + '%' : 'N/D';

      return {
        ...a,
        productTitle: a.products?.title || 'Produto sem título',
        productCategory: a.products?.category || 'Geral',
        usageCount,
        publicationCount: usageCount,
        totalClicks,
        totalImpressions,
        ctr,
        totalConversions,
      };
    });
  }
}

export default MediaAssetService;
