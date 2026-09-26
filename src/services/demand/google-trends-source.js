import BaseDemandSource from './base-source.js';

/**
 * Google Trends RSS Real Source (Brasil)
 * Endpoint: https://trends.google.com/trending/rss?geo=BR
 * Provides real consumer/commercial trending searches in Brazil.
 */
export default class GoogleTrendsSource extends BaseDemandSource {
  constructor() {
    super('google_trends_br');
    this.rssUrl = 'https://trends.google.com/trending/rss?geo=BR';
  }

  async fetchSignals(options = {}) {
    const signals = [];
    try {
      const response = await fetch(this.rssUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/xml, text/xml, */*'
        },
        signal: AbortSignal.timeout(8000)
      });

      if (!response.ok) {
        console.warn(`[GoogleTrendsSource] Falha ao acessar RSS (${response.status})`);
        return signals;
      }

      const xmlText = await response.text();
      const items = xmlText.match(/<item>([\s\S]*?)<\/item>/g) || [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
        const approxTrafficMatch = item.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/);
        const pubDateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

        if (!titleMatch) continue;

        let title = titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim();
        let traffic = approxTrafficMatch ? approxTrafficMatch[1].replace(/[^0-9]/g, '') : null;
        let trafficNum = traffic ? parseInt(traffic, 10) : 0;

        const nonCommercialRegex = /jogo|futebol|gol|escalação|escalacao|campeonato|copa|tabela|placar|eliminação|eliminacao|paredão|paredao|bbb|novela|polícia|policia|acidente|falecimento|morre|luto|morte|crime|preso|f1|fórmula 1|formula 1|gp |ufc|mma|lutador|basquete|nba|volei|tenis|flamengo|palmeiras|corinthians|sao paulo|santos|gremio|internacional|vasco|atletico|cruzeiro|botafogo|fluminense|real madrid|barcelona|champions|quina|megasena|mega-sena|mega sena|lotofacil|lotomania|duplasena|timemania|sorteio|aposta|bet|cassino|tigrinho|blaze|fortune tiger|after|filme|serie|netflix|trailer|elenco|estreia|cinema|ator|atriz|cantor|cantora|musica|música|album|show|turne|carnaval|fofoca|separação|divorcio|namoro|traição|reality|fazenda|eleição|eleicao|lula|bolsonaro|governo|stf|senado|câmara|camara|prefeito|vereador|votação|votacao|urna|g1|uol|cnn|notícia|noticia|clima|previsão|previsao|chuva|ciclone|terremoto|calor|frio|temperatura|enem|sisu|prouni|concurso|inss|feriado|\b\d{4}\b/i;

        const commercialRegex = /comprar|preco|preço|promocao|promoção|oferta|desconto|barato|barata|custo beneficio|custo-beneficio|vale a pena|review|unboxing|fone|headset|headphone|earbud|airpods|bluetooth|caixa de som|alexa|soundbar|smartwatch|relogio|relógio|pulseira|teclado|mouse|mousepad|monitor|suporte|hub usb|webcam|gamer|carregador|cabo usb|power bank|bateria portatil|celular|smartphone|iphone|samsung|xiaomi|motorola|tablet|ipad|notebook|air fryer|fritadeira|liquidificador|batedeira|cafeteira|panela|garrafa|copo stanley|pote hermetico|organizador|mop|aspirador|parafusadeira|furadeira|chave|jogo de ferramentas|trena|esmerilhadeira|compressor|secador|chapinha|barbeador|aparador|perfume|tenis|tênis|mochila|bolsa|calca|calça|luminaria|luminária|ring light|camera|câmera/i;

        // Rejeita notícias, esportes, loterias ou termos sem contexto comercial de produto
        if (nonCommercialRegex.test(title) || !commercialRegex.test(title)) {
          continue;
        }

        const rawScore = Math.max(60, Math.min(95, 95 - (i * 2)));

        signals.push({
          keyword: title.toLowerCase(),
          source: this.name,
          raw_score: rawScore,
          trend_direction: 'ALTA',
          detected_at: new Date().toISOString(),
          metadata: {
            approx_traffic: trafficNum || null,
            pub_date: pubDateMatch ? pubDateMatch[1] : null,
            rank: i + 1
          }
        });
      }
    } catch (err) {
      console.warn(`[GoogleTrendsSource] Erro ao obter sinais de tendências: ${err.message}`);
    }

    return signals;
  }
}
