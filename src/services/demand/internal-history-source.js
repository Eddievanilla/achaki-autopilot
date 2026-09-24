import BaseDemandSource from './base-source.js';
import { supabase } from '../../database/supabase.js';

/**
 * Internal History Demand & Performance Source
 * Uses real ACHAki database data to extract performance patterns,
 * verify keyword/product cooldowns, and prevent saturation.
 */
export default class InternalHistorySource extends BaseDemandSource {
  constructor() {
    super('achaki_internal_history');
  }

  async fetchSignals(options = {}) {
    const signals = [];
    if (!supabase) return signals;

    try {
      const { data: metrics, error } = await supabase
        .from('publication_metrics')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error || !metrics || metrics.length === 0) {
        return signals;
      }

      const aggregated = {};
      for (const m of metrics) {
        const key = (m.keyword || m.product_name || 'geral').toLowerCase().trim();
        if (!aggregated[key]) {
          aggregated[key] = {
            count: 0,
            clicks: 0,
            impressions: 0,
            last_published: m.created_at
          };
        }
        aggregated[key].count += 1;
        aggregated[key].clicks += (m.clicks || 0);
        aggregated[key].impressions += (m.impressions || 0);
      }

      for (const [key, stat] of Object.entries(aggregated)) {
        if (stat.count >= 2) {
          const ctr = stat.impressions > 0 ? (stat.clicks / stat.impressions) : 0;
          let trend = 'ESTÁVEL';
          let score = 65;

          if (ctr > 0.05 || stat.clicks >= 10) {
            trend = 'ALTA';
            score = 85;
          } else if (stat.clicks === 0) {
            trend = 'BAIXA';
            score = 45;
          }

          signals.push({
            keyword: key,
            source: this.name,
            raw_score: score,
            trend_direction: trend,
            detected_at: new Date().toISOString(),
            metadata: {
              total_publications: stat.count,
              total_clicks: stat.clicks,
              ctr: Number(ctr.toFixed(4)),
              last_published: stat.last_published
            }
          });
        }
      }
    } catch (err) {
      console.warn(`[InternalHistorySource] Erro ao consultar histórico interno: ${err.message}`);
    }

    return signals;
  }

  async checkCooldown({ product_title, keyword, category }) {
    if (!supabase) return { allowed: true };

    try {
      const eighteenHoursAgo = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString();
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: recents } = await supabase
        .from('publication_metrics')
        .select('*')
        .gte('created_at', eighteenHoursAgo);

      if (!recents || recents.length === 0) {
        return { allowed: true };
      }

      // 1. Same keyword cooldown
      if (keyword) {
        const normKw = keyword.toLowerCase().trim();
        const hitKw = recents.find(r => r.keyword && r.keyword.toLowerCase().trim() === normKw);
        if (hitKw) {
          return {
            allowed: false,
            reason: `Cooldown ativo: palavra-chave '${keyword}' publicada recentemente (${new Date(hitKw.created_at).toLocaleTimeString()}).`
          };
        }
      }

      // 2. Same product cooldown
      if (product_title) {
        const normTitle = product_title.toLowerCase().trim();
        const hitProd = recents.find(r => r.product_name && r.product_name.toLowerCase().trim() === normTitle);
        if (hitProd) {
          return {
            allowed: false,
            reason: `Cooldown ativo: produto '${product_title.slice(0, 30)}...' publicado recentemente.`
          };
        }
      }

      // 3. Category saturation (max 2 per 24 hours)
      if (category) {
        const normCat = category.toLowerCase().trim();
        const { data: catRecents } = await supabase
          .from('publication_metrics')
          .select('id, category')
          .gte('created_at', twentyFourHoursAgo)
          .ilike('category', `%${normCat}%`);

        if (catRecents && catRecents.length >= 2) {
          return {
            allowed: false,
            reason: `Saturação de categoria: '${category}' atingiu o limite de 2 publicações em 24h.`
          };
        }
      }

      return { allowed: true };
    } catch (err) {
      console.warn(`[InternalHistorySource] Erro ao verificar cooldown: ${err.message}`);
      return { allowed: true };
    }
  }
}
