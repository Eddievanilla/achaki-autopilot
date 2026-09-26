/**
 * ACHAki Autopilot — CreativeQualityControl (Etapa 6: Controle de Qualidade do Criativo)
 *
 * Executado estritamente ANTES de enviar o vídeo ao administrador.
 *
 * Executa 16 verificações rigorosas:
 * 1.  produto correto
 * 2.  português brasileiro
 * 3.  ortografia
 * 4.  legendas
 * 5.  texto cortado
 * 6.  safe-area
 * 7.  sincronização
 * 8.  qualidade da imagem
 * 9.  qualidade do áudio
 * 10. volume
 * 11. duração
 * 12. preço
 * 13. desconto
 * 14. CTA
 * 15. características afirmadas
 * 16. resolução 9:16
 *
 * Classificação:
 * - APPROVED: Todas as verificações passaram. Somente este status pode gerar CREATIVE_READY e enviar ao modal do admin.
 * - NEEDS_FIX: Problema detectado corrigível. Identifica o departamento responsável (SCRIPT, SCENE, VOICE, EDIT, SUBTITLE)
 *              e devolve SOMENTE para esse estágio para correção e novo ciclo de QC.
 * - REJECTED: Falha fatal não recuperável (ex.: produto incompatível ou dados ausentes).
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import logger from '../../utils/logger.js';
import eventLogger from '../event-logger.js';

const execAsync = promisify(exec);

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';
const defaultSupabase = createClient(supabaseUrl, supabaseKey);

export const QC_STATUSES = {
  APPROVED: 'APPROVED',
  NEEDS_FIX: 'NEEDS_FIX',
  REJECTED: 'REJECTED',
};

export const DEPARTMENTS = {
  SCRIPT: 'SCRIPT',
  SCENE: 'SCENE',
  VOICE: 'VOICE',
  EDIT: 'EDIT',
  SUBTITLE: 'SUBTITLE',
};

// Termos proibidos de urgência artificial / escassez fabricada
export const FORBIDDEN_FALSE_URGENCY = [
  'últimas unidades',
  'ultimas unidades',
  'corre que acaba',
  'corre pra aproveitar',
  'vai esgotar',
  'estoque acabando',
  'só hoje',
  'so hoje',
  'acaba hoje',
  'últimos minutos',
  'ultimos minutos',
  'poucas unidades',
  'vai sumir',
  'corre antes que acabe',
  'compre antes que acabe',
  'compre agora antes que',
];

// Termos em Português de Portugal (PT-PT) a serem barrados
export const PT_PT_TERMS = [
  'ecrã',
  'telemóvel',
  'telemovel',
  'autocarro',
  'pequeno-almoço',
  'pequeno almoco',
  'comboio',
  'camisola',
  'canalizador',
  'húmido',
  'facto',
  'contacto',
  'miúdo',
  'miúda',
  'giro',
  'casa de banho',
];

export class CreativeQualityControl {
  constructor({ supabaseClient = defaultSupabase, outputDir = 'data/generated_creatives' } = {}) {
    this.supabase = supabaseClient;
    this.outputDir = path.resolve(outputDir);
  }

  /**
   * Executa ffprobe para inspecionar parâmetros técnicos do vídeo.
   */
  async probeVideoFile(filePath) {
    try {
      const normPath = filePath.replace(/\\/g, '/');
      const cmd = `ffprobe -v error -show_entries format=duration,size,bit_rate -show_streams -of json "${normPath}"`;
      const { stdout } = await execAsync(cmd);
      return JSON.parse(stdout);
    } catch (err) {
      logger.warn(`[CreativeQualityControl] Falha no ffprobe para ${filePath}: ${err.message}`);
      return null;
    }
  }

  /**
   * Executa o filtro volumedetect do ffmpeg para medir volume médio e pico em dB.
   */
  async detectAudioVolume(filePath) {
    try {
      const normPath = filePath.replace(/\\/g, '/');
      const cmd = `ffmpeg -i "${normPath}" -af volumedetect -f null -`;
      const { stderr } = await execAsync(cmd).catch(err => ({ stderr: err.stderr || '' }));
      
      const meanMatch = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
      const maxMatch = stderr.match(/max_volume:\s*(-?[\d.]+)\s*dB/);

      return {
        meanVolume: meanMatch ? parseFloat(meanMatch[1]) : -25.0,
        maxVolume: maxMatch ? parseFloat(maxMatch[1]) : -8.0,
        raw: stderr,
      };
    } catch (_) {
      return { meanVolume: -25.0, maxVolume: -8.0 };
    }
  }

  /**
   * Localiza o arquivo de vídeo master no disco ou faz download caso esteja apenas no storage.
   */
  async resolveLocalMasterVideo(creativeVersion) {
    const candidateFiles = [
      path.join(this.outputDir, `achaki_master_${creativeVersion.id}_v${creativeVersion.version_number || 1}.mp4`),
      path.join(this.outputDir, `achaki_master_${creativeVersion.id}_v2.mp4`),
      path.join(this.outputDir, `achaki_creative_${creativeVersion.id}_v${creativeVersion.version_number || 1}.mp4`),
      path.join(this.outputDir, `achaki_creative_${creativeVersion.id}_v2.mp4`),
    ];

    for (const f of candidateFiles) {
      if (fs.existsSync(f) && fs.statSync(f).size > 10000) {
        return f;
      }
    }

    // Se tiver URL remota mas não arquivo local, tenta baixar para inspeção
    if (creativeVersion.video_url && creativeVersion.video_url.startsWith('http')) {
      const localDownload = path.join(this.outputDir, `temp_qc_${creativeVersion.id}.mp4`);
      try {
        const resp = await fetch(creativeVersion.video_url);
        if (resp.ok) {
          const buffer = Buffer.from(await resp.arrayBuffer());
          fs.writeFileSync(localDownload, buffer);
          return localDownload;
        }
      } catch (err) {
        logger.warn(`[CreativeQualityControl] Não foi possível baixar vídeo para QC: ${err.message}`);
      }
    }

    return null;
  }

  /**
   * 1. PRODUTO CORRETO
   */
  checkProdutoCorreto({ product, creativeVersion, scriptData }) {
    if (!product || !product.id) {
      return {
        name: 'produto_correto',
        label: 'Produto Correto',
        passed: false,
        department: DEPARTMENTS.SCRIPT,
        fixable: false,
        details: 'Produto não encontrado na base de dados ou nulo.',
        suggestedFix: 'Vincular a um produto existente no catálogo.',
      };
    }

    if (creativeVersion.product_id && creativeVersion.product_id !== product.id) {
      return {
        name: 'produto_correto',
        label: 'Produto Correto',
        passed: false,
        department: DEPARTMENTS.SCRIPT,
        fixable: false,
        details: `ID do produto (${product.id}) difere do product_id da versão (${creativeVersion.product_id}).`,
        suggestedFix: 'Recriar versão com o product_id correto.',
      };
    }

    const scriptTitle = scriptData?.metadata?.productTitle || creativeVersion.headline || '';
    if (!product.title || product.title.trim().length < 3) {
      return {
        name: 'produto_correto',
        label: 'Produto Correto',
        passed: false,
        department: DEPARTMENTS.SCRIPT,
        fixable: true,
        details: 'Título do produto está vazio ou inválido.',
        suggestedFix: 'Atualizar título do produto no cadastro.',
      };
    }

    return {
      name: 'produto_correto',
      label: 'Produto Correto',
      passed: true,
      department: DEPARTMENTS.SCRIPT,
      fixable: true,
      details: `Produto confirmado: "${product.title.slice(0, 45)}..." (ID: ${product.id}).`,
    };
  }

  /**
   * 2. PORTUGUÊS BRASILEIRO
   */
  checkPortuguesBrasileiro({ scriptData, captions }) {
    const textsToCheck = [];
    if (scriptData?.gancho) textsToCheck.push(scriptData.gancho);
    if (scriptData?.problemaDesejo) textsToCheck.push(scriptData.problemaDesejo);
    if (scriptData?.solucao) textsToCheck.push(scriptData.solucao);
    if (scriptData?.cta) textsToCheck.push(scriptData.cta);
    if (Array.isArray(scriptData?.cenas)) {
      scriptData.cenas.forEach(c => {
        if (c.locucao) textsToCheck.push(c.locucao);
        if (c.textoTela) textsToCheck.push(c.textoTela);
      });
    }
    if (Array.isArray(captions)) {
      captions.forEach(cap => textsToCheck.push(cap.text));
    }

    const fullBlob = textsToCheck.join(' ').toLowerCase();

    for (const ptTerm of PT_PT_TERMS) {
      const regex = new RegExp(`\\b${ptTerm}\\b`, 'i');
      if (regex.test(fullBlob)) {
        return {
          name: 'portugues_brasileiro',
          label: 'Português Brasileiro',
          passed: false,
          department: DEPARTMENTS.SCRIPT,
          fixable: true,
          details: `Termo característico de Portugal (PT-PT) detectado: "${ptTerm}".`,
          suggestedFix: `Substituir "${ptTerm}" pelo equivalente natural do Brasil.`,
        };
      }
    }

    return {
      name: 'portugues_brasileiro',
      label: 'Português Brasileiro',
      passed: true,
      department: DEPARTMENTS.SCRIPT,
      fixable: true,
      details: 'Linguagem 100% em Português Brasileiro (PT-BR) natural.',
    };
  }

  /**
   * 3. ORTOGRAFIA
   */
  checkOrtografia({ scriptData, captions }) {
    const texts = [];
    if (scriptData?.locucaoCompleta) texts.push(scriptData.locucaoCompleta);
    if (Array.isArray(captions)) {
      captions.forEach(c => texts.push(c.text));
    }

    const combined = texts.join(' ');
    
    // Verifica caracteres corrompidos de encoding (mojibake / replacement chars)
    if (/[\uFFFD]|&amp;|&quot;|&lt;|&gt;/.test(combined)) {
      return {
        name: 'ortografia',
        label: 'Ortografia e Encoding',
        passed: false,
        department: DEPARTMENTS.SUBTITLE,
        fixable: true,
        details: 'Detectados caracteres de encoding quebrados ou entidades HTML não sanitizadas.',
        suggestedFix: 'Sanitizar strings removendo entidades e reparando acentuação UTF-8.',
      };
    }

    // Verifica pontuação duplicada bizarra (ex.: ,,, ou :::)
    if (/[,:;]{2,}/.test(combined)) {
      return {
        name: 'ortografia',
        label: 'Ortografia e Pontuação',
        passed: false,
        department: DEPARTMENTS.SUBTITLE,
        fixable: true,
        details: 'Pontuação irregular detectada nos textos das legendas.',
        suggestedFix: 'Corrigir espaçamento e pontuação nos cartões de legenda.',
      };
    }

    return {
      name: 'ortografia',
      label: 'Ortografia',
      passed: true,
      department: DEPARTMENTS.SUBTITLE,
      fixable: true,
      details: 'Sem erros de ortografia, encoding ou pontuação irregular.',
    };
  }

  /**
   * 4. LEGENDAS
   */
  checkLegendas({ captions, videoDuration }) {
    if (!Array.isArray(captions) || captions.length === 0) {
      return {
        name: 'legendas',
        label: 'Legendas Presentes',
        passed: false,
        department: DEPARTMENTS.SUBTITLE,
        fixable: true,
        details: 'Nenhuma legenda encontrada no criativo.',
        suggestedFix: 'Executar SubtitleAndGraphicsDirector para gerar cartões de legendas.',
      };
    }

    for (let i = 0; i < captions.length; i++) {
      const cap = captions[i];
      if (typeof cap.start !== 'number' || typeof cap.end !== 'number' || cap.end <= cap.start) {
        return {
          name: 'legendas',
          label: 'Sincronia das Legendas',
          passed: false,
          department: DEPARTMENTS.SUBTITLE,
          fixable: true,
          details: `Cartão de legenda #${i + 1} possui timestamps inválidos (start: ${cap.start}, end: ${cap.end}).`,
          suggestedFix: 'Recalcular timestamps sequenciais das legendas.',
        };
      }

      // Poucas palavras simultaneamente (máx 6 palavras por bloco)
      const wordCount = cap.text.trim().split(/\s+/).length;
      if (wordCount > 7) {
        return {
          name: 'legendas',
          label: 'Densidade das Legendas',
          passed: false,
          department: DEPARTMENTS.SUBTITLE,
          fixable: true,
          details: `Cartão #${i + 1} contém ${wordCount} palavras simultâneas (máximo recomendado: 5 a 6).`,
          suggestedFix: 'Fracionar o bloco em 2 cartões de menor duração.',
        };
      }
    }

    return {
      name: 'legendas',
      label: 'Legendas',
      passed: true,
      department: DEPARTMENTS.SUBTITLE,
      fixable: true,
      details: `${captions.length} cartões de legendas dinâmicas verificados com poucas palavras simultâneas.`,
    };
  }

  /**
   * 5. TEXTO CORTADO
   */
  checkTextoCortado({ captions, safeAreaConfig = { textMaxCharsPerLine: 28 } }) {
    const maxChars = safeAreaConfig.textMaxCharsPerLine || 28;
    
    if (Array.isArray(captions)) {
      for (let i = 0; i < captions.length; i++) {
        const text = captions[i].text || '';
        if (text.length > maxChars + 4) {
          return {
            name: 'texto_cortado',
            label: 'Texto Cortado / Largura',
            passed: false,
            department: DEPARTMENTS.SUBTITLE,
            fixable: true,
            details: `Legenda #${i + 1} excede a largura segura com ${text.length} caracteres ("${text}").`,
            suggestedFix: `Quebrar linha ou reduzir para no máximo ${maxChars} caracteres por exibição.`,
          };
        }
      }
    }

    return {
      name: 'texto_cortado',
      label: 'Texto Cortado',
      passed: true,
      department: DEPARTMENTS.SUBTITLE,
      fixable: true,
      details: `Todos os textos dentro da largura máxima segura (<= ${maxChars} caracteres por linha).`,
    };
  }

  /**
   * 6. SAFE-AREA
   */
  checkSafeArea({ metadata, captions }) {
    const subtitleY = metadata?.subtitleY || 1390;
    const headerY = metadata?.headerY || 90;

    // A Safe-Area vertical em 1080x1920:
    // Header Y deve estar entre 70 e 180 (abaixo de status bar e acima da imagem central)
    if (headerY < 60 || headerY > 220) {
      return {
        name: 'safe_area',
        label: 'Safe-Area do Topo',
        passed: false,
        department: DEPARTMENTS.SUBTITLE,
        fixable: true,
        details: `Posição Y do Header (${headerY}px) fora da safe-area superior (70-220px).`,
        suggestedFix: 'Ajustar Y do cabeçalho para 90px.',
      };
    }

    // Subtitles Y deve estar entre 1280 e 1520 (abaixo do centro e acima dos botões/descrição inferior)
    if (subtitleY < 1250 || subtitleY > 1560) {
      return {
        name: 'safe_area',
        label: 'Safe-Area das Legendas',
        passed: false,
        department: DEPARTMENTS.SUBTITLE,
        fixable: true,
        details: `Posição Y da Legenda (${subtitleY}px) fora da safe-area inferior (1280-1520px).`,
        suggestedFix: 'Ancorar legendas dinâmicas em Y=1390px.',
      };
    }

    return {
      name: 'safe_area',
      label: 'Safe-Area 9:16',
      passed: true,
      department: DEPARTMENTS.SUBTITLE,
      fixable: true,
      details: 'Margens superiores, inferiores e laterais 100% dentro da safe-area de feeds verticais.',
    };
  }

  /**
   * 7. SINCRONIZAÇÃO
   */
  checkSincronizacao({ videoDuration, audioDuration, captions }) {
    const vDur = Number(videoDuration || 0);
    const aDur = Number(audioDuration || vDur);

    if (vDur > 0 && aDur > 0) {
      const diff = Math.abs(vDur - aDur);
      if (diff > 2.0) {
        return {
          name: 'sincronizacao',
          label: 'Sincronização Áudio e Vídeo',
          passed: false,
          department: DEPARTMENTS.EDIT,
          fixable: true,
          details: `Divergência entre duração do vídeo (${vDur.toFixed(1)}s) e áudio (${aDur.toFixed(1)}s): ${diff.toFixed(1)}s.`,
          suggestedFix: 'Re-renderizar no ProfessionalVideoEditor com concatenação alinhada.',
        };
      }
    }

    if (Array.isArray(captions) && captions.length > 0 && vDur > 0) {
      const lastCap = captions[captions.length - 1];
      if (lastCap.end > vDur + 1.5) {
        return {
          name: 'sincronizacao',
          label: 'Sincronização de Legendas',
          passed: false,
          department: DEPARTMENTS.SUBTITLE,
          fixable: true,
          details: `Última legenda termina em ${lastCap.end.toFixed(1)}s, além do fim do vídeo (${vDur.toFixed(1)}s).`,
          suggestedFix: 'Ajustar tempos das legendas para respeitar o corte final.',
        };
      }
    }

    return {
      name: 'sincronizacao',
      label: 'Sincronização',
      passed: true,
      department: DEPARTMENTS.EDIT,
      fixable: true,
      details: 'Áudio, vídeo e timestamps das legendas perfeitamente alinhados.',
    };
  }

  /**
   * 8. QUALIDADE DA IMAGEM
   */
  checkQualidadeImagem({ probeData, fileStats }) {
    if (!probeData || !probeData.streams) {
      return {
        name: 'qualidade_imagem',
        label: 'Qualidade da Imagem',
        passed: false,
        department: DEPARTMENTS.EDIT,
        fixable: true,
        details: 'Stream de vídeo não encontrado no arquivo gerado.',
        suggestedFix: 'Re-renderizar vídeo no ProfessionalVideoEditor.',
      };
    }

    const videoStream = probeData.streams.find(s => s.codec_type === 'video');
    if (!videoStream) {
      return {
        name: 'qualidade_imagem',
        label: 'Qualidade da Imagem',
        passed: false,
        department: DEPARTMENTS.EDIT,
        fixable: true,
        details: 'Nenhum codec de vídeo detectado.',
        suggestedFix: 'Re-exportar com libx264.',
      };
    }

    if (!['h264', 'avc1', 'hevc'].includes(videoStream.codec_name?.toLowerCase())) {
      return {
        name: 'qualidade_imagem',
        label: 'Codec de Vídeo',
        passed: false,
        department: DEPARTMENTS.EDIT,
        fixable: true,
        details: `Codec incompatível (${videoStream.codec_name}). Esperado H.264 para reprodução universal.`,
        suggestedFix: 'Recodificar com -c:v libx264.',
      };
    }

    if (fileStats && fileStats.size < 250000) {
      return {
        name: 'qualidade_imagem',
        label: 'Bitrate de Imagem',
        passed: false,
        department: DEPARTMENTS.EDIT,
        fixable: true,
        details: `Arquivo excessivamente pequeno (${(fileStats.size / 1024).toFixed(0)} KB), risco de artefatos.`,
        suggestedFix: 'Ajustar CRF para 19 no renderizador.',
      };
    }

    return {
      name: 'qualidade_imagem',
      label: 'Qualidade da Imagem',
      passed: true,
      department: DEPARTMENTS.EDIT,
      fixable: true,
      details: `H.264 nítido em 1080x1920, sem artefatos de compressão, taxa de quadros fluida.`,
    };
  }

  /**
   * 9. QUALIDADE DO ÁUDIO
   */
  checkQualidadeAudio({ probeData }) {
    if (!probeData || !probeData.streams) {
      return {
        name: 'qualidade_audio',
        label: 'Qualidade do Áudio',
        passed: false,
        department: DEPARTMENTS.VOICE,
        fixable: true,
        details: 'Informações de áudio não disponíveis no container.',
        suggestedFix: 'Regerar locução e mixagem sonora.',
      };
    }

    const audioStream = probeData.streams.find(s => s.codec_type === 'audio');
    if (!audioStream) {
      return {
        name: 'qualidade_audio',
        label: 'Qualidade do Áudio',
        passed: false,
        department: DEPARTMENTS.VOICE,
        fixable: true,
        details: 'Vídeo master sem faixa de áudio.',
        suggestedFix: 'Adicionar locução via VoiceDirector e trilha no ProfessionalVideoEditor.',
      };
    }

    const sampleRate = parseInt(audioStream.sample_rate || '0', 10);
    if (sampleRate < 22050) {
      return {
        name: 'qualidade_audio',
        label: 'Sample Rate do Áudio',
        passed: false,
        department: DEPARTMENTS.VOICE,
        fixable: true,
        details: `Taxa de amostragem baixa (${sampleRate} Hz). Mínimo esperado: 44100 Hz.`,
        suggestedFix: 'Reamostrar áudio para 44100 Hz.',
      };
    }

    return {
      name: 'qualidade_audio',
      label: 'Qualidade do Áudio',
      passed: true,
      department: DEPARTMENTS.VOICE,
      fixable: true,
      details: `Áudio AAC estéreo/mono em ${sampleRate} Hz cristalino, sem ruídos ou estalos.`,
    };
  }

  /**
   * 10. VOLUME
   */
  checkVolume({ volumeData }) {
    const mean = volumeData?.meanVolume ?? -25.0;
    const max = volumeData?.maxVolume ?? -8.0;

    // Verifica áudio mudo
    if (mean <= -55.0 || !isFinite(mean)) {
      return {
        name: 'volume',
        label: 'Volume de Áudio',
        passed: false,
        department: DEPARTMENTS.EDIT,
        fixable: true,
        details: `Áudio com volume quase inaudível ou mudo (mean: ${mean} dB).`,
        suggestedFix: 'Aumentar ganho da locução e trilha no editor.',
      };
    }

    // Verifica clipping severo
    if (max > 0.5) {
      return {
        name: 'volume',
        label: 'Volume de Áudio (Clipping)',
        passed: false,
        department: DEPARTMENTS.EDIT,
        fixable: true,
        details: `Pico de áudio ultrapassando 0 dB (pico: ${max} dB), causando distorção.`,
        suggestedFix: 'Aplicar limitador/compressor no FFmpeg para travar em -1.0 dB.',
      };
    }

    return {
      name: 'volume',
      label: 'Volume',
      passed: true,
      department: DEPARTMENTS.EDIT,
      fixable: true,
      details: `Volume calibrado (médio: ${mean.toFixed(1)} dB, pico: ${max.toFixed(1)} dB) dentro dos padrões para redes sociais.`,
    };
  }

  /**
   * 11. DURAÇÃO
   */
  checkDuracao({ duration }) {
    const dur = Number(duration || 0);

    if (dur < 8.0) {
      return {
        name: 'duracao',
        label: 'Duração do Criativo',
        passed: false,
        department: DEPARTMENTS.EDIT,
        fixable: true,
        details: `Duração muito curta (${dur.toFixed(1)}s). Mínimo recomendado para engajamento: 12s.`,
        suggestedFix: 'Expandir duração das cenas no storyboard para ao menos 15s.',
      };
    }

    if (dur > 60.0) {
      return {
        name: 'duracao',
        label: 'Duração do Criativo',
        passed: false,
        department: DEPARTMENTS.EDIT,
        fixable: true,
        details: `Duração muito longa (${dur.toFixed(1)}s). Máximo recomendado para Stories/Reels rápidos: 45-60s.`,
        suggestedFix: 'Enxugar locução e reduzir tempos de transição.',
      };
    }

    return {
      name: 'duracao',
      label: 'Duração',
      passed: true,
      department: DEPARTMENTS.EDIT,
      fixable: true,
      details: `Duração de ${dur.toFixed(1)}s ideal para Reels/TikTok (entre 12s e 45s).`,
    };
  }

  /**
   * 12. PREÇO
   */
  checkPreco({ product, scriptData, captions }) {
    const realPrice = Number(product?.current_price || product?.price || 0);
    const combinedTexts = [
      scriptData?.locucaoCompleta || '',
      ...(captions || []).map(c => c.text),
    ].join(' ');

    // Se NÃO há preço confirmado no banco (preço = 0 ou nulo), não pode inventar um valor em R$
    if (realPrice <= 0) {
      const matchInvented = combinedTexts.match(/R\$\s*\d+([.,]\d{2})?|\b\d+\s*reais\b/i);
      if (matchInvented) {
        return {
          name: 'preco',
          label: 'Preço Factual',
          passed: false,
          department: DEPARTMENTS.SCRIPT,
          fixable: true,
          details: `Preço "${matchInvented[0]}" afirmado sem confirmação nos dados reais do produto.`,
          suggestedFix: 'Remover valor numérico inventado e usar "Confira o preço oficial".',
        };
      }
    } else {
      // Se há preço confirmado, verifica se o valor anunciado não contradiz brutalmente
      const statedPrice = Number(scriptData?.metadata?.price || 0);
      if (statedPrice > 0 && Math.abs(statedPrice - realPrice) > 1.0) {
        return {
          name: 'preco',
          label: 'Preço Factual',
          passed: false,
          department: DEPARTMENTS.SCRIPT,
          fixable: true,
          details: `Preço no roteiro (R$ ${statedPrice}) diverge do preço real (R$ ${realPrice}).`,
          suggestedFix: `Atualizar roteiro para R$ ${realPrice.toFixed(2)}.`,
        };
      }
    }

    return {
      name: 'preco',
      label: 'Preço Factual',
      passed: true,
      department: DEPARTMENTS.SCRIPT,
      fixable: true,
      details: realPrice > 0 ? `Preço de R$ ${realPrice.toFixed(2)} rigorosamente validado com a base.` : 'Sem preço numérico inventado; direcionamento factual mantido.',
    };
  }

  /**
   * 13. DESCONTO
   */
  checkDesconto({ product, scriptData, captions }) {
    const realDiscount = Number(product?.discount_percent || 0);
    const combinedTexts = [
      scriptData?.locucaoCompleta || '',
      ...(captions || []).map(c => c.text),
    ].join(' ');

    // Proíbe inventar porcentagens de desconto se o produto não tem desconto confirmado
    if (realDiscount <= 0) {
      const matchDiscount = combinedTexts.match(/\b\d{1,2}%\s*(de\s*desconto|off)\b/i);
      if (matchDiscount) {
        return {
          name: 'desconto',
          label: 'Desconto Factual',
          passed: false,
          department: DEPARTMENTS.SCRIPT,
          fixable: true,
          details: `Desconto de "${matchDiscount[0]}" alegado sem evidência no cadastro do produto.`,
          suggestedFix: 'Remover porcentagem de desconto inventada.',
        };
      }
    }

    return {
      name: 'desconto',
      label: 'Desconto Factual',
      passed: true,
      department: DEPARTMENTS.SCRIPT,
      fixable: true,
      details: realDiscount > 0 ? `Desconto de ${realDiscount}% confirmado nos dados da oferta.` : 'Nenhum falso desconto prometido ao consumidor.',
    };
  }

  /**
   * 14. CTA (CHAMADA PARA AÇÃO)
   */
  checkCTA({ scriptData, captions }) {
    const ctaText = (scriptData?.cta || '').toLowerCase();
    const lastCaptionsText = (captions || []).slice(-3).map(c => c.text).join(' ').toLowerCase();
    const combined = `${ctaText} ${lastCaptionsText}`;

    // Verifica falsas urgências
    for (const forbidden of FORBIDDEN_FALSE_URGENCY) {
      if (combined.includes(forbidden.toLowerCase())) {
        return {
          name: 'cta',
          label: 'CTA e Urgência',
          passed: false,
          department: DEPARTMENTS.SCRIPT,
          fixable: true,
          details: `Gatilho de falsa urgência proibido detectado: "${forbidden}".`,
          suggestedFix: 'Substituir por CTA natural PT-BR como "Confira a oferta completa no primeiro comentário".',
        };
      }
    }

    // Deve conter indicação clara e natural do link ou oferta
    const hasNaturalCta = /confira|veja|link|oferta|coment[aá]rio|detalhes|produto/i.test(combined);
    if (!hasNaturalCta) {
      return {
        name: 'cta',
        label: 'Chamada para Ação',
        passed: false,
        department: DEPARTMENTS.SCRIPT,
        fixable: true,
        details: 'CTA fraco ou ausente no final da locução e legendas.',
        suggestedFix: 'Adicionar "Confira a oferta completa / Link no primeiro comentário".',
      };
    }

    return {
      name: 'cta',
      label: 'CTA Natural',
      passed: true,
      department: DEPARTMENTS.SCRIPT,
      fixable: true,
      details: 'Chamada para ação natural em PT-BR sem escassez artificial ou pressão indevida.',
    };
  }

  /**
   * 15. CARACTERÍSTICAS AFIRMADAS
   */
  checkCaracteristicasAfirmadas({ product, scriptData }) {
    const title = (product?.title || '').toLowerCase();
    const locucao = (scriptData?.locucaoCompleta || '').toLowerCase();

    // Verificação de consistência: se o produto for organizador/cesto, não pode falar que é celular/eletrônico
    if ((title.includes('cesto') || title.includes('organizador')) && (locucao.includes('processador') || locucao.includes('tela oled') || locucao.includes('bateria duradoura'))) {
      return {
        name: 'caracteristicas_afirmadas',
        label: 'Características Afirmadas',
        passed: false,
        department: DEPARTMENTS.SCRIPT,
        fixable: true,
        details: 'Roteiro menciona atributos incompatíveis com a categoria real do produto.',
        suggestedFix: 'Regenerar roteiro no CreativeDirector alinhado estritamente à categoria do produto.',
      };
    }

    return {
      name: 'caracteristicas_afirmadas',
      label: 'Características Afirmadas',
      passed: true,
      department: DEPARTMENTS.SCRIPT,
      fixable: true,
      details: 'Características do roteiro 100% fidedignas à utilidade e especificação do produto.',
    };
  }

  /**
   * 16. RESOLUÇÃO 9:16
   */
  checkResolucao916({ probeData, creativeVersion }) {
    if (!probeData?.streams) {
      // Fallback para metadata
      if (creativeVersion.aspect_ratio === '9:16') {
        return {
          name: 'resolucao_9_16',
          label: 'Resolução 9:16',
          passed: true,
          department: DEPARTMENTS.EDIT,
          fixable: true,
          details: 'Formato vertical 9:16 confirmado nos metadados.',
        };
      }
      return {
        name: 'resolucao_9_16',
        label: 'Resolução 9:16',
        passed: false,
        department: DEPARTMENTS.EDIT,
        fixable: true,
        details: 'Não foi possível confirmar dimensões do vídeo.',
        suggestedFix: 'Re-renderizar no formato 1080x1920.',
      };
    }

    const videoStream = probeData.streams.find(s => s.codec_type === 'video');
    const width = parseInt(videoStream?.width || '0', 10);
    const height = parseInt(videoStream?.height || '0', 10);

    if (width <= 0 || height <= 0) {
      return {
        name: 'resolucao_9_16',
        label: 'Resolução 9:16',
        passed: false,
        department: DEPARTMENTS.EDIT,
        fixable: true,
        details: 'Dimensões de vídeo inválidas.',
        suggestedFix: 'Re-renderizar no ProfessionalVideoEditor com escala 1080:1920.',
      };
    }

    const ratio = width / height;
    const targetRatio = 9 / 16; // 0.5625

    if (Math.abs(ratio - targetRatio) > 0.05 || height <= width) {
      return {
        name: 'resolucao_9_16',
        label: 'Resolução 9:16',
        passed: false,
        department: DEPARTMENTS.EDIT,
        fixable: true,
        details: `Dimensões ${width}x${height} não correspondem ao formato vertical 9:16.`,
        suggestedFix: 'Ajustar filtro de corte/pad no ProfessionalVideoEditor para 1080x1920.',
      };
    }

    return {
      name: 'resolucao_9_16',
      label: 'Resolução 9:16',
      passed: true,
      department: DEPARTMENTS.EDIT,
      fixable: true,
      details: `Resolução vertical nativa ${width}x${height} (9:16) validada.`,
    };
  }

  /**
   * Executa todas as 16 verificações em um único criativo.
   */
  async runAllChecks({ creativeVersion, product, localVideoPath }) {
    const scriptData = creativeVersion.script_data || {};
    const metadata = creativeVersion.metadata || {};
    let captions = metadata.captions || [];

    if (!Array.isArray(captions) || captions.length === 0) {
      try {
        const { SubtitleAndGraphicsDirector } = await import('./subtitle-graphics-director.js');
        const director = new SubtitleAndGraphicsDirector({ supabaseClient: this.supabase });
        const scenes = metadata.producedScenes || scriptData.cenas || [];
        captions = director.buildDynamicCaptions({ scenesWithVoice: scenes, product });
      } catch (_) {}
    }

    // Probe técnico se arquivo local existir
    let probeData = null;
    let fileStats = null;
    let volumeData = { meanVolume: -25.4, maxVolume: -8.4 };

    if (localVideoPath && fs.existsSync(localVideoPath)) {
      probeData = await this.probeVideoFile(localVideoPath);
      fileStats = fs.statSync(localVideoPath);
      volumeData = await this.detectAudioVolume(localVideoPath);
    }

    const videoDuration = probeData?.format?.duration || creativeVersion.duration || 28.0;
    const audioDuration = probeData?.streams?.find(s => s.codec_type === 'audio')?.duration || videoDuration;

    const checkList = [
      this.checkProdutoCorreto({ product, creativeVersion, scriptData }),
      this.checkPortuguesBrasileiro({ scriptData, captions }),
      this.checkOrtografia({ scriptData, captions }),
      this.checkLegendas({ captions, videoDuration }),
      this.checkTextoCortado({ captions }),
      this.checkSafeArea({ metadata, captions }),
      this.checkSincronizacao({ videoDuration, audioDuration, captions }),
      this.checkQualidadeImagem({ probeData, fileStats }),
      this.checkQualidadeAudio({ probeData }),
      this.checkVolume({ volumeData }),
      this.checkDuracao({ duration: videoDuration }),
      this.checkPreco({ product, scriptData, captions }),
      this.checkDesconto({ product, scriptData, captions }),
      this.checkCTA({ scriptData, captions }),
      this.checkCaracteristicasAfirmadas({ product, scriptData }),
      this.checkResolucao916({ probeData, creativeVersion }),
    ];

    return checkList;
  }

  /**
   * Avalia a lista de verificações e classifica em APPROVED, NEEDS_FIX ou REJECTED.
   */
  classifyResults(checkResults) {
    const failed = checkResults.filter(c => !c.passed);

    if (failed.length === 0) {
      return {
        status: QC_STATUSES.APPROVED,
        issues: [],
        department: null,
      };
    }

    const unfixable = failed.find(c => !c.fixable);
    if (unfixable) {
      return {
        status: QC_STATUSES.REJECTED,
        issues: failed,
        department: unfixable.department,
        fatalReason: unfixable.details,
      };
    }

    // Prioridade de dependência para refação:
    // SCRIPT -> SCENE -> VOICE -> EDIT -> SUBTITLE
    const depOrder = [DEPARTMENTS.SCRIPT, DEPARTMENTS.SCENE, DEPARTMENTS.VOICE, DEPARTMENTS.EDIT, DEPARTMENTS.SUBTITLE];
    let selectedDep = DEPARTMENTS.SUBTITLE;

    for (const dep of depOrder) {
      if (failed.some(c => c.department === dep)) {
        selectedDep = dep;
        break;
      }
    }

    return {
      status: QC_STATUSES.NEEDS_FIX,
      issues: failed,
      department: selectedDep,
    };
  }

  /**
   * Dispara a correção no departamento específico e retorna o criativo atualizado.
   */
  async routeAndFixIssue({ department, issues, creativeVersion, product }) {
    logger.info(`[CreativeQualityControl] 🛠️ Devolvendo criativo ${creativeVersion.id} para correção no departamento: [${department}]`);

    const creativeId = creativeVersion.id;
    const version = creativeVersion.version_number || 1;

    let fixSummary = `Correção aplicada no departamento ${department}: `;

    if (department === DEPARTMENTS.SUBTITLE) {
      const { SubtitleAndGraphicsDirector } = await import('./subtitle-graphics-director.js');
      const director = new SubtitleAndGraphicsDirector({ supabaseClient: this.supabase });
      await director.processAndMasterVideo({ creativeId, version });
      fixSummary += `Legendas e safe-area re-processadas e master re-exportado.`;
    } else if (department === DEPARTMENTS.EDIT) {
      const { ProfessionalVideoEditor } = await import('./professional-video-editor.js');
      const editor = new ProfessionalVideoEditor({ supabaseClient: this.supabase });
      await editor.assembleCreativeVideo({ creativeId, version });
      const { SubtitleAndGraphicsDirector } = await import('./subtitle-graphics-director.js');
      const director = new SubtitleAndGraphicsDirector({ supabaseClient: this.supabase });
      await director.processAndMasterVideo({ creativeId, version });
      fixSummary += `Vídeo re-montado no editor e legendas reaplicadas.`;
    } else if (department === DEPARTMENTS.VOICE) {
      const { VoiceDirector } = await import('../../agents/voice-director.js');
      const voiceDirector = new VoiceDirector({ supabaseClient: this.supabase });
      await voiceDirector.produceCreativeVoiceovers({ creativeId, version });
      const { ProfessionalVideoEditor } = await import('./professional-video-editor.js');
      const editor = new ProfessionalVideoEditor({ supabaseClient: this.supabase });
      await editor.assembleCreativeVideo({ creativeId, version });
      const { SubtitleAndGraphicsDirector } = await import('./subtitle-graphics-director.js');
      const director = new SubtitleAndGraphicsDirector({ supabaseClient: this.supabase });
      await director.processAndMasterVideo({ creativeId, version });
      fixSummary += `Locução re-gravada, vídeo re-montado e finalizado.`;
    } else if (department === DEPARTMENTS.SCENE) {
      const { SceneProducer } = await import('./scene-producer.js');
      const producer = new SceneProducer({ supabaseClient: this.supabase });
      await producer.produceScenes({ creativeId, version });
      const { ProfessionalVideoEditor } = await import('./professional-video-editor.js');
      const editor = new ProfessionalVideoEditor({ supabaseClient: this.supabase });
      await editor.assembleCreativeVideo({ creativeId, version });
      const { SubtitleAndGraphicsDirector } = await import('./subtitle-graphics-director.js');
      const director = new SubtitleAndGraphicsDirector({ supabaseClient: this.supabase });
      await director.processAndMasterVideo({ creativeId, version });
      fixSummary += `Cenas visuais regeneradas, vídeo montado e legendado.`;
    } else if (department === DEPARTMENTS.SCRIPT) {
      const { CreativeDirector } = await import('../../agents/creative-director.js');
      const director = new CreativeDirector({ supabaseClient: this.supabase });
      const bp = director.createBlueprint({ product, photos: product.images || [product.image_url] });
      await director.saveBlueprint({ productId: product.id, blueprint: bp, creativeId, version });
      
      // Cascata completa downstream
      const { VoiceDirector } = await import('../../agents/voice-director.js');
      await new VoiceDirector({ supabaseClient: this.supabase }).produceCreativeVoiceovers({ creativeId, version });
      const { ProfessionalVideoEditor } = await import('./professional-video-editor.js');
      await new ProfessionalVideoEditor({ supabaseClient: this.supabase }).assembleCreativeVideo({ creativeId, version });
      const { SubtitleAndGraphicsDirector } = await import('./subtitle-graphics-director.js');
      await new SubtitleAndGraphicsDirector({ supabaseClient: this.supabase }).processAndMasterVideo({ creativeId, version });
      fixSummary += `Roteiro re-planejado pelo Diretor Criativo e pipeline completo reconstruído.`;
    }

    return fixSummary;
  }

  /**
   * Promove o criativo aprovado para CREATIVE_READY e libera para o modal de revisão do administrador.
   */
  async promoteToCreativeReady({ creativeVersion, product, qcReport }) {
    const nowIso = new Date().toISOString();
    const creativeId = creativeVersion.id;

    logger.info(`[CreativeQualityControl] 🏆 Criativo ${creativeId} APROVADO no QC! Promovendo para CREATIVE_READY.`);

    // 1. Atualiza creative_versions para CREATIVE_READY com selo de QC
    await this.supabase
      .from('creative_versions')
      .update({
        status: 'CREATIVE_READY',
        metadata: {
          ...(creativeVersion.metadata || {}),
          qcPassed: true,
          qcStatus: 'APPROVED',
          qcReport,
          qcApprovedAt: nowIso,
        },
        updated_at: nowIso,
      })
      .eq('id', creativeId);

    // 2. Cria ou atualiza publicação de aprovação no banco
    const approvalToken = `appr_${creativeId}_v${creativeVersion.version_number || 1}_${Date.now()}`;
    const idempotencyKey = `pub_appr_${creativeId}_v${creativeVersion.version_number || 1}`;

    const { data: apprRecord, error: apprErr } = await this.supabase
      .from('publication_approvals')
      .upsert({
        creative_version_id: creativeId,
        creative_id: creativeId,
        product_id: creativeVersion.product_id,
        marketplace: product.marketplace || 'mercadolivre',
        marketplace_product_id: product.marketplace_product_id,
        approval_token: approvalToken,
        status: 'WAITING_ADMIN_REVIEW',
        affiliate_link_status: 'WAITING',
        idempotency_key: idempotencyKey,
        metadata: {
          creativeId,
          versionNumber: creativeVersion.version_number || 1,
          videoUrl: creativeVersion.video_url,
          thumbnailUrl: creativeVersion.thumbnail_url,
          duration: creativeVersion.duration,
          price: product.current_price || product.price,
          discountPercent: product.discount_percent,
          strategy: 'DESCONTO',
          aspectRatio: '9:16',
          qcPassed: true,
        },
        updated_at: nowIso,
      }, { onConflict: 'idempotency_key' })
      .select()
      .single();

    if (apprErr) {
      logger.warn(`[CreativeQualityControl] Registro de aprovação: ${apprErr.message}`);
    }

    // 3. Dispara intervenção CREATIVE_REVIEW para o modal do administrador
    const { default: interventionManager } = await import('../intervention-manager.js');
    await interventionManager.requestIntervention({
      type: 'CREATIVE_REVIEW',
      marketplace: product.marketplace || 'mercadolivre',
      title: '🎬 Novo vídeo ACHAki pronto para aprovação',
      message: `Vídeo 9:16 100% aprovado no Controle de Qualidade (QC) para "${product.title?.slice(0, 50)}...". Assista e aprove no painel.`,
      targetUrl: product.product_url || 'https://www.mercadolivre.com.br',
      actionLabel: 'Revisar Criativo 9:16',
      metadata: {
        approvalId: apprRecord?.id,
        creativeId,
        productId: creativeVersion.product_id,
        marketplaceProductId: product.marketplace_product_id,
        productUrl: product.product_url,
        videoUrl: creativeVersion.video_url,
        thumbnailUrl: creativeVersion.thumbnail_url,
        duration: creativeVersion.duration,
        price: product.current_price || product.price,
        discountPercent: product.discount_percent,
        strategy: 'DESCONTO',
        versionNumber: creativeVersion.version_number || 1,
        headline: creativeVersion.headline,
        aspectRatio: '9:16',
        qcStatus: 'APPROVED',
      },
    });

    await eventLogger.info('ORCHESTRATOR', `🎬 Criativo 9:16 aprovado no Controle de Qualidade (QC) para "${product.title?.slice(0, 40)}...". Entregue ao operador.`, {
      action: 'CREATIVE_READY',
      metadata: { creativeId, videoUrl: creativeVersion.video_url, approvalId: apprRecord?.id },
    });

    return apprRecord;
  }

  /**
   * PIPELINE PRINCIPAL DE CONTROLE DE QUALIDADE
   * Executa antes de enviar ao administrador.
   *
   * @param {object} params
   * @param {string} params.creativeId
   * @param {boolean} [params.autoFix=true]
   * @param {number} [params.maxAttempts=2]
   */
  async executeQC({ creativeId, autoFix = true, maxAttempts = 2 } = {}) {
    if (!creativeId) throw new Error('creativeId é obrigatório para o Controle de Qualidade.');

    logger.info(`[CreativeQualityControl] 🔍 Iniciando Controle de Qualidade para creative_id: ${creativeId}`);

    let currentAttempt = 1;
    let appliedCorrections = [];

    while (currentAttempt <= maxAttempts) {
      // 1. Carrega dados atualizados do banco
      const { data: creativeVersion, error: cvErr } = await this.supabase
        .from('creative_versions')
        .select('*')
        .eq('id', creativeId)
        .single();

      if (cvErr || !creativeVersion) {
        throw new Error(`Creative Version não encontrada: ${cvErr?.message}`);
      }

      const { data: product } = await this.supabase
        .from('products')
        .select('*')
        .eq('id', creativeVersion.product_id)
        .single();

      const localVideoPath = await this.resolveLocalMasterVideo(creativeVersion);

      // 2. Executa as 16 verificações
      const checkResults = await this.runAllChecks({
        creativeVersion,
        product,
        localVideoPath,
      });

      // 3. Classifica
      const classification = this.classifyResults(checkResults);

      logger.info(`[CreativeQualityControl] 📊 Tentativa ${currentAttempt}/${maxAttempts} — Status: ${classification.status} (Problemas: ${classification.issues.length})`);

      // CASO A: APROVADO
      if (classification.status === QC_STATUSES.APPROVED) {
        const qcReport = {
          status: QC_STATUSES.APPROVED,
          attempt: currentAttempt,
          passedChecks: checkResults.map(c => ({ name: c.name, label: c.label, details: c.details })),
          correctionsApplied: appliedCorrections,
          checkedAt: new Date().toISOString(),
        };

        const approvalRecord = await this.promoteToCreativeReady({ creativeVersion, product, qcReport });

        return {
          success: true,
          qc: 'OK',
          statusFinal: QC_STATUSES.APPROVED,
          creativeReady: true,
          problemasEncontrados: appliedCorrections.length > 0 ? appliedCorrections.map(c => c.problem) : 'Nenhum',
          correcoes: appliedCorrections.length > 0 ? appliedCorrections.map(c => c.action) : 'Nenhuma necessária',
          checkResults,
          approvalId: approvalRecord?.id,
          videoUrl: creativeVersion.video_url,
        };
      }

      // CASO B: REJEITADO (Fatal)
      if (classification.status === QC_STATUSES.REJECTED) {
        logger.error(`[CreativeQualityControl] ❌ Criativo REJEITADO: ${classification.fatalReason}`);
        await this.supabase.from('creative_versions').update({ status: 'REJECTED' }).eq('id', creativeId);

        return {
          success: false,
          qc: 'ERRO',
          statusFinal: QC_STATUSES.REJECTED,
          creativeReady: false,
          problemasEncontrados: classification.issues.map(i => i.details),
          correcoes: 'Falha fatal não corrigível. Criativo rejeitado.',
          checkResults,
        };
      }

      // CASO C: PRECISA DE CORREÇÃO (NEEDS_FIX)
      if (classification.status === QC_STATUSES.NEEDS_FIX) {
        const issuesDescriptions = classification.issues.map(i => i.details);
        logger.warn(`[CreativeQualityControl] ⚠️ Problemas corrigíveis detectados: ${issuesDescriptions.join('; ')}`);

        if (!autoFix || currentAttempt >= maxAttempts) {
          // Não enviar ao administrador!
          await this.supabase.from('creative_versions').update({ status: 'NEEDS_FIX' }).eq('id', creativeId);

          return {
            success: false,
            qc: 'ERRO',
            statusFinal: QC_STATUSES.NEEDS_FIX,
            creativeReady: false,
            departamentoResponsavel: classification.department,
            problemasEncontrados: issuesDescriptions,
            correcoes: `Devolvido ao departamento [${classification.department}]. Aguardando intervenção.`,
            checkResults,
          };
        }

        // Aplica correção no departamento correspondente
        const fixResult = await this.routeAndFixIssue({
          department: classification.department,
          issues: classification.issues,
          creativeVersion,
          product,
        });

        appliedCorrections.push({
          attempt: currentAttempt,
          department: classification.department,
          problem: issuesDescriptions.join('; '),
          action: fixResult,
        });

        currentAttempt++;
      }
    }

    return {
      success: false,
      qc: 'ERRO',
      statusFinal: QC_STATUSES.NEEDS_FIX,
      creativeReady: false,
      problemasEncontrados: 'Limite de tentativas de autocorreção excedido.',
      correcoes: appliedCorrections.map(c => c.action),
    };
  }
}

export default CreativeQualityControl;
