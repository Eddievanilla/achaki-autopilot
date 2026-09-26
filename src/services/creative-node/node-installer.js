import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import NodeDiagnostics from './node-diagnostics.js';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';
const supabase = createClient(supabaseUrl, supabaseKey);

export class CreativeNodeInstaller {
  /**
   * Instala e inicializa o Creative Node no computador Windows local
   */
  static async install() {
    const nodeDir = path.resolve('data/creative-node');
    const installingFlag = path.join(nodeDir, '.installing');
    const configuringFlag = path.join(nodeDir, '.configuring');

    try {
      // 1. Cria diretórios base
      const dirs = [
        nodeDir,
        path.join(nodeDir, 'workflows'),
        path.join(nodeDir, 'models'),
        path.join(nodeDir, 'comfyui'),
        path.join(nodeDir, 'output'),
        path.join(nodeDir, 'logs'),
      ];
      for (const d of dirs) {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      }

      fs.writeFileSync(installingFlag, new Date().toISOString());

      // 2. Diagnóstico de Hardware para perfil compatível
      const diag = await NodeDiagnostics.runFullDiagnostics();

      fs.unlinkSync(installingFlag);
      fs.writeFileSync(configuringFlag, new Date().toISOString());

      // 3. Escolhe perfil de execução com base na GPU e VRAM
      let hardwareProfile = 'CPU_ONLY';
      let comfyFlags = ['--cpu'];
      let maxBatch = 1;

      if (diag.gpu.hasNvidia) {
        if (diag.gpu.vramMb >= 12000) {
          hardwareProfile = 'HIGH_VRAM_12GB_PLUS';
          comfyFlags = ['--highvram', '--fp16'];
          maxBatch = 4;
        } else if (diag.gpu.vramMb >= 6000) {
          hardwareProfile = 'OPTIMIZED_VRAM_6GB';
          comfyFlags = ['--lowvram', '--fp16'];
          maxBatch = 2;
        } else {
          hardwareProfile = 'LOW_VRAM_4GB';
          comfyFlags = ['--lowvram'];
          maxBatch = 1;
        }
      }

      // 4. Instala workflows oficiais do ACHAki
      const templateWfDir = path.resolve('src/services/creative-node/workflows');
      const targetWfDir = path.join(nodeDir, 'workflows');
      if (fs.existsSync(templateWfDir)) {
        const files = fs.readdirSync(templateWfDir);
        for (const f of files) {
          fs.copyFileSync(path.join(templateWfDir, f), path.join(targetWfDir, f));
        }
      }

      // 5. Gera script de inicialização automática no Windows
      const startupScriptContent = `@echo off
REM ACHAki Creative Node — Inicializador Automático Windows
title ACHAki Creative Node
cd /d "${process.cwd()}"
echo ===================================================
echo   🎬 ACHAki Creative Node - Servidor Local
echo ===================================================
echo Iniciando Worker local ACHAki...
start "ACHAki Worker" /b npm run worker
`;
      const startupScriptPath = path.join(nodeDir, 'start-creative-node.bat');
      fs.writeFileSync(startupScriptPath, startupScriptContent, 'utf8');

      // 6. Configura atalho na pasta Inicializar do Windows se possível
      try {
        const winStartupDir = path.join(os.homedir(), 'AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup');
        if (fs.existsSync(winStartupDir)) {
          const shortcutBat = path.join(winStartupDir, 'ACHAki_CreativeNode.bat');
          fs.writeFileSync(shortcutBat, `@echo off\r\ncall "${startupScriptPath}"\r\n`, 'utf8');
        }
      } catch (_) {}

      // 7. Registra configuração do Node
      const nodeConfig = {
        nodeId: `node_${os.hostname().toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        hostname: os.hostname(),
        installedAt: new Date().toISOString(),
        version: '1.0.0',
        hardwareProfile,
        comfyFlags,
        maxBatch,
        gpu: diag.gpu.name,
        vram: diag.gpu.vram,
        ram: diag.ram.total,
        status: 'PRONTO',
        port: 8188,
        localOnly: true, // Garante que a porta nunca seja exposta na internet
      };

      fs.writeFileSync(path.join(nodeDir, 'node_config.json'), JSON.stringify(nodeConfig, null, 2), 'utf8');

      // 8. Registra o computador na nuvem / Supabase
      try {
        await supabase
          .from('system_state')
          .update({
            creative_node_state: 'PRONTO',
            creative_node_registered_at: new Date().toISOString(),
            creative_node_profile: hardwareProfile,
            updated_at: new Date().toISOString(),
          })
          .eq('id', 'autopilot');
      } catch (_) {}

      if (fs.existsSync(configuringFlag)) fs.unlinkSync(configuringFlag);

      return {
        success: true,
        nodeId: nodeConfig.nodeId,
        hardwareProfile,
        status: 'PRONTO',
        message: 'Creative Node instalado e configurado com sucesso para este computador Windows.',
      };
    } catch (err) {
      if (fs.existsSync(installingFlag)) fs.unlinkSync(installingFlag);
      if (fs.existsSync(configuringFlag)) fs.unlinkSync(configuringFlag);
      throw err;
    }
  }
}

export default CreativeNodeInstaller;
