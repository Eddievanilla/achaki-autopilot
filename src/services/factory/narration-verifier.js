/**
 * ACHAki Autopilot — NarrationVerifier
 *
 * REGRA ABSOLUTA DE VERACIDADE:
 * Valida cada frase da narração contra o PRODUCT_FACTS antes do envio ao TTS.
 *
 * Frase não suportada por evidências factuais = REJEITAR.
 * Não enviar frases rejeitadas ao TTS.
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
 * - características técnicas não listadas
 * - urgência artificial
 * - qualquer dado ausente
 */

import logger from '../../utils/logger.js';

export class NarrationVerifier {
  /**
   * Padrões estritamente proibidos de alucinação quando não constam no PRODUCT_FACTS
   */
  static FORBIDDEN_HALLUCINATION_PATTERNS = [
    {
      type: 'RESISTENCIA_DURABILIDADE',
      pattern: /\b(super\s+resistente|alta\s+durabilidade|dur[aá]vel|resist[eê]ncia|aguentar\s+o\s+uso|inquebr[aá]vel|refor[çc]ad[oa]|indestrut[ií]vel|acabamento\s+resistente)\b/i,
      reason: 'Afirmação de resistência ou durabilidade não comprovada no PRODUCT_FACTS',
    },
    {
      type: 'SEGURANCA_CERTIFICACAO',
      pattern: /\b(seguran[çc]a\s+m[aá]xima|prote[çc][aã]o\s+contra|anti[- ]?chama|curto[- ]?circuito|certifica[çc][aã]o|certificad[oa]|inmetro|selo\s+de\s+qualidade|garantia\s+estendida)\b/i,
      reason: 'Afirmação de segurança ou certificação não existente no PRODUCT_FACTS',
    },
    {
      type: 'POTENCIA_ELETRICA',
      pattern: /\b(pot[eê]ncia\s+de|\b\d+\s*w\b|\b\d+\s*watts?\b|\b\d+\s*amperes?\b|\b\d+\s*a\b)\b/i,
      reason: 'Especificação técnica de potência/amperagem não informada no PRODUCT_FACTS',
    },
    {
      type: 'AVALIACOES_INVENTADAS',
      pattern: /\b(nota\s*\d|avalia[çc][oõ]es?|estrelas?|compradores\s+confirmam|todo\s+mundo\s+elogiando|mais\s+vendido|campe[aã]o\s+de\s+vendas|aprovado\s+por\s+todos)\b/i,
      reason: 'Afirmação de avaliações de clientes ou ranking não confirmados no PRODUCT_FACTS',
    },
    {
      type: 'URGENCIA_ESTOQUE',
      pattern: /\b([uú]ltim[ao]s?\s+unidades?|estoque\s+acabando|corra\s+antes\s+que|vai\s+acabar|poucas\s+unidades|restam\s+apenas|s[oó]\s+hoje)\b/i,
      reason: 'Gatilho de urgência ou escassez artificial proibido',
    },
    {
      type: 'BENEFICIO_GENERICO_FALSO',
      pattern: /\b(f[aá]cil\s+de\s+limpar|estrutura\s+refor[çc]ada|qualidade\s+comprovada|acabamento\s+de\s+primeira)\b/i,
      reason: 'Adjetivo genérico de qualidade ou benefício não constante no PRODUCT_FACTS',
    },
  ];

  /**
   * Divide um texto em frases individuais para validação granular.
   */
  static splitIntoSentences(text) {
    if (!text || typeof text !== 'string') return [];
    return text
      .split(/(?<=[.!?])\s+|\n+/)
      .map(s => s.trim())
      .filter(s => s.length > 3);
  }

