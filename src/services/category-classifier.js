/**
 * ACHAki Autopilot — CategoryClassifier
 *
 * Classificador semântico e estruturado de categorias de produtos:
 *  - Analisa título do produto, metadados de URL e contexto real
 *  - Categoriza produtos em taxonomia padronizada
 *  - Elimina a atribuição errônea de categorias padrão (ex: tudo virando 'cozinha')
 *  - Suporta taxonomia primária e secundária (ex: Tecnologia/Monitores, Moda/Vestuário)
 */

export class CategoryClassifier {
  constructor() {
    this.rules = [
      // 1. TECNOLOGIA / MONITORES
      {
        category: 'Tecnologia/Monitores',
        primary: 'Tecnologia',
        sub: 'Monitores',
        keywords: [
          'monitor gamer', 'monitor portátil', 'monitor portatil', 'monitor fhd', 'monitor 144hz',
          'monitor 165hz', 'monitor 240hz', 'monitor 75hz', 'monitor ips', 'monitor ultrawide',
          'monitor curvo', 'tela portátil', 'tela portatil', 'monitor 15.6', 'monitor 24', 'monitor 27'
        ],
        pattern: /\bmonitor\b|\btela\s+port[aá]til\b/i
      },

      // 2. TECNOLOGIA / WEARABLES & SMARTWATCHES
      {
        category: 'Tecnologia/Wearables',
        primary: 'Tecnologia',
        sub: 'Wearables',
        keywords: [
          'smartwatch', 'smart watch', 'smartband', 'smart band', 'relógio smartwatch', 'relogio smartwatch',
          'relogio inteligente', 'relógio inteligente', 'pulseira inteligente', 'huawei band', 'galaxy watch',
          'apple watch', 'mi band', 'amazfit', 'redmi watch', 'xiaomi band'
        ],
        pattern: /\bsmartwatch\b|\bsmart\s*band\b|\brel[oó]gio\s+inteligente\b|\bband\s*\d+\b/i
      },

      // 3. TECNOLOGIA / TABLETS
      {
        category: 'Tecnologia/Tablets',
        primary: 'Tecnologia',
        sub: 'Tablets',
        keywords: [
          'tablet', 'matepad', 'ipad', 'galaxy tab', 'tab s', 'tab a', 'kindle',
          'mesa digitalizadora', 'xiaomi pad', 'redmi pad', 'lenovo tab'
        ],
        pattern: /\btablet\b|\bmatepad\b|\bipad\b|\bgalaxy\s+tab\b|\bkindle\b/i
      },

      // 4. TECNOLOGIA / SMARTPHONES
      {
        category: 'Tecnologia/Smartphones',
        primary: 'Tecnologia',
        sub: 'Smartphones',
        keywords: [
          'smartphone', 'celular', 'iphone', 'galaxy s', 'galaxy a', 'redmi note',
          'poco', 'motorola edge', 'moto g', 'xiaomi 1', 'zenfone'
        ],
        pattern: /\bsmartphone\b|\bcelular\b|\biphone\b|\bmoto\s+g\b|\bpoco\s+[xfmc]\d+/i
      },

      // 5. TECNOLOGIA / INFORMÁTICA
      {
        category: 'Tecnologia/Informática',
        primary: 'Tecnologia',
        sub: 'Informática',
        keywords: [
          'notebook', 'laptop', 'computador', 'pc gamer', 'memoria ram', 'memória ram',
          'ssd nvme', 'ssd sata', 'placa de video', 'placa de vídeo', 'rtx', 'gtx',
          'teclado mecânico', 'teclado mecanico', 'mouse gamer', 'roteador', 'processador ryzen',
          'processador intel', 'gabinete gamer', 'fonte atx', 'water cooler', 'hub usb'
        ],
        pattern: /\bnotebook\b|\blaptop\b|\bpc\s+gamer\b|\bssd\b|\bmem[oó]ria\s+ram\b|\bteclado\s+mec[aâ]nico\b/i
      },

      // 6. TECNOLOGIA / ÁUDIO
      {
        category: 'Tecnologia/Áudio',
        primary: 'Tecnologia',
        sub: 'Áudio',
        keywords: [
          'fone de ouvido', 'headset', 'headphone', 'earbuds', 'airpods', 'caixa de som',
          'soundbar', 'alexa', 'echo dot', 'jbl', 'microfone condensador', 'caixa bluetooth'
        ],
        pattern: /\bfone\s+de\s+ouvido\b|\bheadset\b|\bearbuds\b|\bsoundbar\b|\bcaixa\s+de\s+som\b/i
      },

      // 7. MODA / VESTUÁRIO
      {
        category: 'Moda/Vestuário',
        primary: 'Moda',
        sub: 'Vestuário',
        keywords: [
          'calça', 'calca', 'jogger', 'tactel', 'legging', 'bermuda', 'shorts', 'short',
          'camiseta', 'camisa', 'moletom', 'jaqueta', 'casaco', 'vestido', 'saia',
          'cueca', 'calcinha', 'sutiã', 'lingerie', 'meia', 'biquíni', 'biquini',
          'dry-fit', 'dry fit', 'fitness', 'moda fitness', 'joggings', 'agasalho',
          'regata', 'cropped', 'pijama', 'dark lab', 'blusão', 'blusa'
        ],
        pattern: /\bcal[cç]a\b|\bjogger\b|\btactel\b|\bcamiseta\b|\bcamisa\b|\bmoletom\b|\bvestido\b|\bbermuda\b|\bshorts?\b|\blegging\b/i
      },

      // 8. MODA / CALÇADOS
      {
        category: 'Moda/Calçados',
        primary: 'Moda',
        sub: 'Calçados',
        keywords: [
          'tênis', 'tenis', 'sapato', 'sapatilha', 'bota', 'sandália', 'sandalia',
          'chinelo', 'pantufa', 'chuteira', 'coturno', 'scarpin', 'mocassim'
        ],
        pattern: /\bt[eê]nis\b|\bsapato\b|\bbota\b|\bsand[aá]lia\b|\bchinelo\b|\bchuteira\b/i
      },

      // 9. CASA / QUARTO
      {
        category: 'Casa/Quarto',
        primary: 'Casa',
        sub: 'Quarto',
        keywords: [
          'colchão', 'colchao', 'travesseiro', 'lençol', 'lencol', 'edredom', 'cobertor',
          'fronha', 'cama box', 'cama casal', 'cama solteiro', 'cabeceira', 'guarda-roupa',
          'guarda roupa', 'duo comfort', 'emma duo', 'densidade d33', 'densidade d45', 'pillow'
        ],
        pattern: /\bcolch[aã]o\b|\btravesseiro\b|\bedredom\b|\blen[cç]ol\b|\bcama\b/i
      },

      // 10. CASA / COZINHA
      {
        category: 'Casa/Cozinha',
        primary: 'Casa',
        sub: 'Cozinha',
        keywords: [
          'panela', 'frigideira', 'airfryer', 'air fryer', 'fritadeira sem óleo', 'liquidificador',
          'batedeira', 'cafeteira', 'prato', 'copo', 'taça', 'taca', 'faqueiro', 'talher',
          'porta temperos', 'pote hermético', 'pote hermetico', 'escorredor de louça',
          'micro-ondas', 'microondas', 'fogão', 'fogao', 'cooktop', 'forma de bolo', 'garrafa térmica'
        ],
        pattern: /\bpanela\b|\bfrigideira\b|\bair\s*fryer\b|\bliquidificador\b|\bcafeteira\b|\bfog[aã]o\b/i
      },

      // 11. CASA / ORGANIZAÇÃO
      {
        category: 'Casa/Organização',
        primary: 'Casa',
        sub: 'Organização',
        keywords: [
          'carrinho organizador', 'organizador multiuso', 'caixa organizadora', 'cesto organizador',
          'cabide', 'gaveteiro', 'estante organizadora', 'sapateira', 'organizador armário',
          'organizador geladeira', 'organizador acrílico', 'organizador acrilico'
        ],
        pattern: /\borganizador\b|\bcaixa\s+organizadora\b|\bcarrinho\s+auxiliar\b/i
      },

      // 12. FERRAMENTAS & CONSTRUÇÃO
      {
        category: 'Ferramentas & Construção',
        primary: 'Ferramentas',
        sub: 'Construção',
        keywords: [
          'furadeira', 'parafusadeira', 'martelete', 'serra circular', 'serra tico-tico',
          'trena', 'alicate', 'chave de fenda', 'chave combinada', 'multímetro', 'multimetro',
          'máquina de solda', 'maquina de solda', 'lixadeira', 'esmerilhadeira', 'kit ferramentas'
        ],
        pattern: /\bfuradeira\b|\bparafusadeira\b|\bmartelete\b|\blixadeira\b|\besmerilhadeira\b|\balicate\b/i
      },

      // 13. BELEZA & CUIDADOS
      {
        category: 'Beleza & Cuidados',
        primary: 'Beleza',
        sub: 'Cuidados Pessoais',
        keywords: [
          'perfume', 'maquiagem', 'batom', 'rímel', 'rimel', 'base líquida', 'protetor solar',
          'hidratante facial', 'sérum', 'serum', 'shampoo', 'condicionador', 'secador de cabelo',
          'prancha alisadora', 'barbeador', 'aparador de pelos', 'escova secadora'
        ],
        pattern: /\bperfume\b|\bmaquiagem\b|\bprotetor\s+solar\b|\bshampoo\b|\bsecador\s+de\s+cabelo\b/i
      }
    ];
  }

