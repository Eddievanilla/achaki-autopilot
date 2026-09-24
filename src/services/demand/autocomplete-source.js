import BaseDemandSource from './base-source.js';

/**
 * Google Autocomplete Real Source (Brasil)
 * Endpoint: https://suggestqueries.google.com/complete/search?client=chrome&hl=pt-BR&q=...
 * Captures real-time consumer query expansions, popular variants and buying intent.
 */
export default class AutocompleteSource extends BaseDemandSource {
  constructor() {
    super('google_autocomplete');
    this.endpoint = 'https://suggestqueries.google.com/complete/search';
  }

  /**
   * Fetches real autocomplete suggestions for a seed query or candidate list.
   * @param {string} query 
   * @returns {Promise<Array<string>>}
   */
  async getSuggestions(query) {
    if (!query || typeof query !== 'string') return [];
    try {
      const url = `${this.endpoint}?client=chrome&hl=pt-BR&q=${encodeURIComponent(query.trim())}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/javascript, */*'
        },
        signal: AbortSignal.timeout(6000)
      });

      if (!res.ok) return [];
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[1])) {
        return data[1].map(s => String(s).toLowerCase().trim());
      }
      return [];
    } catch (err) {
      console.warn(`[AutocompleteSource] Falha na consulta de '${query}': ${err.message}`);
      return [];
    }
  }

  /**
   * Evaluates demand signal and expansions for a keyword or list of seed seeds.
   * @param {Object} options
   * @param {string[]} [options.seeds]
   */
  async fetchSignals(options = {}) {
    const seeds = options.seeds || [
      'parafusadeira',
      'fone bluetooth',
      'organizador cozinha',
      'air fryer',
      'garrafa termica',
      'suporte celular',
      'teclado mecanico',
      'smartwatch'
    ];

    const signals = [];

    for (const seed of seeds) {
      try {
        const suggestions = await this.getSuggestions(seed);
        if (!suggestions || suggestions.length === 0) continue;

        const intentModifiers = {
          COMPRA: /comprar|preco|valor|onde comprar|loja/i,
          DESCONTO: /promocao|oferta|desconto|barato|cupom|custo beneficio/i,
          COMPARACAO: /melhor|qual|comparativo|marca|vale a pena/i,
          KIT: /kit|jogo|combo|completo/i
        };

        let commercialMatches = 0;
        let detectedIntent = 'PESQUISA';

        for (const sug of suggestions) {
          if (intentModifiers.DESCONTO.test(sug)) {
            commercialMatches += 2;
            detectedIntent = 'DESCONTO';
          } else if (intentModifiers.COMPRA.test(sug)) {
            commercialMatches += 2;
            detectedIntent = 'COMPRA';
          } else if (intentModifiers.COMPARACAO.test(sug)) {
            commercialMatches += 1;
            if (detectedIntent === 'PESQUISA') detectedIntent = 'COMPARACAO';
          } else if (intentModifiers.KIT.test(sug)) {
            commercialMatches += 1;
          }
        }

        const depthRatio = Math.min(1, suggestions.length / 8);
        const commercialRatio = Math.min(1, commercialMatches / Math.max(1, suggestions.length));
        
        const rawScore = Math.round(50 + (depthRatio * 25) + (commercialRatio * 20));

        let trendDirection = 'ESTÁVEL';
        if (rawScore >= 80) trendDirection = 'ALTA';
        else if (rawScore >= 65) trendDirection = 'CRESCENDO';
        else if (rawScore < 50) trendDirection = 'BAIXA';

        signals.push({
          keyword: seed.toLowerCase(),
          source: this.name,
          raw_score: rawScore,
          trend_direction: trendDirection,
          detected_at: new Date().toISOString(),
          metadata: {
            suggestions_count: suggestions.length,
            sample_suggestions: suggestions.slice(0, 5),
            detected_intent: detectedIntent,
            commercial_affinity: commercialRatio
          }
        });
      } catch (err) {
        console.warn(`[AutocompleteSource] Erro processando seed ${seed}: ${err.message}`);
      }
    }

    return signals;
  }
}
