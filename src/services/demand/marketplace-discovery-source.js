import BaseDemandSource from './base-source.js';

/**
 * Mercado Livre Domain Discovery Real Source
 * Endpoint: https://api.mercadolibre.com/sites/MLB/domain_discovery/search?q=...
 * Maps search terms to official marketplace domains, category hierarchy and catalog certainty.
 */
export default class MarketplaceDiscoverySource extends BaseDemandSource {
  constructor() {
    super('ml_domain_discovery');
    this.endpoint = 'https://api.mercadolibre.com/sites/MLB/domain_discovery/search';
  }

  async discoverDomain(query) {
    if (!query) return null;
    try {
      const url = `${this.endpoint}?q=${encodeURIComponent(query.trim())}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(6000)
      });

      if (!res.ok) return null;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data[0];
      }
      return null;
    } catch (err) {
      console.warn(`[MarketplaceDiscoverySource] Erro ao consultar domínio para '${query}': ${err.message}`);
      return null;
    }
  }

  async fetchSignals(options = {}) {
    const candidates = options.candidates || [
      'parafusadeira',
      'fone bluetooth',
      'organizador cozinha',
      'air fryer'
    ];

    const signals = [];

    for (const cand of candidates) {
      try {
        const domainData = await this.discoverDomain(cand);
        if (!domainData) continue;

        const categoryPath = (domainData.category_path || []).map(c => c.name).join(' > ');
        
        signals.push({
          keyword: cand.toLowerCase(),
          source: this.name,
          raw_score: 80,
          trend_direction: 'ESTÁVEL',
          detected_at: new Date().toISOString(),
          metadata: {
            domain_id: domainData.domain_id,
            domain_name: domainData.domain_name,
            category_id: domainData.category_id,
            category_name: domainData.category_name,
            category_path: categoryPath
          }
        });
      } catch (err) {
        console.warn(`[MarketplaceDiscoverySource] Erro processando candidato ${cand}: ${err.message}`);
      }
    }

    return signals;
  }
}
