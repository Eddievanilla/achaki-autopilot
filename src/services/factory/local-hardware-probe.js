/**
 * ACHAki Autopilot — LocalHardwareProbe
 *
 * Sonda as capacidades de hardware da máquina local (GPU, VRAM, RAM, Disco)
 * e o status de disponibilidade do ComfyUI e seus modelos instalados.
 *
 * Princípio: Zero Mock. Se não houver ComfyUI rodando ou modelo instalado,
 * reporta o status real sem improvisar.
 */

import os from 'node:os';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import logger from '../../utils/logger.js';

export class LocalHardwareProbe {
  static async probe() {
    const baseUrl = process.env.COMFYUI_BASE_URL || 'http://127.0.0.1:8188';

    const result = {
      timestamp: new Date().toISOString(),
      gpu: {
        name: 'Não detectada',
        vramTotalMb: 0,
        vramFreeMb: 0,
        driverVersion: 'N/A',
        cudaAvailable: false,
      },
      ram: {
        totalGb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(1)),
        freeGb: Number((os.freemem() / 1024 / 1024 / 1024).toFixed(1)),
      },
      disk: {
        freeGb: 0,
        totalGb: 0,
      },
      ffmpeg: {
        installed: false,
        version: 'N/A',
      },
      comfyui: {
        online: false,
        baseUrl,
        models: [],
        workflows: [],
        error: null,
      },
      wanModelAvailable: false,
      workflowAvailable: false,
      recommendation: '',
    };

    // 1. GPU Check via nvidia-smi
    try {
      const smiOut = execSync('nvidia-smi --query-gpu=name,memory.total,memory.free,driver_version --format=csv,noheader,nounits', { encoding: 'utf8' }).trim();
      if (smiOut) {
        const parts = smiOut.split(',').map(s => s.trim());
        result.gpu.name = parts[0] || 'Unknown GPU';
        result.gpu.vramTotalMb = Number(parts[1]) || 0;
        result.gpu.vramFreeMb = Number(parts[2]) || 0;
        result.gpu.driverVersion = parts[3] || 'Unknown';
        result.gpu.cudaAvailable = true;
      }
    } catch (e) {
      result.gpu.name = 'Nenhuma GPU NVIDIA com nvidia-smi acessível';
    }

    // 2. Disco Livre no C:
    try {
      if (fs.statfsSync) {
        const stat = fs.statfsSync('C:\\');
        result.disk.freeGb = Number(((stat.bavail * stat.bsize) / 1024 / 1024 / 1024).toFixed(1));
        result.disk.totalGb = Number(((stat.blocks * stat.bsize) / 1024 / 1024 / 1024).toFixed(1));
      }
    } catch (e) {
      result.disk.freeGb = 0;
    }

    // 3. FFmpeg Check
    try {
      const ffOut = execSync('ffmpeg -version', { encoding: 'utf8' }).split('\n')[0].trim();
      result.ffmpeg.installed = true;
      result.ffmpeg.version = ffOut;
    } catch (e) {
      result.ffmpeg.installed = false;
    }

    // 4. ComfyUI Probe (127.0.0.1:8188)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1800);
      const resp = await fetch(`${baseUrl}/system_stats`, { signal: controller.signal });
      clearTimeout(timeout);
      if (resp.ok) {
        const stats = await resp.json();
        result.comfyui.online = true;
        result.comfyui.stats = stats;

        // Model Checkpoints
        try {
          const objResp = await fetch(`${baseUrl}/object_info/CheckpointLoaderSimple`);
          if (objResp.ok) {
            const info = await objResp.json();
            const ckpts = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
            result.comfyui.models = ckpts;
            result.wanModelAvailable = ckpts.some(m => /wan/i.test(m) || /svd/i.test(m));
          }
        } catch (err) {
          // ignore
        }
      } else {
        result.comfyui.error = `HTTP ${resp.status}`;
      }
    } catch (err) {
      result.comfyui.online = false;
      result.comfyui.error = err.message;
    }

    // 5. Recomendações de Arquitetura de Geração
    const vramGb = Math.round(result.gpu.vramTotalMb / 1024);
    if (vramGb < 8) {
      result.recommendation = `GPU com ${vramGb}GB VRAM (RTX 3050). Para geração local de IA sem estouro de memória (OOM), utilizar Wan 2.1 1.3B ou Wan 2.2 quantizado (GGUF Q4_K_M) com offload de CPU, combinando com o compositor híbrido FFmpeg (clipes curtos de 2-3s + pan/zoom sobre fotos reais do produto).`;
    } else if (vramGb < 16) {
      result.recommendation = `GPU com ${vramGb}GB VRAM. Suporta Wan 2.2 14B quantizado (Q4) com CPU offload e Wan 2.1 1.3B nativo.`;
    } else {
      result.recommendation = `GPU de alta capacidade (${vramGb}GB VRAM). Compatível com modelos 14B fp8/fp16.`;
    }

    return result;
  }
}

export default LocalHardwareProbe;
