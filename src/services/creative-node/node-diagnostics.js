import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const execAsync = promisify(exec);

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';
const supabase = createClient(supabaseUrl, supabaseKey);

export class NodeDiagnostics {
  /**
   * Executa diagnóstico completo e factual do computador local
   */
  static async runFullDiagnostics() {
    const [
      osInfo,
      cpuInfo,
      gpuInfo,
      ramInfo,
      diskInfo,
      ffmpegInfo,
      comfyuiInfo,
      modelsInfo,
      workerInfo,
      cloudInfo,
      workflowInfo
    ] = await Promise.all([
      this.getWindowsInfo(),
      this.getCpuInfo(),
      this.getGpuInfo(),
      this.getRamInfo(),
      this.getDiskInfo(),
      this.getFfmpegInfo(),
      this.getComfyuiInfo(),
      this.getVideoModelsInfo(),
      this.getWorkerInfo(),
      this.getCloudConnectionInfo(),
      this.getWorkflowsInfo()
    ]);

    return {
      timestamp: new Date().toISOString(),
      windows: osInfo,
      cpu: cpuInfo,
      gpu: gpuInfo,
      vram: gpuInfo.vram,
      ram: ramInfo,
      disk: diskInfo,
      ffmpeg: ffmpegInfo,
      comfyui: comfyuiInfo,
      videoModels: modelsInfo,
      worker: workerInfo,
      cloud: cloudInfo,
      workflows: workflowInfo
    };
  }

  static async getWindowsInfo() {
    try {
      const { stdout } = await execAsync('powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).Caption + \' \' + (Get-CimInstance Win32_OperatingSystem).OSArchitecture"');
      const caption = stdout.trim();
      return caption || `${os.type()} ${os.release()} (${os.arch()})`;
    } catch {
      return `${os.type()} ${os.release()} (${os.arch()})`;
    }
  }

  static async getCpuInfo() {
    try {
      const cpus = os.cpus() || [];
      const model = cpus[0]?.model ? cpus[0].model.trim() : 'CPU Desconhecida';
      const cores = cpus.length;
      return {
        model,
        cores,
        description: `${model} (${cores} threads)`
      };
    } catch {
      return { model: 'Desconhecida', cores: 1, description: 'CPU Desconhecida' };
    }
  }

  static async getGpuInfo() {
    // 1. Tenta nvidia-smi para GPU dedicada NVIDIA
    try {
      const { stdout } = await execAsync('nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader');
      const lines = stdout.trim().split('\n');
      if (lines[0]) {
        const parts = lines[0].split(',').map(s => s.trim());
        const name = parts[0] || 'NVIDIA GPU';
        const totalVramStr = parts[1] || '';
        const freeVramStr = parts[2] || '';
        const vramMbMatch = totalVramStr.match(/(\d+)/);
        const vramMb = vramMbMatch ? parseInt(vramMbMatch[1], 10) : 0;
        const vramGb = vramMb ? (vramMb / 1024).toFixed(1) + ' GB' : totalVramStr;

        return {
          name,
          hasNvidia: true,
          vram: vramGb,
          vramMb,
          vramFree: freeVramStr,
          status: 'OK'
        };
      }
    } catch (_) {}

    // 2. Fallback via CIM/WMI
    try {
      const { stdout } = await execAsync('powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"');
      const gpus = stdout.trim().split('\n').map(s => s.trim()).filter(Boolean);
      return {
        name: gpus.join(' / ') || 'GPU Integrada',
        hasNvidia: false,
        vram: 'Compartilhada',
        vramMb: 0,
        status: gpus.length > 0 ? 'OK' : 'AUSENTE'
      };
    } catch {
      return { name: 'Não identificada', hasNvidia: false, vram: '0 GB', vramMb: 0, status: 'AUSENTE' };
    }
  }

  static async getRamInfo() {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const totalGb = (totalBytes / (1024 ** 3)).toFixed(1);
    const freeGb = (freeBytes / (1024 ** 3)).toFixed(1);
    return {
      total: `${totalGb} GB`,
      free: `${freeGb} GB`,
      totalGb: parseFloat(totalGb),
      freeGb: parseFloat(freeGb)
    };
  }

  static async getDiskInfo() {
    try {
      const { stdout } = await execAsync('powershell -NoProfile -Command "[math]::Round((Get-PSDrive C).Free / 1GB, 1)"');
      const freeGb = parseFloat(stdout.trim()) || 0;
      return {
        free: `${freeGb} GB`,
        freeGb,
        drive: 'C:',
        status: freeGb >= 10 ? 'OK' : 'LOW_SPACE'
      };
    } catch {
      return { free: 'Desconhecido', freeGb: 0, drive: 'C:', status: 'UNKNOWN' };
    }
  }

