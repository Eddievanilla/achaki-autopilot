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
   * Gera arquivo de áudio de narração em MP3 a partir de texto de roteiro.
   *
   * @param {object} params
   * @param {string} params.text - Texto do roteiro (30 a 50 palavras para ~12-15s)
   * @param {string} [params.voice] - Nome da voz (padrão Francisca)
   * @param {string} [params.filename] - Nome do arquivo de saída
   * @returns {Promise<{ audioPath: string, durationEstimate: number }>}
   */
  async generateVoiceover({
    text,
    voice = BRAZILIAN_VOICES.FRANCISCA,
    filename = null,
  }) {
    if (!text || typeof text !== 'string') {
      throw new Error('Texto de roteiro obrigatório para locução.');
    }

    const cleanText = text
      .replace(/[*_#`~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const id = Date.now();
    const outFilename = filename || `voiceover_${id}.mp3`;
    const targetDir = this.outputDir;
    const finalAudioPath = path.join(targetDir, outFilename);

    logger.info(`[VoiceoverService] 🎙️ Gerando locução neural [Voz: ${voice}] (${cleanText.length} caracteres)...`);

    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

      // msedge-tts grava com nome audio.mp3 dentro do diretório especificado
      const tempDir = path.join(targetDir, `temp_voice_${id}`);
      fs.mkdirSync(tempDir, { recursive: true });

      const result = await tts.toFile(tempDir, cleanText);
      const generatedTempPath = result.audioFilePath;

      if (!fs.existsSync(generatedTempPath)) {
        throw new Error('Arquivo de áudio não foi gerado pelo TTS.');
      }

      // Move para o nome final
      fs.renameSync(generatedTempPath, finalAudioPath);

      // Limpa pasta temporária
      try {
        fs.rmdirSync(tempDir);
      } catch (_) {}

      // Estimativa de duração (aproximadamente 2.8 a 3.2 palavras por segundo em fala normal brasileira)
      const wordCount = cleanText.split(/\s+/).length;
      const durationEstimate = Math.max(8, Math.min(18, Math.round(wordCount / 2.7)));

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
