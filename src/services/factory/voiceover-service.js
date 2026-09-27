/**
 * ACHAki Autopilot — VoiceoverService
 *
 * Gerador de locução neural humanizada em Português Brasileiro (PT-BR).
 * Utiliza msedge-tts (Open-Source / Custo Zero / Sem limites de API).
 */

import path from 'node:path';
import fs from 'node:fs';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import logger from '../../utils/logger.js';

export const BRAZILIAN_VOICES = {
  FRANCISCA: 'pt-BR-FranciscaNeural', // Feminina natural, enérgica, ideal para achadinhos
  ANTONIO: 'pt-BR-AntonioNeural',     // Masculino confiável, autoridade, conversão
  THALITA: 'pt-BR-ThalitaNeural',     // Feminina jovem, estilo TikTok/Reels
};

export class VoiceoverService {
  constructor() {
    this.outputDir = path.resolve('data/generated_creatives');
    this._ensureOutputDir();
  }

  _ensureOutputDir() {
    try {
      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true });
      }
    } catch (e) {
      // Ignora erro em ambientes de filesystem read-only (Vercel)
    }
  }

  /**
   * Prepara o texto para locução comercial fluida e natural em PT-BR.
   * Expande números, moedas, percentuais e abreviações técnicas para fonética perfeita.
   */
  static prepareCommercialText(text) {
    if (!text) return '';
    return String(text)
      // Remove emojis e caracteres não verbais
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F018}-\u{1F270}\u{2388}\u{2B05}\u{2B06}\u{2B07}\u{2B1B}\u{2B1C}\u{2B50}\u{2B55}]/gu, '')
      .replace(/[*_#`~]/g, '')
      // Expansões de naturalidade de fala publicitária
      .replace(/\b1º\b/gi, 'primeiro')
      .replace(/\b2º\b/gi, 'segundo')
      .replace(/R\$\s*(\d+)[,.](\d{2})/g, (_, r, c) => `${r} reais e ${c} centavos`)
      .replace(/R\$\s*(\d+)/g, (_, r) => `${r} reais`)
      .replace(/\b110v\b/gi, '110 volts')
      .replace(/\b220v\b/gi, '220 volts')
      .replace(/\bbivolt\b/gi, 'bi-volt')
      .replace(/\bwi-?fi\b/gi, 'Wi-Fi')
      .replace(/\bfull\s*hd\b/gi, 'Full H-D')
      .replace(/(\d+)%\s*off/gi, '$1 por cento de desconto')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Gera arquivo de áudio de narração em MP3 a partir de texto de roteiro.
   *
   * @param {object} params
   * @param {string} params.text - Texto do roteiro
   * @param {string} [params.voice] - Nome da voz neural
   * @param {string} [params.rate] - Velocidade da fala (+10% para ritmo comercial dinâmico)
   * @param {string} [params.pitch] - Tom da voz
   * @param {string} [params.volume] - Volume da fala
   * @param {string} [params.filename] - Nome do arquivo de saída
   * @param {string} [params.outputDir] - Diretório de destino
   * @returns {Promise<{ audioPath: string, durationEstimate: number }>}
   */
  async generateVoiceover({
    text,
    voice = BRAZILIAN_VOICES.FRANCISCA,
    rate = '+10%',
    pitch = '+0Hz',
    volume = '+10%',
    filename = null,
    outputDir = null,
  }) {
    if (!text || typeof text !== 'string') {
      throw new Error('Texto de roteiro obrigatório para locução.');
    }

    const cleanText = VoiceoverService.prepareCommercialText(text);

    const id = Date.now();
    const outFilename = filename || `voiceover_${id}.mp3`;
    const targetDir = outputDir ? path.resolve(outputDir) : this.outputDir;
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const finalAudioPath = path.join(targetDir, outFilename);

    logger.info(`[VoiceoverService] 🎙️ Gerando locução neural [Voz: ${voice}] [Ritmo: ${rate}] (${cleanText.length} caracteres)...`);

    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

      const tempDir = path.join(targetDir, `temp_voice_${id}`);
      fs.mkdirSync(tempDir, { recursive: true });

      const prosodyOptions = {
        rate,
        pitch,
        volume,
      };

      const result = await tts.toFile(tempDir, cleanText, prosodyOptions);
      const generatedTempPath = result.audioFilePath;

      if (!fs.existsSync(generatedTempPath)) {
        throw new Error('Arquivo de áudio não foi gerado pelo TTS.');
      }

      // Move/Copia para o destino final com proteção contra EBUSY no Windows
      let copied = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          fs.copyFileSync(generatedTempPath, finalAudioPath);
          copied = true;
          break;
        } catch (e) {
          await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
        }
      }
      if (!copied) {
        fs.copyFileSync(generatedTempPath, finalAudioPath);
      }

      // Limpa pasta temporária
      try {
        if (fs.existsSync(generatedTempPath)) fs.unlinkSync(generatedTempPath);
        fs.rmdirSync(tempDir);
      } catch (_) {}

      // Estimativa de duração (aproximadamente 3.0 palavras por segundo com +10% rate)
      const wordCount = cleanText.split(/\s+/).length;
      const durationEstimate = Math.max(2, Math.round(wordCount / 3.0 * 10) / 10);

      logger.info(`[VoiceoverService] ✅ Locução gerada com sucesso: ${finalAudioPath} (~${durationEstimate}s)`);

      return {
        audioPath: finalAudioPath,
        durationEstimate,
        text: cleanText,
        voice,
      };
    } catch (err) {
      logger.error(`[VoiceoverService] Falha na síntese de voz: ${err.message}`);
      throw err;
    }
  }
}

export default new VoiceoverService();
