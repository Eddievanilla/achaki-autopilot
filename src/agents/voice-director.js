/**
 * ACHAki Autopilot — VoiceDirector (Etapa 3: Direção de Voz PT-BR)
 *
 * Responsável pela direção artística e técnica da locução publicitária
 * cena por cena a partir do Creative Blueprint.
 *
 * Requisitos:
 * - Português brasileiro (PT-BR) natural.
 * - Pronúncia brasileira perfeita (converte moedas, %, siglas e medidas).
 * - Ritmo publicitário com pausas e ênfases adequadas a cada cena.
 * - Suporte a 5 estilos: NATURAL, ENERGÉTICO, ELEGANTE, CONVERSACIONAL, URGENTE.
 * - Suporte a vozes masculina e feminina.
 * - Ajuste fino de velocidade e prosódia.
 * - Geração de áudio separado por cena: voice_scene_01.mp3, voice_scene_02.mp3...
 * - Custo de API: R$0 (utiliza msedge-tts com vozes neurais locais de alta definição).
 * - NÃO monta vídeo final ainda.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { createClient } from '@supabase/supabase-js';
import logger from '../utils/logger.js';

const execAsync = promisify(exec);

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';
const defaultSupabase = createClient(supabaseUrl, supabaseKey);

export const PT_BR_VOICES = {
  FEMALE_PRIMARY: 'pt-BR-FranciscaNeural', // Natural, acolhedora e expressiva
  FEMALE_YOUTH: 'pt-BR-ThalitaNeural',     // Jovem, vibrante, estilo TikTok
  MALE_PRIMARY: 'pt-BR-AntonioNeural',     // Confiável, firme, autoridade comercial
};

export const VOICE_STYLES = {
  NATURAL: {
    rate: '+2%',
    pitch: '+0Hz',
    pauseDelayMs: 250,
    cadence: 'fluida',
    description: 'Ritmo equilibrado, amigável e confiável.',
  },
  ENERGETICO: {
    rate: '+10%',
    pitch: '+2Hz',
    pauseDelayMs: 180,
    cadence: 'vibrante',
    description: 'Vibrante, dinâmico e de alto impacto para retenção de feed.',
  },
  ELEGANTE: {
    rate: '-4%',
    pitch: '-1Hz',
    pauseDelayMs: 320,
    cadence: 'pausada',
    description: 'Suave, seguro e focado em detalhes e sofisticação.',
  },
  CONVERSACIONAL: {
    rate: '+4%',
    pitch: '+1Hz',
    pauseDelayMs: 220,
    cadence: 'espontanea',
    description: 'Estilo recomendação genuína de amigo, casual e empático.',
  },
  URGENTE: {
    rate: '+14%',
    pitch: '+3Hz',
    pauseDelayMs: 150,
    cadence: 'acelerada',
    description: 'Ágil e direto ao ponto, mantendo estrita veracidade sem escassez artificial.',
  },
};

export class VoiceDirector {
  constructor({ supabaseClient = defaultSupabase, outputBaseDir = 'data/produced_scenes' } = {}) {
    this.supabase = supabaseClient;
    this.outputBaseDir = path.resolve(outputBaseDir);
    this._ensureDir(this.outputBaseDir);
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  /**
   * Normaliza textos brutos para pronúncia perfeita em Português do Brasil.
   * Converte valores de moeda, percentuais, siglas e pontuações para fala natural.
   *
   * @param {string} text - Texto original da locução
   * @returns {string} Texto foneticamente adaptado para fala natural PT-BR
   */
  normalizePortuguesePronunciation(text) {
    if (!text || typeof text !== 'string') return '';

    let clean = text
      // Remove emojis gráficos que poderiam ser lidos de forma estranha
      .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      .replace(/[👇🔥⭐✓⚡💎⏱️🎁🎬]/g, '')
      .trim();

    // 1. Converte Valores Monetários: R$ XX,XX ou R$ XX
    clean = clean.replace(/R\$\s*(\d+),(\d{2})/gi, (match, reais, centavos) => {
      const centavosNum = parseInt(centavos, 10);
      if (centavosNum === 0) {
        return `${reais} reais`;
      }
      return `${reais} reais e ${centavosNum} centavos`;
    });
    clean = clean.replace(/R\$\s*(\d+)/gi, '$1 reais');

    // 2. Converte Percentuais: XX% -> XX por cento
    clean = clean.replace(/(\d+)%\s*OFF/gi, '$1 por cento de desconto');
    clean = clean.replace(/(\d+)%/gi, '$1 por cento');

    // 3. Converte Parcelamento: 10x ou 12x -> 10 vezes
    clean = clean.replace(/(\d+)x\b/gi, '$1 vezes');

    // 4. Converte Unidades e Medidas comuns
    clean = clean.replace(/\bkg\b/gi, 'quilos');
    clean = clean.replace(/\bg\b/gi, 'gramas');
    clean = clean.replace(/\bcm\b/gi, 'centímetros');
    clean = clean.replace(/\bml\b/gi, 'mililitros');
    clean = clean.replace(/\bunid\b/gi, 'unidades');

    // 5. Converte Siglas de Marketplaces e Termos
    clean = clean.replace(/\bML\b/g, 'Mercado Livre');
    clean = clean.replace(/\bCTA\b/gi, 'chamada para ação');
    clean = clean.replace(/\bapp\b/gi, 'aplicativo');
    clean = clean.replace(/\bbio\b/gi, 'biografia');

    // 6. Cadência e Pontuação Prosódica (adiciona micropausas naturais)
    clean = clean
      .replace(/\s+/g, ' ')
      .replace(/\s*([,;])\s*/g, '$1 ')
      .replace(/\s*([.!?])\s*/g, '$1 ')
      .replace(/([a-zA-Z0-9])-(?=[a-zA-Z])/g, '$1 ') // Hífens que causam travamento
      .trim();

    return clean;
  }

  /**
   * Prepara o texto específico de cada cena com entonação e ênfase compatível.
   *
   * @param {object} params
   * @param {object} params.scene - Cena do storyboard
   * @param {number} params.index - Índice da cena
   * @param {number} params.totalScenes - Total de cenas
   * @param {string} params.styleKey - Chave do estilo escolhido
   * @returns {{ preparedText: string, emotionTag: string, sceneEmphasis: string }}
   */
  prepareSceneVoiceText({ scene, index, totalScenes, styleKey = 'NATURAL' }) {
    const rawLocucao = scene.locucao || scene.textoTela || '';
    let normalized = this.normalizePortuguesePronunciation(rawLocucao);

    const sceneNum = index + 1;
    let emotionTag = 'equilibrado';
    let sceneEmphasis = 'clareza';

    if (sceneNum === 1) {
      // Gancho (0 a 3s): Tom intrigante e energético de abertura
      emotionTag = 'gancho_impacto';
      sceneEmphasis = 'atenção imediata';
      if (!normalized.endsWith('!') && !normalized.endsWith('?')) {
        normalized += '!';
      }
    } else if (sceneNum === 2) {
      // Problema / Conexão: Tom empático e de identificação
      emotionTag = 'empatia';
      sceneEmphasis = 'conexão com a necessidade';
    } else if (sceneNum === 3) {
      // Solução / Qualidade: Tom de autoridade e confiabilidade
      emotionTag = 'confianca';
      sceneEmphasis = 'qualidade comprovada';
    } else if (sceneNum === 4) {
      // Oferta / Preço: Tom animado com a economia real
      emotionTag = 'entusiasmo';
      sceneEmphasis = 'oportunidade de preço';
      if (!normalized.endsWith('!')) normalized += '!';
    } else if (sceneNum === totalScenes || sceneNum === 5) {
      // Chamada para Ação (CTA): Tom conclusivo, firme e orientador
      emotionTag = 'cta_direto';
      sceneEmphasis = 'ação imediata nos comentários';
      if (!normalized.endsWith('!')) normalized += '!';
    }

    return {
      preparedText: normalized,
      emotionTag,
      sceneEmphasis,
    };
  }

  /**
   * Resolve as configurações técnicas de áudio a partir das opções fornecidas.
   */
  resolveVoiceConfig({ gender = 'FEMALE', style = 'NATURAL', customSpeed = null } = {}) {
    const normGender = String(gender).toUpperCase();
    const normStyle = String(style).toUpperCase();

    // Seleção de voz
    let voiceName = PT_BR_VOICES.FEMALE_PRIMARY;
    if (normGender === 'MALE' || normGender === 'MASCULINA') {
      voiceName = PT_BR_VOICES.MALE_PRIMARY;
    } else if (normStyle === 'ENERGÉTICO' || normStyle === 'ENERGETICO') {
      voiceName = PT_BR_VOICES.FEMALE_YOUTH;
    }

    // Configuração de estilo prosódico
    const styleConfig = VOICE_STYLES[normStyle] || VOICE_STYLES.NATURAL;

    // Velocidade (rate)
    let rate = styleConfig.rate;
    if (customSpeed) {
      const spdNum = parseFloat(customSpeed);
      if (!isNaN(spdNum)) {
        const delta = Math.round((spdNum - 1.0) * 100);
        rate = `${delta >= 0 ? '+' : ''}${delta}%`;
      }
    }

    return {
      voiceName,
      gender: normGender === 'MALE' || normGender === 'MASCULINA' ? 'MALE' : 'FEMALE',
      styleName: normStyle,
      styleConfig,
      rate,
      pitch: styleConfig.pitch,
    };
  }

  /**
   * Mede com precisão a duração em segundos de um arquivo de áudio via FFprobe.
   */
  async getAudioDuration(audioPath) {
    try {
      const normPath = audioPath.replace(/\\/g, '/');
      const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${normPath}"`;
      const { stdout } = await execAsync(cmd);
      const dur = parseFloat(stdout.trim());
      return isNaN(dur) ? 3.0 : Math.round(dur * 100) / 100;
    } catch (_) {
      return 3.0;
    }
  }

  /**
   * Produz o arquivo de áudio de uma cena individual (voice_scene_0X.mp3).
   *
   * @param {object} params
   * @returns {Promise<object>} Dados da locução gerada para a cena
   */
  async produceSceneVoice({
    scene,
    index,
    sceneId,
    creativeId,
    creativeVersion,
    voiceConfig,
    sceneOutputDir,
  }) {
    const { preparedText, emotionTag, sceneEmphasis } = this.prepareSceneVoiceText({
      scene,
      index,
      totalScenes: 5,
      styleKey: voiceConfig.styleName,
    });

    const filename = sceneId.startsWith('voice_') ? `${sceneId}.mp3` : `voice_${sceneId}.mp3`;
    const finalAudioPath = path.join(sceneOutputDir, filename);
    const tempDir = path.join(sceneOutputDir, `temp_tts_${sceneId}_${Date.now()}`);
    this._ensureDir(tempDir);

    logger.info(`[VoiceDirector] 🎙️ Sintetizando ${sceneId} [Voz: ${voiceConfig.voiceName}] [Estilo: ${voiceConfig.styleName}] (${preparedText.length} caracteres)...`);

    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voiceConfig.voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

      const result = await tts.toFile(tempDir, preparedText, {
        rate: voiceConfig.rate,
        pitch: voiceConfig.pitch,
      });

      if (!result.audioFilePath || !fs.existsSync(result.audioFilePath)) {
        throw new Error(`Falha ao gerar arquivo de áudio para ${sceneId}`);
      }

      // Move para o nome final organizado
      fs.renameSync(result.audioFilePath, finalAudioPath);

      // Limpa pasta temporária
      try {
        fs.rmdirSync(tempDir, { recursive: true });
      } catch (_) {}

      // Mede duração exata via FFprobe
      const exactDuration = await this.getAudioDuration(finalAudioPath);

      // Gera data URL para reprodução imediata no frontend sem requisição extra
      let audioDataUrl = null;
      if (fs.existsSync(finalAudioPath)) {
        const audioBuffer = fs.readFileSync(finalAudioPath);
        audioDataUrl = `data:audio/mp3;base64,${audioBuffer.toString('base64')}`;
      }

      const stats = fs.statSync(finalAudioPath);

      logger.info(`[VoiceDirector] ✅ ${sceneId} locução gerada: ${filename} (${exactDuration}s, ${(stats.size / 1024).toFixed(1)} KB)`);

      return {
        creativeId,
        creativeVersion,
        sceneId,
        sceneNumber: index + 1,
        filename,
        audioPath: finalAudioPath,
        audioDataUrl,
        durationSeconds: exactDuration,
        fileSizeBytes: stats.size,
        voiceName: voiceConfig.voiceName,
        gender: voiceConfig.gender,
        style: voiceConfig.styleName,
        rate: voiceConfig.rate,
        emotionTag,
        sceneEmphasis,
        preparedText,
        originalLocucao: scene.locucao || '',
        status: 'PRODUCED',
        producedAt: new Date().toISOString(),
      };
    } catch (err) {
      logger.error(`[VoiceDirector] ❌ Erro ao sintetizar áudio de ${sceneId}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Executa a Direção de Voz cena a cena para todo o storyboard.
   *
   * @param {object} params
   * @param {string} params.creativeId - ID do criativo na tabela creative_versions
   * @param {number} [params.creativeVersion=1] - Versão do criativo
   * @param {object} params.blueprint - Creative Blueprint gerado na Etapa 1
   * @param {object} [params.config={}] - Configurações: { gender: 'FEMALE'|'MALE', style: 'NATURAL'|..., speed: 1.0 }
   * @returns {Promise<object>} Relatório completo da produção de áudio
   */
  async directAllScenes({
    creativeId,
    creativeVersion = 1,
    blueprint,
    config = {},
  }) {
    if (!blueprint) throw new Error('Creative Blueprint é obrigatório para o VoiceDirector.');
    if (!Array.isArray(blueprint.cenas) || blueprint.cenas.length === 0) {
      throw new Error('Nenhuma cena encontrada no Creative Blueprint.');
    }

    const voiceConfig = this.resolveVoiceConfig({
      gender: config.gender || 'FEMALE',
      style: config.style || 'NATURAL',
      customSpeed: config.speed || config.rate || null,
    });

    logger.info(`[VoiceDirector] 🚀 Iniciando Direção de Voz PT-BR [Voz: ${voiceConfig.voiceName}] [Estilo: ${voiceConfig.styleName}] para Creative ID: ${creativeId}`);

    // Diretório de saída vinculado ao criativo
    const safeCreativeId = creativeId ? String(creativeId).replace(/[^a-zA-Z0-9_-]/g, '') : `temp_${Date.now()}`;
    const sceneOutputDir = path.join(this.outputBaseDir, `${safeCreativeId}_v${creativeVersion}`);
    this._ensureDir(sceneOutputDir);

    const producedVoices = [];
    const errors = [];
    let duracaoTotalVoz = 0;

    for (let i = 0; i < blueprint.cenas.length; i++) {
      const scene = blueprint.cenas[i];
      const sceneNumber = i + 1;
      const sceneId = `voice_scene_${String(sceneNumber).padStart(2, '0')}`;

      try {
        const voiceResult = await this.produceSceneVoice({
          scene,
          index: i,
          sceneId,
          creativeId,
          creativeVersion,
          voiceConfig,
          sceneOutputDir,
        });

        producedVoices.push(voiceResult);
        duracaoTotalVoz += voiceResult.durationSeconds;
      } catch (err) {
        errors.push({ sceneId, error: err.message });
      }
    }

    duracaoTotalVoz = Math.round(duracaoTotalVoz * 100) / 100;

    // Salva manifesto local de locução
    const manifestPath = path.join(sceneOutputDir, 'voice_manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      creativeId,
      creativeVersion,
      language: 'pt-BR',
      voiceName: voiceConfig.voiceName,
      gender: voiceConfig.gender,
      style: voiceConfig.styleName,
      totalScenes: blueprint.cenas.length,
      scenesProduced: producedVoices.length,
      duracaoTotalVoz,
      apiCost: 'R$0',
      producedVoices,
      createdAt: new Date().toISOString(),
    }, null, 2));

    // Atualiza a tabela creative_versions com as locuções por cena
    if (creativeId) {
      try {
        const { data: currentVersion } = await this.supabase
          .from('creative_versions')
          .select('script_data, metadata')
          .eq('id', creativeId)
          .single();

        const updatedScriptData = currentVersion?.script_data || blueprint;
        if (Array.isArray(updatedScriptData.cenas)) {
          updatedScriptData.cenas = updatedScriptData.cenas.map((c, idx) => {
            const v = producedVoices[idx];
            return {
              ...c,
              voiceId: v?.sceneId || `voice_scene_${String(idx + 1).padStart(2, '0')}`,
              voiceAudioFilename: v?.filename || null,
              voiceAudioDataUrl: v?.audioDataUrl || null,
              voiceDurationSeconds: v?.durationSeconds || null,
              voicePreparedText: v?.preparedText || null,
              voiceStatus: v ? 'PRODUCED' : 'FAILED',
            };
          });
        }

        await this.supabase
          .from('creative_versions')
          .update({
            script_data: updatedScriptData,
            metadata: {
              ...(currentVersion?.metadata || {}),
              storyboard: updatedScriptData.cenas,
              voiceProduction: {
                status: errors.length === 0 ? 'COMPLETED' : 'PARTIAL_ERROR',
                language: 'pt-BR',
                voice: voiceConfig.voiceName,
                gender: voiceConfig.gender,
                style: voiceConfig.styleName,
                totalScenes: blueprint.cenas.length,
                scenesProduced: producedVoices.length,
                duracaoTotalVoz,
                apiCost: 'R$0',
                completedAt: new Date().toISOString(),
              },
            },
          })
          .eq('id', creativeId);

        logger.info(`[VoiceDirector] 📋 Storyboard atualizado com locução individual para ${producedVoices.length} cenas!`);
      } catch (dbErr) {
        logger.warn(`[VoiceDirector] Falha ao atualizar creative_versions no banco: ${dbErr.message}`);
      }
    }

    return {
      success: errors.length === 0,
      directorStatus: errors.length === 0 ? 'OK' : 'ERRO',
      language: 'pt-BR',
      voice: voiceConfig.voiceName,
      gender: voiceConfig.gender,
      style: voiceConfig.styleName,
      totalScenes: blueprint.cenas.length,
      scenesWithVoice: producedVoices.length,
      duracaoTotalVoz,
      apiCost: 'R$0',
      errorsCount: errors.length,
      errorDetails: errors,
      voices: producedVoices,
      videoFinalGerado: false, // Estritamente NÃO monta vídeo final nesta etapa
    };
  }
}

export default VoiceDirector;
