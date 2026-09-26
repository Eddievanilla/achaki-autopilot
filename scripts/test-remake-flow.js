import controlsHandler from '../api/controls.js';
import creativeJobQueue from '../src/services/factory/creative-job-queue.js';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('1. Buscando produto existente para teste de remake...');
  const { data: prod } = await supabase.from('products').select('*').limit(1).single();
  if (!prod) {
    console.error('Nenhum produto encontrado');
    return;
  }
  console.log(`Produto: ${prod.id} - ${prod.title}`);

  // Simula request para REMAKE_CREATIVE
  const req = {
    method: 'POST',
    body: {
      action: 'REMAKE_CREATIVE',
      productId: prod.id,
      userPrompt: 'Foco total em dizer que aguenta até 50kg e tem rodinhas que não riscam o chão!'
    }
  };

  let responseData = null;
  let responseStatus = 200;
  const res = {
    setHeader: () => {},
    status: (s) => {
      responseStatus = s;
      return res;
    },
    json: (d) => {
      responseData = d;
      return res;
    }
  };

  console.log('2. Chamando action REMAKE_CREATIVE...');
  await controlsHandler(req, res);
  console.log(`Resposta [status ${responseStatus}]:`, responseData);

  if (!responseData?.jobId) {
    console.error('Falha ao enfileirar job de remake!');
    return;
  }

  console.log('3. Processando o job com a fábrica local...');
  const processRes = await creativeJobQueue.processNextJob();
  console.log('Resultado do processamento:', processRes);

  console.log('✅ Teste de Remake concluído com sucesso!');
}

run().catch(console.error);
