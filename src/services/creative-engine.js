/**
 * ACHAki Autopilot — CreativeEngine
 *
 * Motor de Conteúdo Orgânico para Facebook:
 *  - Elabora textos curtos, naturais e comerciais
 *  - Usa dados estritamente REAIS do produto (sem inventar estoque, descontos ou benefícios)
 *  - CTA aponta obrigatoriamente para a tracking_url
 */

export class CreativeEngine {
  /**
   * Gera o conteúdo formatado para publicação no Facebook.
   *
   * @param {object} params
   * @param {string} params.title - Título real do produto
   * @param {number} params.currentPrice - Preço atual validado
   * @param {number} [params.originalPrice] - Preço original (se houver)
   * @param {number} [params.discountPercent] - Desconto percentual validado
   * @param {string} params.imageUrl - URL real da imagem do produto
   * @param {string} params.trackingUrl - Link rastreável ACHAki
   * @param {object} [params.strategy] - Estratégia orgânica atribuída
   * @param {string} [params.category] - Categoria do produto
   * @returns {{
   *   headline: string,
   *   text: string,
   *   imageUrl: string,
   *   trackingUrl: string,
   *   strategyCode: string
   * }}
   */
  generatePost({
    title,
    currentPrice,
    originalPrice,
    discountPercent = 0,
    imageUrl,
    affiliateUrl,
    trackingUrl,
    strategy = {},
    category = 'utilidades',
  }) {
    const priceFormatted = `R$ ${Number(currentPrice).toFixed(2).replace('.', ',')}`;
    const stratCode = strategy.code || 'DESCONTO';
    
    // Ganchos determinísticos e naturais de acordo com a estratégia real
    let hook = 'Olha esse achadinho que encontrei!';
    if (stratCode === 'PRECO') {
      hook = `Muito barato por ${priceFormatted}! Ideal para quem quer economizar.`;
    } else if (stratCode === 'DESCONTO' && discountPercent > 0) {
      hook = `Oportunidade com ${discountPercent}% de desconto hoje! De R$ ${Number(originalPrice).toFixed(2).replace('.', ',')} por apenas ${priceFormatted}.`;
    } else if (stratCode === 'PROBLEMA_SOLUCAO') {
      hook = `Solução muito prática para o dia a dia na sua casa:`;
    } else if (stratCode === 'ACHADINHO') {
      hook = `Garimpo de hoje com excelente custo-benefício:`;
    }

    // Prioriza link oficial direto (ex: https://meli.la/...) no primeiro piloto
    const directLink = (affiliateUrl && (affiliateUrl.includes('meli.la') || affiliateUrl.includes('mercadolivre.com')))
      ? affiliateUrl
      : (trackingUrl || affiliateUrl);

    // Texto curto, natural e sem spam
    const textLines = [
      hook,
      '',
      `📦 ${title}`,
      `💰 Por apenas: ${priceFormatted}${discountPercent > 0 ? ` (${discountPercent}% OFF)` : ''}`,
      '',
      `👉 Veja todos os detalhes e garanta o seu aqui:`,
      directLink,
    ];

    return {
      headline: title.length > 60 ? title.substring(0, 57) + '...' : title,
      text: textLines.join('\n'),
      imageUrl,
      trackingUrl,
      affiliateUrl: directLink,
      strategyCode: stratCode,
    };
  }
}

export default CreativeEngine;
