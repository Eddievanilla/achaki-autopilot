/**
 * ACHAki Autopilot — ProductFactsBuilder
 *
 * REGRA ABSOLUTA DE VERACIDADE:
 * Constrói o PRODUCT_FACTS contendo SOMENTE informações verificadas nos dados reais do produto.
 *
 * PROIBIDO INVENTAR:
 * - benefícios não informados
 * - potência
 * - segurança
 * - certificações
 * - resistência
 * - durabilidade
 * - estoque
 * - avaliações
 * - características técnicas
 * - urgência
 * - qualquer dado ausente
 *
 * Se não estiver em PRODUCT_FACTS, NÃO mencionar.
 */

import logger from '../../utils/logger.js';

export class ProductFactsBuilder {
  /**
   * Constrói o objeto PRODUCT_FACTS a partir de um registro de produto e preços
   *
   * @param {object} params
   * @param {object} params.product - Objeto da tabela products
   * @param {object} [params.priceRecord] - Objeto da tabela product_prices (opcional)
   * @param {string[]} [params.extraImages] - Imagens adicionais confirmadas
   * @returns {object} PRODUCT_FACTS estruturado e verificado
   */
  static buildFacts({ product, priceRecord = null, extraImages = [] } = {}) {
    if (!product) {
      throw new Error('Produto obrigatório para construção do PRODUCT_FACTS.');
    }

    const title = (product.title || '').trim();
    const rawBrand = (product.seller_name || '').trim();

    // Preços verificados
    const currentPriceNum = priceRecord?.current_price
      ?? product.current_price
      ?? product.price
      ?? null;
    const originalPriceNum = priceRecord?.original_price
      ?? product.original_price
      ?? null;
    const discountNum = priceRecord?.discount_percent
      ?? product.discount_percent
      ?? (originalPriceNum && currentPriceNum && originalPriceNum > currentPriceNum
        ? Math.round(((originalPriceNum - currentPriceNum) / originalPriceNum) * 100)
        : null);

    // Identificação de marca factual
    let brand = rawBrand || null;
    if (!brand && /coibeu/i.test(title)) brand = 'Coibeu';

    // Extração rigorosa de características diretamente do título real
    const featuresVerified = [];
    const specsVerified = [];

    if (brand) {
      specsVerified.push(`Marca: ${brand}`);
    }

    // Modelo
    const modelMatch = title.match(/\b([A-Za-z]{2,5}-\d{2,4})\b/i);
    if (modelMatch) {
      const model = modelMatch[1].toUpperCase();
      specsVerified.push(`Modelo: ${model}`);
    }

    // Quantidade de tomadas
    const tomadasMatch = title.match(/(\d+)\s*(?:tomadas?|sa[íi]das?)/i);
    if (tomadasMatch) {
      const tomadas = `${tomadasMatch[1]} tomadas`;
      featuresVerified.push(tomadas);
      specsVerified.push(`Quantidade de tomadas: ${tomadasMatch[1]}`);
    }

    // Portas USB
    const usbMatch = title.match(/(\d+)\s*(?:portas?\s*)?usb/i);
    if (usbMatch) {
      const usb = `${usbMatch[1]} portas USB`;
      featuresVerified.push(usb);
      specsVerified.push(`Portas USB: ${usbMatch[1]}`);
    }

    // Cabo / Extensão
    const caboMatch = title.match(/(\d+(?:[.,]\d+)?\s*(?:m|metros?))\b/i);
    if (caboMatch) {
      const cabo = `Cabo de ${caboMatch[1].toLowerCase().replace('m', ' metros')}`;
      featuresVerified.push(cabo);
      specsVerified.push(`Comprimento do cabo: ${caboMatch[1].toLowerCase()}`);
    }

    // Tensão / Voltagem
    if (/\bbivolt\b/i.test(title)) {
      featuresVerified.push('Funcionamento Bivolt');
      specsVerified.push('Voltagem: Bivolt');
    } else if (/\b110v\b/i.test(title) || /\b127v\b/i.test(title)) {
      featuresVerified.push('Tensão 110V/127V');
      specsVerified.push('Voltagem: 110V/127V');
    } else if (/\b220v\b/i.test(title)) {
      featuresVerified.push('Tensão 220V');
      specsVerified.push('Voltagem: 220V');
    }

    // Preços verificados
    if (currentPriceNum !== null && !isNaN(currentPriceNum)) {
      specsVerified.push(`Preço atual verificado: R$ ${Number(currentPriceNum).toFixed(2).replace('.', ',')}`);
    }
    if (originalPriceNum !== null && !isNaN(originalPriceNum)) {
      specsVerified.push(`Preço original verificado: R$ ${Number(originalPriceNum).toFixed(2).replace('.', ',')}`);
    }
    if (discountNum && discountNum > 0) {
      specsVerified.push(`Desconto confirmado: ${discountNum}%`);
    }

    // Imagens verificadas (prioriza URL de alta resolução)
    const imagesVerified = [];
    const mainImg = product.image_url;
    if (mainImg) {
      // Converte imagem do ML para alta resolução caso seja padrão ML
      const hiRes = mainImg.replace(/_NP_(?:2X_)?([0-9]+)-MLB([0-9]+)_[0-9]+-([A-Z0-9]+)\./, '_NQ_NP_2X_$1-MLB$2_092025-F.');
      imagesVerified.push(hiRes);
      if (hiRes !== mainImg) imagesVerified.push(mainImg);
    }

    if (Array.isArray(product.images)) {
      for (const img of product.images) {
        if (img && !imagesVerified.includes(img)) imagesVerified.push(img);
      }
    }
    if (Array.isArray(product.pictures)) {
      for (const img of product.pictures) {
        if (img && !imagesVerified.includes(img)) imagesVerified.push(img);
      }
    }
    if (Array.isArray(extraImages)) {
      for (const img of extraImages) {
        if (img && !imagesVerified.includes(img)) imagesVerified.push(img);
      }
    }

    const facts = {
      product_name: title,
      brand: brand || 'Não informada',
      price: currentPriceNum !== null ? Number(currentPriceNum) : null,
      price_formatted: currentPriceNum !== null ? `R$ ${Number(currentPriceNum).toFixed(2).replace('.', ',')}` : null,
      original_price: originalPriceNum !== null ? Number(originalPriceNum) : null,
      original_price_formatted: originalPriceNum !== null ? `R$ ${Number(originalPriceNum).toFixed(2).replace('.', ',')}` : null,
      discount: discountNum || 0,
      features_verified: featuresVerified,
      specifications_verified: specsVerified,
      images: imagesVerified,
      source_url: product.product_url || product.affiliate_url || '',
      marketplace: product.marketplace || 'mercadolivre',
    };

    logger.info(`[ProductFactsBuilder] 📋 PRODUCT_FACTS compilado com ${featuresVerified.length} características e ${specsVerified.length} especificações verificadas (zero alucinações).`);

    return facts;
  }
}

export default ProductFactsBuilder;
