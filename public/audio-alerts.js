/**
 * ACHAki Autopilot — Audio & Speech Alert System
 *
 * Gerencia a reprodução de áudios personalizados e alertas de voz do robô
 * com fallback inteligente para Web Speech API e suporte a vibração mobile.
 */

class AchakiAudioAlerts {
  constructor() {
    this.enabled = localStorage.getItem('achaki_audio_enabled') !== 'false';
    this.volume = parseFloat(localStorage.getItem('achaki_audio_volume') || '1.0');
    this.lastPlayedId = null;
    this.lastPlayedTime = 0;

    // Mensagens faladas padrão para cada marketplace
    this.voiceLines = {
      mercadolivre: "Chefe, o Mercado Livre me barrou de novo! Tá pedindo desafio de segurança, me libera aí pra gente comissionar!",
      shopee: "A Shopee não me deixou entrar! Jogou aquele quebra-cabeça na minha cara, resolve aí pra gente não perder essa oferta!",
      amazon: "A Amazon me deixou de fora! Pediu confirmação de login, dá um toque na tela aí pra eu continuar!",
      facebook: "Opa chefe, o Facebook pediu verificação pra postar no grupo! Dá uma conferida rápida!",
      aliexpress: "O AliExpress barrou a sessão! Me libera aí pra pegar o preço certo!",
      sistema: "Atenção chefe, o robô encontrou uma barreira de segurança e precisa da sua ajuda!",
      resolvido: "Valeu chefe! Liberou geral, já tô gerando o link e postando agora!"
    };

    // Mapeamento para arquivos MP3 locais (se existirem na pasta /sounds/)
    this.soundFiles = {
      mercadolivre: '/sounds/ml_barrou.mp3',
      shopee: '/sounds/shopee_bloqueou.mp3',
      amazon: '/sounds/amazon_trancou.mp3',
      facebook: '/sounds/facebook_alerta.mp3',
      aliexpress: '/sounds/aliexpress_alerta.mp3',
      resolvido: '/sounds/valeu_chefe.mp3'
    };

    this.audioCache = {};
  }

  toggle(enabled) {
    this.enabled = enabled;
    localStorage.setItem('achaki_audio_enabled', enabled ? 'true' : 'false');
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    localStorage.setItem('achaki_audio_volume', String(this.volume));
  }

  /**
   * Vibra o celular (Android PWA / Mobile Web)
   */
  vibratePhone(pattern = [300, 150, 300, 150, 600]) {
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate(pattern);
      }
    } catch (e) {
      // Ignora se não suportado
    }
  }

  /**
   * Toca efeito sonoro sintetizado via Web Audio API (Bip de Alerta de Robô)
   */
  playSynthBeep(isSuccess = false) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      if (isSuccess) {
        // Melodia de sucesso ascendente
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.12 * this.volume, ctx.currentTime + i * 0.1);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.15);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + i * 0.1);
          osc.stop(ctx.currentTime + i * 0.1 + 0.15);
        });
      } else {
        // Alerta de emergência robótico
        const freqs = [880, 440, 880, 440];
        freqs.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.15 * this.volume, ctx.currentTime + i * 0.12);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.12 + 0.1);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + i * 0.12);
          osc.stop(ctx.currentTime + i * 0.12 + 0.1);
        });
      }
    } catch (err) {
      console.warn('Erro ao tocar synth beep:', err.message);
    }
  }

  /**
   * Sintetiza a fala do robô usando SpeechSynthesis (PT-BR) com voz expressiva
   */
  speak(text) {
    if (!('speechSynthesis' in window) || !text) return;

    try {
      window.speechSynthesis.cancel(); // Cancela falas anteriores
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-BR';
      utterance.volume = this.volume;
      utterance.pitch = 1.15; // Tom ligeiramente elevado (robô ágil/expressivo)
      utterance.rate = 1.05;  // Velocidade dinâmica

      // Tenta selecionar voz em português se disponível
      const voices = window.speechSynthesis.getVoices();
      const ptVoice = voices.find(v => v.lang.includes('pt') || v.lang.includes('PT') || v.name.includes('Brazil') || v.name.includes('Portuguese'));
      if (ptVoice) {
        utterance.voice = ptVoice;
      }

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('SpeechSynthesis falhou:', err.message);
    }
  }

  /**
   * Toca áudio MP3 local se existir, senão usa fala nativa
   */
  async playMarketplaceAudio(marketplaceKey, fallbackText) {
    if (!this.enabled) return;

    this.vibratePhone();
    this.playSynthBeep(marketplaceKey === 'resolvido');

    const soundUrl = this.soundFiles[marketplaceKey];
    if (soundUrl) {
      try {
        const audio = new Audio(soundUrl);
        audio.volume = this.volume;
        await audio.play();
        return; // Áudio MP3 tocou com sucesso
      } catch (err) {
        // Se o arquivo MP3 não existir (404) ou der erro, usa fallback de fala nativa
      }
    }

    // Fallback: Sintetizador nativo de fala
    const textToSpeak = fallbackText || this.voiceLines[marketplaceKey] || this.voiceLines.sistema;
    setTimeout(() => {
      this.speak(textToSpeak);
    }, 400);
  }

  /**
   * Disparado quando uma nova intervenção é detectada
   */
  notifyIntervention(intervention) {
    if (!this.enabled || !intervention) return;

    // Evita repetir som para a mesma intervenção dentro de 30 segundos
    const now = Date.now();
    if (this.lastPlayedId === intervention.id && (now - this.lastPlayedTime < 30000)) {
      return;
    }

    this.lastPlayedId = intervention.id;
    this.lastPlayedTime = now;

    const mp = (intervention.marketplace || 'sistema').toLowerCase();
    this.playMarketplaceAudio(mp, intervention.title ? `${mp.toUpperCase()}: ${this.voiceLines[mp] || intervention.title}` : null);
  }

  /**
   * Disparado quando uma intervenção é resolvida
   */
  notifyResolved() {
    this.playMarketplaceAudio('resolvido', this.voiceLines.resolvido);
  }
}

window.achakiAudio = new AchakiAudioAlerts();
