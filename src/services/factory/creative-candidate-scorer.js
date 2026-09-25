/**
 * ACHAki Autopilot — CreativeCandidateScorer
 *
 * Avalia previamente um produto antes de submeter à fábrica de criativos.
 * Evita desperdiçar GPU, tempo e recursos locais com ofertas fracas.
 *
 * Critérios:
 * - commercial_score: Preço, desconto comprovado, margem e atratividade
 * - growth_score: Potencial de clique e compartilhamento
 * - visual_score: Existência de imagem em boa resolução e apelo estético
 * - demand_score: Busca e intenção de compra recente no cluster
 * - value_score: Custo-benefício percebido
 * - confidence: Confiabilidade das informações (dados factuais verificados)
 */

export class CreativeCandidateScorer {
  /**
   * Avalia a elegibilidade e prioridade de produção de criativo para o produto.
   *
   * @param {object} params
   * @param {object} params.product
   * @param {object} [params.demandContext]
   * @param {number} [params.minThreshold=65]
   * @returns {{ eligible: boolean, score: number, priority: 'HIGH'|'NORMAL'|'LOW', breakdown: object, reason: string }}
   */
  static scoreCandidate({ product, demandContext = {}, minThreshold = 65 }) {
    let commercialScore = 50;
    let growthScore = 50;
    let visualScore = 50;
    let demandScore = demandContext.score || demandContext.demand_score || 50;
    let valueScore = 50;
    let confidenceScore = 60;

    const discount = Number(product.discount_percent || 0);
    const price = Number(product.current_price || product.price || 0);
    const reviewsCount = Number(product.reviews_count || product.review_count || 0);
    const rating = Number(product.rating || 0);

    // 1. Desconto comprovado
    if (discount >= 40) {
      commercialScore += 35;
      growthScore += 25;
    } else if (discount >= 20) {
      commercialScore += 20;
      growthScore += 15;
    } else if (discount > 0) {
      commercialScore += 10;
    } else {
      commercialScore -= 10;
    }

    // 2. Preço acessível para compra por impulso
    if (price > 0 && price <= 150) {
      commercialScore += 15;
      growthScore += 15;
      valueScore += 20;
    } else if (price > 150 && price <= 400) {
      commercialScore += 5;
      valueScore += 10;
    }

    // 3. Avaliação e Prova Social
    if (rating >= 4.5 && reviewsCount >= 50) {
      confidenceScore += 30;
      valueScore += 20;
    } else if (rating >= 4.0) {
      confidenceScore += 15;
      valueScore += 10;
    }

    // 4. Imagem Visual Disponível
    if (product.image_url && product.image_url.startsWith('http')) {
      visualScore += 35;
    } else {
      visualScore = 10; // Sem imagem inviabiliza criativo visual de alto impacto
    }

    // Limites 0 - 100
    commercialScore = Math.min(100, Math.max(0, commercialScore));
    growthScore = Math.min(100, Math.max(0, growthScore));
    visualScore = Math.min(100, Math.max(0, visualScore));
    demandScore = Math.min(100, Math.max(0, demandScore));
    valueScore = Math.min(100, Math.max(0, valueScore));
    confidenceScore = Math.min(100, Math.max(0, confidenceScore));

    // Pontuação Ponderada
    const totalScore = Math.round(
      commercialScore * 0.25 +
      visualScore * 0.25 +
      growthScore * 0.20 +
      demandScore * 0.15 +
      valueScore * 0.10 +
      confidenceScore * 0.05
    );

    const eligible = totalScore >= minThreshold && visualScore >= 50;

    let priority = 'NORMAL';
    if (totalScore >= 80 && demandScore >= 75) {
      priority = 'HIGH';
    } else if (totalScore < 70) {
      priority = 'LOW';
    }

    let reason = '';
    if (!eligible) {
      if (visualScore < 50) {
        reason = 'Produto sem imagem de qualidade para produção visual 9:16.';
      } else {
        reason = `Pontuação comercial insuficiente (${totalScore}/${minThreshold}). Descarte preventivo de GPU.`;
      }
    } else {
      reason = `Candidato de alta atratividade (Score: ${totalScore}/100, Desconto: ${discount}%, Demanda: ${demandScore}). Prioridade: ${priority}.`;
    }

    return {
      eligible,
      score: totalScore,
      priority,
      breakdown: {
        commercialScore,
        visualScore,
        growthScore,
        demandScore,
        valueScore,
        confidenceScore,
      },
      reason,
    };
  }
}

export default CreativeCandidateScorer;
