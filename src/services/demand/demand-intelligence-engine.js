import GoogleTrendsSource from './google-trends-source.js';
import AutocompleteSource from './autocomplete-source.js';
import MarketplaceDiscoverySource from './marketplace-discovery-source.js';
import InternalHistorySource from './internal-history-source.js';

/**
 * DemandIntelligenceEngine
 * 
 * Responsável por:
 * 1. Coletar sinais reais de demanda em múltiplos provedores;
 * 2. Normalizar palavras-chave;
 * 3. Agrupar termos semanticamente relacionados;
 * 4. Identificar intenção comercial (COMPRA, PESQUISA, DESCONTO, COMPARAÇÃO);
 * 5. Medir crescimento/recorrência com pontuação objetiva;
 * 6. Produzir oportunidades de pesquisa reais.
 */
export default class DemandIntelligenceEngine {
  constructor() {
    this.sources = [
      new GoogleTrendsSource(),
      new AutocompleteSource(),
      new MarketplaceDiscoverySource(),
      new InternalHistorySource()
    ];
    this.autocompleteSource = this.sources.find(s => s.name === 'google_autocomplete');
    this.internalHistorySource = this.sources.find(s => s.name === 'achaki_internal_history');
    this.marketplaceDiscoverySource = this.sources.find(s => s.name === 'ml_domain_discovery');
  }

  normalizeKeyword(raw) {
    if (!raw) return '';
    return raw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s\-\/]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  buildSemanticCluster(keyword, expansions = []) {
    const norm = this.normalizeKeyword(keyword);
    const cluster = {
      primary: keyword,
      normalized: norm,
      variants: [keyword],
      category_affinity: 'GERAL',
      related_terms: []
    };

    const clusterTaxonomy = {
      ferramentas: {
        matches: ['parafusadeira', 'furadeira', 'chave de impacto', 'serra', 'trena', 'esmerilhadeira', 'ferramenta'],
        related: ['kit parafusadeira', 'furadeira e parafusadeira', 'bateria 12v 20v', 'jogos de brocas']
      },
      cozinha_utilidades: {
        matches: ['organizador', 'air fryer', 'fritadeira', 'garrafa termica', 'panela eletrica', 'liquidificador', 'pote hermetico'],
        related: ['organizador cozinha', 'acessorios cozinha', 'armario organizador', 'porta temperos']
      },
      audio_eletronicos: {
        matches: ['fone', 'bluetooth', 'headphone', 'headset', 'caixa de som', 'smartwatch', 'relogio inteligente'],
        related: ['fone sem fio', 'fone bluetooth cancelamento ruido', 'fone esportivo', 'tws']
      },
      setup_informatica: {
        matches: ['teclado', 'mouse', 'suporte', 'monitor', 'hub usb', 'webcam', 'gamer'],
        related: ['teclado mecanico', 'suporte articulado notebook', 'mouse sem fio', 'mousepad']
      }
    };

    for (const [cat, data] of Object.entries(clusterTaxonomy)) {
      if (data.matches.some(m => norm.includes(m))) {
        cluster.category_affinity = cat;
        cluster.related_terms = data.related;
        break;
      }
    }

    for (const exp of expansions) {
      if (!cluster.variants.includes(exp) && exp !== keyword) {
        cluster.variants.push(exp);
      }
    }

    return cluster;
  }

  identifyIntent(keyword, suggestions = []) {
    const textCorpus = [keyword, ...suggestions].join(' ').toLowerCase();

    if (/comprar|preco|valor|onde comprar|loja|entrega rapida|full/i.test(textCorpus)) {
      return 'COMPRA';
    }
    if (/promocao|oferta|desconto|barato|cupom|custo beneficio|queima de estoque/i.test(textCorpus)) {
      return 'DESCONTO';
    }
    if (/melhor|qual|comparativo|marca|vale a pena|review|teste/i.test(textCorpus)) {
      return 'COMPARACAO';
    }
    return 'PESQUISA';
  }

  async scanDemand(options = {}) {
    console.log('[DemandIntelligenceEngine] 🔍 Iniciando monitoramento de demanda real...');
    const allSignals = [];

    await Promise.all(
      this.sources.map(async (src) => {
        try {
          const sigs = await src.fetchSignals(options);
          console.log(`[DemandIntelligenceEngine] Provedor '${src.name}' forneceu ${sigs.length} sinais.`);
          allSignals.push(...sigs);
        } catch (err) {
          console.warn(`[DemandIntelligenceEngine] Provedor '${src.name}' falhou: ${err.message}`);
        }
      })
    );

    if (allSignals.length === 0) {
      console.warn('[DemandIntelligenceEngine] Nenhum sinal capturado pelas fontes ativas.');
      return [];
    }

    const aggregated = new Map();

    for (const s of allSignals) {
      const norm = this.normalizeKeyword(s.keyword);
      if (!norm) continue;

      if (!aggregated.has(norm)) {
        aggregated.set(norm, {
          keyword: s.keyword,
          normalized: norm,
          scores: [],
          trends: [],
          sources: new Set(),
          suggestions: [],
          detected_at: s.detected_at,
          domain_info: null
        });
      }

      const entry = aggregated.get(norm);
      entry.scores.push(s.raw_score || 50);
      entry.trends.push(s.trend_direction);
      entry.sources.add(s.source);

      if (s.metadata?.sample_suggestions) {
        entry.suggestions.push(...s.metadata.sample_suggestions);
      }
      if (s.metadata?.domain_name) {
        entry.domain_info = s.metadata;
      }
    }

    const opportunities = [];

    for (const [norm, data] of aggregated.entries()) {
      const avgScore = Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length);
      const sourceCount = data.sources.size;
      const confidence = Math.min(1.0, 0.4 + (sourceCount * 0.2) + (data.suggestions.length > 0 ? 0.2 : 0));
      const demandScore = Math.min(100, Math.round(avgScore * (0.8 + 0.2 * confidence)));

      let trendDirection = 'UNKNOWN';
      if (data.trends.includes('ALTA')) {
        trendDirection = 'ALTA';
      } else if (data.trends.includes('CRESCENDO')) {
        trendDirection = 'CRESCENDO';
      } else if (data.trends.includes('ESTÁVEL')) {
        trendDirection = 'ESTÁVEL';
      } else if (data.trends.includes('BAIXA')) {
        trendDirection = 'BAIXA';
      }

      const cluster = this.buildSemanticCluster(data.keyword, data.suggestions);
      const intent = this.identifyIntent(data.keyword, data.suggestions);

      opportunities.push({
        keyword: data.keyword,
        cluster,
        intent,
        demand_score: demandScore,
        trend_direction: trendDirection,
        source: Array.from(data.sources).join(' + '),
        detected_at: data.detected_at || new Date().toISOString(),
        confidence: Number(confidence.toFixed(2)),
        category: cluster.category_affinity,
        domain_info: data.domain_info
      });
    }

    opportunities.sort((a, b) => b.demand_score - a.demand_score);

    console.log(`[DemandIntelligenceEngine] Total de ${opportunities.length} oportunidades de demanda consolidadas.`);
    return opportunities;
  }
}