  /**
   * Valida uma frase individual contra o PRODUCT_FACTS.
   *
   * @param {string} sentence
   * @param {object} productFacts
   * @returns {{ approved: boolean, reason?: string, factsMatched?: string[] }}
   */
  static verifySentence(sentence, productFacts) {
    const s = sentence.trim();

    // 1. Checa padrões proibidos de alucinação
    for (const forbidden of NarrationVerifier.FORBIDDEN_HALLUCINATION_PATTERNS) {
      if (forbidden.pattern.test(s)) {
        return {
          approved: false,
          reason: forbidden.reason,
          sentence: s,
        };
      }
    }

    const factsMatched = [];
    const verifiedFeatures = Array.isArray(productFacts?.features_verified) ? productFacts.features_verified : [];
    const verifiedSpecs = Array.isArray(productFacts?.specifications_verified) ? productFacts.specifications_verified : [];
    const prodName = String(productFacts?.product_name || '').trim();
    const brand = String(productFacts?.brand || '').trim();

    // 2. Validação contra alegações técnicas sem evidência (Regra: se misturar fato com dado sem evidência, rejeitar)
    
    // 2.1 Voltagem / Tensão não comprovada
    if (/\b(110v|127v|220v|bivolt)\b/i.test(s)) {
      const hasVoltageFeature = verifiedFeatures.some(f => /110|127|220|bivolt/i.test(f))
        || verifiedSpecs.some(spec => /110|127|220|bivolt/i.test(spec));

      if (!hasVoltageFeature) {
        return {
          approved: false,
          reason: 'Menção a voltagem/tensão não existente no PRODUCT_FACTS',
          sentence: s,
        };
      }
      if (/\bbivolt\b/i.test(s) && verifiedFeatures.some(f => /bivolt/i.test(f))) {
        factsMatched.push('features: bivolt');
      }
    }

    // 2.2 Tomadas / Saídas não comprovadas
    const tomadasMatch = s.match(/\b(\d+)\s*(?:tomadas?|sa[íi]das?)\b/i);
    if (tomadasMatch) {
      const qty = tomadasMatch[1];
      const hasTomadas = verifiedFeatures.some(f => new RegExp(`\\b${qty}\\s*tomadas?`, 'i').test(f));
      if (!hasTomadas) {
        return {
          approved: false,
          reason: `Menção a ${qty} tomadas não existente no PRODUCT_FACTS`,
          sentence: s,
        };
      }
      factsMatched.push(`features: ${qty} tomadas`);
    }

    // 2.3 Portas USB não comprovadas
    const usbMatch = s.match(/\b(\d+)?\s*(?:portas?\s*)?usb\b/i);
    if (usbMatch) {
      const hasUsb = verifiedFeatures.some(f => /usb/i.test(f));
      if (!hasUsb) {
        return {
          approved: false,
          reason: 'Menção a portas USB não existente no PRODUCT_FACTS',
          sentence: s,
        };
      }
      factsMatched.push('features: portas USB');
    }

    // 2.4 Cabo / Metragem não comprovada
    const caboMatch = s.match(/\b(\d+(?:[.,]\d+)?\s*(?:m|metros?))\b/i);
    if (caboMatch || /\bcabo\b/i.test(s)) {
      const hasCabo = verifiedFeatures.some(f => /cabo|\d+\s*(?:m|metros?)/i.test(f))
        || /\bcabo\b/i.test(prodName);
      if (!hasCabo) {
        return {
          approved: false,
          reason: 'Menção a cabo ou metragem não existente no PRODUCT_FACTS',
          sentence: s,
        };
      }
      if (caboMatch) factsMatched.push(`features: ${caboMatch[1]}`);
    }

    // 2.5 Tipo de produto incompatível (ex: falar "extensão" para um capacete)
    if (/\bextens[aã]o\b/i.test(s) && !/\bextens[aã]o\b/i.test(prodName)) {
      return {
        approved: false,
        reason: 'Menção a tipo de produto (extensão) incompatível com PRODUCT_FACTS',
        sentence: s,
      };
    }

    // 2.6 Modelo não comprovado (código alfanumérico ex: WKC-541)
    const codeMatch = s.match(/\b([A-Za-z]{2,5}-\d{2,4})\b/);
    if (codeMatch) {
      const modelCode = codeMatch[1].toUpperCase();
      const hasModel = prodName.toUpperCase().includes(modelCode)
        || verifiedSpecs.some(spec => spec.toUpperCase().includes(modelCode));
      if (!hasModel) {
        return {
          approved: false,
          reason: `Modelo ${modelCode} não constante no PRODUCT_FACTS`,
          sentence: s,
        };
      }
      factsMatched.push(`model: ${modelCode}`);
    }

    // 3. Validação Dinâmica de Preço, Preço Original e Desconto
    const numPrice = productFacts.price !== null && productFacts.price !== undefined ? Number(productFacts.price) : null;
    const numOrigPrice = productFacts.original_price !== null && productFacts.original_price !== undefined ? Number(productFacts.original_price) : null;
    const numDiscount = productFacts.discount !== null && productFacts.discount !== undefined ? Number(productFacts.discount) : null;

    // 3.1 Desconto percentual
    const percentMatches = [...s.matchAll(/\b(\d+)\s*%/g)];
    for (const pm of percentMatches) {
      const val = Number(pm[1]);
      if (numDiscount !== null && val === numDiscount) {
        factsMatched.push('discount');
      } else {
        return {
          approved: false,
          reason: `Desconto de ${val}% mencionado diverge do valor em PRODUCT_FACTS (${numDiscount}%)`,
          sentence: s,
        };
      }
    }

    // 3.2 Preços e Valores Monetários
    const priceMatches = [...s.matchAll(/(?:R\$\s*)?(\d{1,5}(?:[.,]\d{2}))\b/g)];
    for (const pMatch of priceMatches) {
      const rawVal = pMatch[1].replace(',', '.');
      const val = parseFloat(rawVal);
      if (isNaN(val)) continue;

      let matched = false;
      if (numPrice !== null && (Math.abs(val - numPrice) < 0.05 || Math.abs(val - Math.round(numPrice)) < 0.05)) {
        factsMatched.push('price');
        matched = true;
      }
      if (numOrigPrice !== null && (Math.abs(val - numOrigPrice) < 0.05 || Math.abs(val - Math.round(numOrigPrice)) < 0.05)) {
        factsMatched.push('original_price');
        matched = true;
      }

      if (!matched && pMatch[0].includes('R$')) {
        return {
          approved: false,
          reason: `Preço mencionado (R$ ${pMatch[1]}) diverge de PRODUCT_FACTS (atual: R$ ${numPrice}, original: R$ ${numOrigPrice})`,
          sentence: s,
        };
      }
    }

    // Checa menção a preço inteiro (ex: "por 144 reais")
    if (numPrice !== null && !factsMatched.includes('price')) {
      const intPrice = Math.floor(numPrice);
      const intRegex = new RegExp(`\\b${intPrice}\\b`);
      if (intRegex.test(s) && /(?:R\$|pre[çc]o|por|apenas|reais)/i.test(s)) {
        factsMatched.push('price');
      }
    }
    if (numOrigPrice !== null && !factsMatched.includes('original_price')) {
      const intOrig = Math.floor(numOrigPrice);
      const intRegex = new RegExp(`\\b${intOrig}\\b`);
      if (intRegex.test(s) && /(?:de|era|original|pre[çc]o)/i.test(s)) {
        factsMatched.push('original_price');
      }
    }

    // 4. Marca e Nome do Produto
    if (brand && brand !== 'Não informada') {
      const brandClean = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const brandRegex = new RegExp(`\\b${brandClean}\\b`, 'i');
      if (brandRegex.test(s)) {
        factsMatched.push('brand');
      }
    }

    // Termos chave do nome do produto (termos >= 4 caracteres)
    if (prodName) {
      const prodTokens = prodName
        .toLowerCase()
        .replace(/[^a-z0-9áéíóúâêôãõç\s]/gi, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 4 && !['para', 'com', 'mais', 'pelo', 'pela', 'onde', 'como'].includes(t));
      
      const hasProdToken = prodTokens.some(tok => s.toLowerCase().includes(tok));
      if (hasProdToken) {
        factsMatched.push('product_name');
      }
    }

    // 5. Características e Especificações verificadas
    for (const feat of verifiedFeatures) {
      if (feat && s.toLowerCase().includes(feat.toLowerCase())) {
        factsMatched.push(`feature: ${feat}`);
      }
    }
    for (const spec of verifiedSpecs) {
      const specVal = spec.split(':')[1]?.trim();
      if (specVal && specVal.length > 2 && s.toLowerCase().includes(specVal.toLowerCase())) {
        factsMatched.push(`spec: ${spec}`);
      }
    }

    // 6. Chamada para Ação / Local do Link
    if (/coment[aá]rios?|link(?:\s+com\s+desconto|\s+fixado|\s+no|\s+liberado)/i.test(s)) {
      factsMatched.push('cta_location');
    }

    // 6.1 Ganchos comerciais, dores do cliente e custo-benefício (Super Produtora)
    if (/(?:procurando|quer\s+(?:cuidar|monitorar|proteger|economizar|resolver)|ama\s+praticidade|d[aá]\s+uma\s+olhada|achadinho|custo[- ]benef[íi]cio|pelo\s+que\s+entrega|vale\s+cada\s+centavo|facilita\s+(?:a\s+sua\s+)?rotina|na\s+palma\s+da\s+m[aã]o|sem\s+mensalidade|sem\s+gastar|resolve\s+(?:aquele|o)|encaixa\s+direto|conecta\s+no\s+wi-?fi|aproveita\s+enquanto)/i.test(s)) {
      factsMatched.push('commercial_hook_or_benefit');
    }

    // 7. Frases conectivas neutras e factualmente seguras
    const isPlausibleFactual = factsMatched.length > 0;

    if (!isPlausibleFactual) {
      return {
        approved: false,
        reason: 'Frase sem suporte ou evidência em PRODUCT_FACTS',
        sentence: s,
      };
    }

    return {
      approved: true,
      sentence: s,
      factsMatched,
    };
  }