  static async getFfmpegInfo() {
    try {
      const { stdout } = await execAsync('ffmpeg -version');
      const firstLine = stdout.split('\n')[0] || '';
      const versionMatch = firstLine.match(/ffmpeg version ([^\s]+)/i);
      return {
        installed: true,
        version: versionMatch ? versionMatch[1] : 'Instalado',
        status: 'OK'
      };
    } catch {
      // Verifica caminho padrão WinGet
      const localWingetPath = path.join(
        process.env.LOCALAPPDATA || '',
        'Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.0.1-full_build/bin/ffmpeg.exe'
      );
      if (fs.existsSync(localWingetPath)) {
        return {
          installed: true,
          version: '8.0.1 (WinGet Local)',
          path: localWingetPath,
          status: 'OK'
        };
      }
      return {
        installed: false,
        version: null,
        status: 'AUSENTE'
      };
    }
  }

  static async getComfyuiInfo() {
    // 1. Testa conectividade na porta padrão localhost:8188 (nunca expor publicamente)
    let isPortOpen = false;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1200);
      const res = await fetch('http://127.0.0.1:8188/system_stats', { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) isPortOpen = true;
    } catch (_) {}

    // 2. Busca diretório de instalação ComfyUI local
    const candidateDirs = [
      'C:\\ComfyUI_windows_portable',
      'C:\\ComfyUI',
      path.join(os.homedir(), 'ComfyUI'),
      path.resolve('data/creative-node/comfyui'),
      path.resolve('data/comfyui')
    ];

    let foundDir = null;
    for (const d of candidateDirs) {
      if (fs.existsSync(d)) {
        foundDir = d;
        break;
      }
    }

    if (isPortOpen) {
      return {
        installed: true,
        online: true,
        port: 8188,
        path: foundDir || 'http://127.0.0.1:8188',
        status: 'OK'
      };
    }

    if (foundDir) {
      return {
        installed: true,
        online: false,
        port: 8188,
        path: foundDir,
        status: 'OFFLINE'
      };
    }

    return {
      installed: false,
      online: false,
      port: 8188,
      path: null,
      status: 'AUSENTE'
    };
  }

  static async getVideoModelsInfo() {
    // Procura modelos em data/creative-node/models ou em instalações ComfyUI locais
    const modelSearchPaths = [
      path.resolve('data/creative-node/models'),
      path.resolve('data/models'),
      'C:\\ComfyUI_windows_portable\\ComfyUI\\models\\checkpoints',
      'C:\\ComfyUI_windows_portable\\ComfyUI\\models\\diffusion_models',
      'C:\\ComfyUI\\models\\checkpoints'
    ];

    const models = [];
    for (const p of modelSearchPaths) {
      if (fs.existsSync(p)) {
        try {
          const files = fs.readdirSync(p);
          for (const f of files) {
            if (f.endsWith('.safetensors') || f.endsWith('.ckpt') || f.endsWith('.gguf')) {
              models.push({ name: f, path: path.join(p, f) });
            }
          }
        } catch (_) {}
      }
    }

    return {
      availableCount: models.length,
      models: models.map(m => m.name),
      status: models.length > 0 ? 'OK' : 'AUSENTE'
    };
  }

  static async getWorkflowsInfo() {
    const wfDir = path.resolve('data/creative-node/workflows');
    const requiredWfs = ['achaki_video_9_16_standard.json'];
    const found = [];

    if (fs.existsSync(wfDir)) {
      try {
        const files = fs.readdirSync(wfDir);
        for (const req of requiredWfs) {
          if (files.includes(req)) found.push(req);
        }
      } catch (_) {}
    }

    return {
      installed: found.length === requiredWfs.length,
      workflows: found,
      status: found.length === requiredWfs.length ? 'OK' : 'AUSENTE'
    };
  }

  static async getWorkerInfo() {
    try {
      // 1. Consulta heartbeat recente no Supabase
      const { data: hb } = await supabase
        .from('worker_heartbeats')
        .select('*')
        .order('last_heartbeat_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const now = Date.now();
      const lastHbMs = hb ? new Date(hb.last_heartbeat_at).getTime() : 0;
      const isOnline = Boolean(hb && (now - lastHbMs < 45000));

      return {
        online: isOnline,
        workerId: hb?.worker_id || 'worker-local',
        lastHeartbeat: hb?.last_heartbeat_at || null,
        status: isOnline ? 'OK' : 'AUSENTE'
      };
    } catch {
      return { online: false, workerId: null, status: 'AUSENTE' };
    }
  }

  static async getCloudConnectionInfo() {
    try {
      const { data, error } = await supabase.from('system_state').select('id').limit(1);
      if (error) throw error;
      return { connected: true, status: 'OK' };
    } catch (e) {
      return { connected: false, error: e.message, status: 'ERRO' };
    }
  }
}

export default NodeDiagnostics;