  /**
   * Normaliza texto para correspondência sem acentos e em minúsculas.
   */
  _normalize(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Classifica semanticamente um produto com base em título, URL e metadados.
   *
   * @param {string} title - Título completo do produto
   * @param {string} [url=''] - URL do produto (pode conter dicas de slug/categoria)
   * @param {string} [declaredCategory=''] - Categoria declarada no marketplace (opcional)
   * @returns {{
   *   category: string,
   *   primary: string,
   *   sub: string,
   *   confidence: 'HIGH' | 'MEDIUM' | 'LOW'
   * }}
   */
  classify(title = '', url = '', declaredCategory = '') {
    const normTitle = this._normalize(title);
    const normUrl = this._normalize(url);
    const combined = `${normTitle} ${normUrl}`;

    if (!normTitle) {
      return {
        category: 'Utilidades & Variedades',
        primary: 'Utilidades',
        sub: 'Geral',
        confidence: 'LOW',
      };
    }

    // 1. Testa regras por pontuação de keywords e regex
    let bestMatch = null;
    let highestScore = 0;

    for (const rule of this.rules) {
      let score = 0;

      // Regex match forte
      if (rule.pattern && rule.pattern.test(title)) {
        score += 50;
      }

      // Keyword matches
      for (const kw of rule.keywords) {
        const normKw = this._normalize(kw);
        if (normTitle.includes(normKw)) {
          // Palavras mais longas dão maior especificidade
          score += (normKw.length >= 8 ? 30 : 15);
        } else if (combined.includes(normKw)) {
          score += 10;
        }
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = rule;
      }
    }

    if (bestMatch && highestScore >= 15) {
      return {
        category: bestMatch.category,
        primary: bestMatch.primary,
        sub: bestMatch.sub,
        confidence: highestScore >= 40 ? 'HIGH' : 'MEDIUM',
      };
    }

    // 2. Se não encontrou regra específica, mas tem categoria declarada válida (e diferente de cozinha genérica)
    const normDecl = this._normalize(declaredCategory);
    if (normDecl && !normDecl.includes('cozinha') && !normDecl.includes('outros') && normDecl.length > 3) {
      return {
        category: declaredCategory.charAt(0).toUpperCase() + declaredCategory.slice(1),
        primary: declaredCategory,
        sub: 'Geral',
        confidence: 'MEDIUM',
      };
    }

    // 3. Fallback neutro e realista
    return {
      category: 'Utilidades & Variedades',
      primary: 'Utilidades',
      sub: 'Variedades',
      confidence: 'LOW',
    };
  }
}

export default CategoryClassifier;