  /**
   * Valida todo o roteiro ou narração de cada cena contra o PRODUCT_FACTS.
   *
   * @param {object} params
   * @param {string|string[]} params.narration - Texto completo ou lista de falas por cena
   * @param {object} params.productFacts - Objeto PRODUCT_FACTS gerado pelo ProductFactsBuilder
   * @returns {{
   *   valid: boolean,
   *   approvedSentences: string[],
   *   rejectedSentences: { sentence: string, reason: string }[],
   *   finalNarration: string,
   *   factsUsedTotal: string[]
   * }}
   */
  static validateNarration({ narration, productFacts }) {
    if (!productFacts) {
      throw new Error('PRODUCT_FACTS obrigatório para validação da narração.');
    }

    const sentences = Array.isArray(narration)
      ? narration.flatMap(n => NarrationVerifier.splitIntoSentences(n))
      : NarrationVerifier.splitIntoSentences(narration);

    const approvedSentences = [];
    const rejectedSentences = [];
    const factsUsedSet = new Set();

    for (const s of sentences) {
      const result = NarrationVerifier.verifySentence(s, productFacts);
      if (result.approved) {
        approvedSentences.push(result.sentence);
        if (result.factsMatched) {
          result.factsMatched.forEach(f => factsUsedSet.add(f));
        }
      } else {
        logger.warn(`[NarrationVerifier] 🚫 FRASE REJEITADA: "${result.sentence}" — Motivo: ${result.reason}`);
        rejectedSentences.push({
          sentence: result.sentence,
          reason: result.reason,
        });
      }
    }

    const finalNarration = approvedSentences.join(' ');

    logger.info(`[NarrationVerifier] 📊 Validação concluída: ${approvedSentences.length} frases aprovadas, ${rejectedSentences.length} frases rejeitadas por falta de evidência.`);

    return {
      valid: rejectedSentences.length === 0,
      totalSentences: sentences.length,
      approvedSentences,
      rejectedSentences,
      finalNarration,
      factsUsedTotal: Array.from(factsUsedSet),
    };
  }
}

export default NarrationVerifier;
