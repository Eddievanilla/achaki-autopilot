import fs from 'node:fs';
import path from 'node:path';
import NodeDiagnostics from './node-diagnostics.js';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';
const supabase = createClient(supabaseUrl, supabaseKey);

export const NODE_STATES = {
  NAO_INSTALADO: 'NAO_INSTALADO',
  OFFLINE: 'OFFLINE',
  INSTALANDO: 'INSTALANDO',
  CONFIGURANDO: 'CONFIGURANDO',
  PRONTO: 'PRONTO',
  ERRO: 'ERRO',
};

export class CreativeNodeSupervisor {
  /**
   * Avalia a saúde completa dos 7 componentes e define o estado do Creative Node
   */
  static async evaluateHealth() {
    const diag = await NodeDiagnostics.runFullDiagnostics();
    const nodeDir = path.resolve('data/creative-node');
    const isInstalled = fs.existsSync(nodeDir) && fs.existsSync(path.join(nodeDir, 'node_config.json'));
    const isInstalling = fs.existsSync(path.join(nodeDir, '.installing'));
    const isConfiguring = fs.existsSync(path.join(nodeDir, '.configuring'));

    // Avaliação dos 7 componentes obrigatórios
    const components = {
      WORKER: diag.worker.status === 'OK' ? 'OK' : 'AUSENTE',
      COMFYUI: diag.comfyui.status === 'OK' ? 'OK' : (diag.comfyui.status === 'OFFLINE' ? 'OFFLINE' : 'AUSENTE'),
      FFMPEG: diag.ffmpeg.status === 'OK' ? 'OK' : 'AUSENTE',
      GPU: diag.gpu.status === 'OK' ? 'OK' : 'AUSENTE',
      MODEL: diag.videoModels.status === 'OK' ? 'OK' : 'AUSENTE',
      WORKFLOW: diag.workflows.status === 'OK' ? 'OK' : 'AUSENTE',
      CLOUD_CONNECTION: diag.cloud.status === 'OK' ? 'OK' : 'ERRO',
    };

    let overallState = NODE_STATES.PRONTO;
    let statusMessage = 'Creative Node operacional e pronto para processamento.';

    if (!isInstalled) {
      overallState = NODE_STATES.NAO_INSTALADO;
      statusMessage = 'Creative Node não instalado neste computador. Clique em Instalar para configurar.';
    } else if (isInstalling) {
      overallState = NODE_STATES.INSTALANDO;
      statusMessage = 'Instalando componentes do Creative Node...';
    } else if (isConfiguring) {
      overallState = NODE_STATES.CONFIGURANDO;
      statusMessage = 'Configurando perfil de hardware e workflows do Creative Node...';
    } else if (components.CLOUD_CONNECTION !== 'OK') {
      overallState = NODE_STATES.ERRO;
      statusMessage = 'Falha na conexão com ACHAki Cloud / Supabase.';
    } else if (components.FFMPEG !== 'OK' || components.WORKFLOW !== 'OK') {
      overallState = NODE_STATES.ERRO;
      statusMessage = 'Componentes essenciais ausentes ou corrompidos. Executar reparo.';
    } else if (components.WORKER !== 'OK') {
      overallState = NODE_STATES.OFFLINE;
      statusMessage = 'Worker local ACHAki parado. Inicie o operador ou clique em Reparar.';
    } else {
      overallState = NODE_STATES.PRONTO;
      statusMessage = 'Creative Node pronto e operando localmente.';
    }

    const report = {
      state: overallState,
      statusMessage,
      components,
      diagnostics: diag,
      isInstalled,
      checkedAt: new Date().toISOString(),
    };

    // Atualiza estado no Supabase de forma não bloqueante
    this._syncStateWithCloud(report).catch(() => {});

    return report;
  }

  static async _syncStateWithCloud(report) {
    try {
      await supabase
        .from('system_state')
        .update({
          creative_node_state: report.state,
          creative_node_health: report.components,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 'autopilot');
    } catch (_) {}
  }
}

export default CreativeNodeSupervisor;
