import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import voiceoverService from '../src/services/factory/voiceover-service.js';

const execAsync = promisify(exec);

async function testProVideo() {
  console.log('1. Gerando locução neural...');
  const voice = await voiceoverService.generateVoiceover({
    text: 'Dá uma olhada nesse carrinho organizador multiuso! Ele tem três prateleiras reforçadas, rodinhas 360 e cabe em qualquer cantinho da sua casa. Aproveita que o desconto oficial tá liberado no link dos comentários!',
  });

  const outDir = path.resolve('data/generated_creatives');
  const imgPath = path.join(outDir, 'test_img.webp');
  if (!fs.existsSync(imgPath)) {
    const r = await fetch('https://http2.mlstatic.com/D_Q_NP_2X_677076-MLB117472800933_092026-E.webp');
    fs.writeFileSync(imgPath, Buffer.from(await r.arrayBuffer()));
  }

  const outVideo = path.join(outDir, 'test_pro_video.mp4');
  const duration = voice.durationEstimate || 13;
  const normImg = imgPath.replace(/\\/g, '/');
  const normAudio = voice.audioPath.replace(/\\/g, '/');
  const normOut = outVideo.replace(/\\/g, '/');

  console.log('2. Compondo vídeo profissional 9:16 com cortes dinâmicos e legendas...');
  const filter = [
    `[0:v]loop=loop=-1:size=1:start=0,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5[bg]`,
    `[0:v]loop=loop=-1:size=1:start=0,scale=880:880:force_original_aspect_ratio=decrease,format=rgba[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2-80[base]`,
    // Header Topbar
    `[base]drawbox=x=60:y=100:w=960:h=90:color=black@0.7:t=fill[b1]`,
    `[b1]drawtext=text='ACHAki - ACHADINHO VERIFICADO':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=125[b2]`,
    // Act 1 (0 a 4s): Hook
    `[b2]drawtext=text='OLHA ESSE ACHADINHO!':fontcolor=yellow:fontsize=48:x=(w-text_w)/2:y=1420:enable='between(t,0,4)'[b3]`,
    // Act 2 (4 a 9s): Feature
    `[b3]drawtext=text='SUPER PRATICO E RESISTENTE':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=1420:enable='between(t,4,9)'[b4]`,
    // Act 3 (9s+): CTA
    `[b4]drawtext=text='OFERTA COM DESCONTO REAL':fontcolor=green:fontsize=46:x=(w-text_w)/2:y=1420:enable='gte(t,9)'[b5]`,
    // Bottom card
    `[b5]drawbox=x=60:y=1520:w=960:h=180:color=black@0.85:t=fill[b6]`,
    `[b6]drawtext=text='Carrinho Organizador Multiuso':fontcolor=white:fontsize=34:x=90:y=1550[b7]`,
    `[b7]drawtext=text='R$ 128,00 (-40% OFF)':fontcolor=yellow:fontsize=46:x=90:y=1615[v]`
  ].join(';');

  const cmd = `ffmpeg -y -i "${normImg}" -i "${normAudio}" -filter_complex "${filter}" -map "[v]" -map 1:a -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 192k -t ${duration} "${normOut}"`;

  await execAsync(cmd);
  const size = fs.statSync(outVideo).size;
  console.log(`✅ Vídeo profissional gerado com sucesso! Tamanho: ${(size / 1024 / 1024).toFixed(2)} MB`);
}

testProVideo().catch(err => {
  console.error('Erro:', err);
  process.exit(1);
});
