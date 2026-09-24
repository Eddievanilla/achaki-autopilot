import { createClient } from '@supabase/supabase-js';
import MediaAssetService from '../src/services/media-asset-service.js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

const mediaService = new MediaAssetService({ supabaseClient: supabase });

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // ─────────────────────────────────────────────────────────────
    // GET: Listar Criativos, Produtos e Estatísticas da Galeria
    // ─────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { type, productId, marketplace, status } = req.query;

      const assets = await mediaService.listCreativeAssets({
        type: type && type !== 'ALL' && type !== 'TODOS' ? type : undefined,
        productId: productId || undefined,
        marketplace: marketplace && marketplace !== 'ALL' ? marketplace : undefined,
        usageStatus: status || undefined,
      });

      // Lista resumida de produtos para o dropdown de filtro
      const { data: prodsData } = await supabase
        .from('products')
        .select('id, title, marketplace, category, product_url, image_url')
        .order('title', { ascending: true })
        .limit(100);

      const totalImages = assets.filter(a => a.type === 'IMAGE').length;
      const totalVideos = assets.filter(a => a.type === 'VIDEO').length;
      const totalUsed = assets.filter(a => a.usageCount > 0).length;
      const totalUnused = assets.filter(a => a.usageCount === 0).length;

      return res.status(200).json({
        success: true,
        assets,
        products: prodsData || [],
        stats: {
          totalAssets: assets.length,
          totalImages,
          totalVideos,
          totalUsed,
          totalUnused,
        },
      });
    }

    // ─────────────────────────────────────────────────────────────
    // POST: Sincronização e Operações com Assets
    // ─────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { action, productId, assetId } = req.body || {};

      if (action === 'sync_product') {
        if (!productId) {
          return res.status(400).json({ error: 'productId obrigatório' });
        }
        const { data: prod, error: pErr } = await supabase
          .from('products')
          .select('*')
          .eq('id', productId)
          .single();

        if (pErr || !prod) {
          return res.status(404).json({ error: 'Produto não encontrado' });
        }

        const syncResult = await mediaService.syncProductAssets(prod);
        return res.status(200).json(syncResult);
      }

      if (action === 'sync_all') {
        // Sincroniza até 10 produtos que ainda não possuem criativos
        const { data: prods } = await supabase
          .from('products')
          .select('*')
          .limit(15);

        const results = [];
        for (const p of (prods || [])) {
          try {
            const r = await mediaService.syncProductAssets(p);
            results.push(r);
          } catch (e) {
            results.push({ success: false, productId: p.id, error: e.message });
          }
        }
        return res.status(200).json({ success: true, count: results.length, results });
      }

      if (action === 'archive_asset') {
        if (!assetId) {
          return res.status(400).json({ error: 'assetId obrigatório' });
        }
        const { error } = await supabase
          .from('creative_assets')
          .update({ usage_status: 'ARCHIVED', updated_at: new Date().toISOString() })
          .eq('id', assetId);

        if (error) {
          return res.status(500).json({ error: error.message });
        }
        return res.status(200).json({ success: true, assetId, status: 'ARCHIVED' });
      }

      return res.status(400).json({ error: 'Ação não reconhecida' });
    }

    return res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno na API de criativos: ' + err.message });
  }
}
