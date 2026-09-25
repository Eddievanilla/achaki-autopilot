import os from 'node:os';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

export async function probeHardware() {
  const result = {
    gpu: {
      name: 'N/A',
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
      baseUrl: process.env.COMFYUI_BASE_URL || 'http://127.0.0.1:8188',
      models: [],
      error: null,
    },
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
    result.gpu.name = 'No NVIDIA GPU detected or nvidia-smi unavailable';
  }

  // 2. Disk Space on C:
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
    const timeout = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`${result.comfyui.baseUrl}/system_stats`, { signal: controller.signal });
    clearTimeout(timeout);
    if (resp.ok) {
      const stats = await resp.json();
      result.comfyui.online = true;
      result.comfyui.stats = stats;

      // Query models/checkpoints
      try {
        const objResp = await fetch(`${result.comfyui.baseUrl}/object_info/CheckpointLoaderSimple`);
        if (objResp.ok) {
          const info = await objResp.json();
          result.comfyui.models = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
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

  // 5. Hardware Recommendations
  const vramGb = Math.round(result.gpu.vramTotalMb / 1024);
  if (vramGb < 8) {
    result.recommendation = `GPU com ${vramGb}GB VRAM (RTX 3050). Para geração de vídeo local sem OOM, Wan 2.2 exige quantização avançada (ex: GGUF Q4_K_M ou T5_XXL CPU offload) ou modelo leve Wan 2.1 1.3B / SVD-XT, combinando com o VideoComposer híbrido do ACHAki (clipes IA curtos de 2-3s + composição FFmpeg 1080x1920 9:16).`;
  } else if (vramGb < 16) {
    result.recommendation = `GPU com ${vramGb}GB VRAM. Adequada para Wan 2.2 14B quantizado (Q4) com offload e Wan 2.1 1.3B nativo.`;
  } else {
    result.recommendation = `GPU de alta capacidade (${vramGb}GB VRAM). Compatível com modelos 14B float8/fp16.`;
  }

  return result;
}

if (process.argv[1].endsWith('probe-hardware.js')) {
  probeHardware().then(res => {
    console.log(JSON.stringify(res, null, 2));
  });
}
