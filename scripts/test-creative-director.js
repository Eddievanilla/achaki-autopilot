import { createClient } from '@supabase/supabase-js';
import { CreativeDirector } from '../src/agents/creative-director.js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';

const supabase = createClient(supabaseUrl, supabaseKey);

async function runTest() {
  console.log('--- TESTE ETAPA 1: DIRETOR CRIATIVO ACHAki ---');

  // 1. Busca produto real existente
  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);

  if (prodErr || !products || products.length === 0) {
    console.error('ERRO ao buscar produto real:', prodErr);
    process.exit(1);
  }

  const realProduct = products[0];
  console.log(`[1] Produto real selecionado: "${realProduct.title}" (ID: ${realProduct.id})`);
  console.log(`    Preço: R$ ${realProduct.price || realProduct.current_price} | Marketplace: ${realProduct.marketplace}`);

  // 2. Executa Diretor Criativo
  const director = new CreativeDirector({ supabaseClient: supabase });
  const blueprint = director.createBlueprint({
    product: realProduct,
    photos: realProduct.images || realProduct.pictures || [realProduct.image_url],
    context: { publico: 'Geral', objetivo: 'Conversão em Afiliado' },
  });

  console.log('\n[2] Creative Blueprint gerado com sucesso:');
  console.log('    1. Conceito:', blueprint.conceito);
  console.log('    2. Gancho:', blueprint.gancho);
  console.log('    3. Problema/Desejo:', blueprint.problemaDesejo);
  console.log('    4. Solução:', blueprint.solucao);
  console.log('    5. Sequência de Cenas:', blueprint.cenas.length, 'cenas');
  console.log('    6. Enquadramento/Movimento:', blueprint.enquadramentoMovimento);
  console.log('    7. Texto na Tela Geral:', blueprint.textoTelaGeral);
  console.log('    8. Locução Completa:', blueprint.locucaoCompleta);
  console.log('    9. Duração Total:', blueprint.duracaoTotalFormatada);
  console.log('    10. CTA:', blueprint.cta);

  // 3. Validação PT-BR
  const ptPtMarkers = ['ecrã', 'telemóvel', 'connosco', 'facto', 'está a fazer', 'miúdo', 'comboio'];
  const blueprintStr = JSON.stringify(blueprint).toLowerCase();
  const hasPtPt = ptPtMarkers.some(m => blueprintStr.includes(m));
  const isPtBrNatural = !hasPtPt && blueprint.language === 'pt-BR';

  console.log('\n[3] Validação Linguística:');
  console.log('    Idioma definido:', blueprint.language);
  console.log('    Marcadores PT-PT detectados:', hasPtPt ? 'SIM (ERRO)' : 'NENHUM (100% PT-BR Natural)');

  // 4. Salvar Storyboard vinculado ao creative_id (sem gerar vídeo)
  console.log('\n[4] Salvando Creative Blueprint e Storyboard...');
  const saveResult = await director.saveBlueprint({
    productId: realProduct.id,
    blueprint,
  });

  console.log(`    Criativo salvo no banco! Creative ID: ${saveResult.creativeId} (Versão: ${saveResult.version})`);

  // 5. Verifica no banco se video_url é estritamente null (sem gerar MP4)
  const { data: savedRecord, error: fetchErr } = await supabase
    .from('creative_versions')
    .select('id, video_url, script_data, metadata')
    .eq('id', saveResult.creativeId)
    .single();

  const videoGerado = savedRecord?.video_url !== null && savedRecord?.video_url !== undefined;
  const storyboardSalvo = Boolean(savedRecord?.script_data?.cenas?.length > 0 && savedRecord?.metadata?.storyboard?.length > 0);

  console.log('\n[5] Verificação de Integridade:');
  console.log('    Storyboard gravado:', storyboardSalvo ? 'SIM' : 'NÃO');
  console.log('    Vídeo MP4 gerado:', videoGerado ? 'SIM (ERRO)' : 'NÃO (CORRETO)');

  console.log('\n======================================');
  console.log('RESULTADO FINAL:');
  console.log('DIRETOR CRIATIVO: OK');
  console.log('BLUEPRINT: OK');
  console.log(`PT-BR: ${isPtBrNatural ? 'OK' : 'ERRO'}`);
  console.log(`STORYBOARD SALVO: ${storyboardSalvo ? 'SIM' : 'NÃO'}`);
  console.log(`VÍDEO GERADO: ${videoGerado ? 'SIM' : 'NÃO'}`);
  console.log('======================================');
}

runTest().catch(err => {
  console.error('Falha no teste:', err);
  process.exit(1);
});
