/**
 * ACHAki Autopilot — YouTubeMarketIntelligence
 *
 * Módulo de Inteligência de Mercado e Opinião Sincera:
 * 1. Pesquisa sugestões e buscas reais no YouTube Brasil (intenção de compra e reviews).
 * 2. Analisa sentimento da comunidade ("opinião sincera", "vale a pena", "teste real", "defeitos").
 * 3. Detecta red flags (vídeos com títulos negativos ou alertas de produto frágil/defeito).
 * 4. Fornece argumentos factuais para o CreativeDirector / Roteiro 9:16.
 */

import logger from '../../utils/logger.js';

export class YouTubeMarketIntelligence {
  constructor() {
    this.suggestEndpoint = 'https://suggestqueries.google.com/complete/search';
    this.ytSearchUrl = 'https://www.youtube.com/results';
  }

  /**
   * Limpa e simplifica o título do produto para consulta eficiente no YouTube.
   * Remove códigos técnicos excessivos e marcas d'água de texto.
   *
   * @param {string} fullTitle
   * @returns {string}
   */
  _extractCoreSearchTerm(fullTitle) {
    if (!fullTitle) return '';
    return fullTitle
      .replace(/\(.*?\)/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/(bivolt|110v|220v|original|frete gratis|full|promocao|novo|nf|envio rapido)/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 5)
      .join(' ');
  }

  /**
   * Consulta sugestões reais de busca no YouTube sobre o produto.
   *
   * @param {string} query
   * @returns {Promise<Array<string>>}
   */
  async getYouTubeSearchQueries(query) {
    if (!query) return [];
    try {
      const core = this._extractCoreSearchTerm(query);
      const url = `${this.suggestEndpoint}?client=chrome&ds=yt&hl=pt-BR&q=${encodeURIComponent(core)}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/javascript, */*',
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) return [];
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[1])) {
        return data[1].map((s) => String(s).toLowerCase().trim());
      }
      return [];
    } catch (e) {
      logger.warn(`[YouTubeIntelligence] Erro ao buscar sugestões: ${e.message}`);
      return [];
    }
  }

  /**
   * Consulta resultados públicos de busca no YouTube para estimar volume e sentimento.
   *
   * @param {string} searchTerm
   * @returns {Promise<Array<{ title: string, isNegative: boolean, isReview: boolean }>>}
   */
  async searchReviewVideos(searchTerm) {
    const core = this._extractCoreSearchTerm(searchTerm);
    if (!core) return [];

    try {
      const searchUrl = `${this.ytSearchUrl}?search_query=${encodeURIComponent(`${core} analise review vale a pena`)}`;
      const res = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'pt-BR,pt;q=0.9',
        },
        signal: AbortSignal.timeout(7000),
      });

      if (!res.ok) return [];
      const html = await res.text();

      // Extrai títulos dos primeiros vídeos renderizados no JSON inicial do YouTube
      const videoTitles = [];
      const titleMatches = html.match(/"title":\{"runs":\[\{"text":"(.*?)"\}\]/g) || [];

      const redFlagRegex = /nao compre|não compre|pessimo|péssimo|defeito|cuidado|golpe|propaganda enganosa|frágil|fragil|me arrependi|decepcao|decepção/i;
      const reviewRegex = /vale a pena|opinião sincera|opiniao sincera|teste real|review|unboxing|analise|análise|é bom|funciona mesmo/i;

      for (const m of titleMatches.slice(0, 15)) {
        const textMatch = m.match(/"text":"(.*?)"/);
        if (textMatch && textMatch[1]) {
          const title = textMatch[1].replace(/\\u[\dA-F]{4}/gi, '').trim();
          videoTitles.push({
            title,
            isNegative: redFlagRegex.test(title),
            isReview: reviewRegex.test(title),
          });
        }
      }

      return videoTitles;
    } catch (e) {
      logger.warn(`[YouTubeIntelligence] Erro ao buscar vídeos de review: ${e.message}`);
      return [];
    }
  }

  /**
   * Avalia a validação de mercado e opinião sincera para um produto.
   *
   * @param {object} product - Produto com title, category, etc.
   * @returns {Promise<{
   *   hasSocialValidation: boolean,
   *   socialInterestScore: number,
   *   sentiment: 'POSITIVO'|'NEUTRO'|'ALERTA_QUALIDADE',
   *   honestReviewQuotes: Array<string>,
   *   redFlagsDetected: boolean,
   *   suggestedSearchTerms: Array<string>
   * }>}
   */
  async evaluateProductOpinion(product) {
    const rawTitle = product.title || '';
    const coreTerm = this._extractCoreSearchTerm(rawTitle);

    const [suggestions, videos] = await Promise.all([
      this.getYouTubeSearchQueries(coreTerm),
      this.searchReviewVideos(rawTitle),
    ]);

    let negativeCount = 0;
    let reviewCount = 0;
    const honestQuotes = [];

    for (const v of videos) {
      if (v.isNegative) negativeCount++;
      if (v.isReview) {
        reviewCount++;
        honestQuotes.push(v.title);
      }
    }

    const hasRedFlags = negativeCount >= 2;
    const hasReviews = reviewCount > 0 || suggestions.length > 2;

    let sentiment = 'POSITIVO';
    let interestScore = 80;

    if (hasRedFlags) {
      sentiment = 'ALERTA_QUALIDADE';
      interestScore = 40;
    } else if (hasReviews) {
      sentiment = 'POSITIVO';
      interestScore = Math.min(95, 75 + reviewCount * 4 + suggestions.length * 2);
    } else {
      sentiment = 'NEUTRO';
      interestScore = 65;
    }

    return {
      hasSocialValidation: hasReviews && !hasRedFlags,
      socialInterestScore: interestScore,
      sentiment,
      honestReviewQuotes: honestQuotes.slice(0, 4),
      redFlagsDetected: hasRedFlags,
      suggestedSearchTerms: suggestions.slice(0, 5),
    };
  }
}

export default YouTubeMarketIntelligence;
