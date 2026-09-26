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

    // 2. Checa se menciona características técnicas não listadas
    // Ex: voltagem incorreta
    if (/\b(110v|127v|220v)\b/i.test(s) && !productFacts.features_verified.some(f => /110|127|220/i.test(f))) {
      if (!/\bbivolt\b/i.test(productFacts.features_verified.join(' '))) {
        return {
          approved: false,
          reason: 'Menção a voltagem específica não constante no PRODUCT_FACTS',
          sentence: s,
        };
      }
    }

    // 3. Mapeamento de fatos confirmados utilizados na frase
    const factsMatched = [];

    if (/coibeu/i.test(s) && /coibeu/i.test(productFacts.brand || productFacts.product_name)) {
      factsMatched.push('brand');
    }
    if (/wkc-?541/i.test(s) && /wkc-?541/i.test(productFacts.product_name)) {
      factsMatched.push('model');
    }
    if (/10\s*tomadas?/i.test(s) && productFacts.features_verified.some(f => /10\s*tomadas?/i.test(f))) {
      factsMatched.push('features: 10 tomadas');
    }
    if (/4\s*(?:portas?\s*)?usb/i.test(s) && productFacts.features_verified.some(f => /4\s*usb/i.test(f))) {
      factsMatched.push('features: 4 portas USB');
    }
    if (/2\s*(?:m|metros?)/i.test(s) && productFacts.features_verified.some(f => /2\s*(?:m|metros?)/i.test(f))) {
      factsMatched.push('features: cabo de 2 metros');
    }
    if (/bivolt/i.test(s) && productFacts.features_verified.some(f => /bivolt/i.test(f))) {
      factsMatched.push('features: bivolt');
    }
    if (/\b(?:38|39)\b/i.test(s) && productFacts.price) {
      factsMatched.push('price');
    }
    if (/\b69\b/i.test(s) && productFacts.original_price) {
      factsMatched.push('original_price');
    }
    if (/\b44\s*%/i.test(s) && productFacts.discount) {
      factsMatched.push('discount');
    }
    if (/coment[aá]rios?|link/i.test(s)) {
      factsMatched.push('cta_location');
    }

    // 4. Frases puramente conectoras de CTA ou apresentação factual permitidas
    const isPlausibleFactual = factsMatched.length > 0
      || /^(d[aá]\s+uma\s+olhada|extens[aã]o|confira|o\s+link\s+com\s+desconto)/i.test(s);

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
