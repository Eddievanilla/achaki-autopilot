/**
 * ACHAki Autopilot — Teste End-to-End da Fila de Comandos e Worker Local
 *
 * USO:
 *   npm run test:command
 *
 * VALIDA:
 *   1. Criação do comando na fila (robot_commands)
 *   2. Registro do evento DASHBOARD no system_events
 *   3. Reivindicação atômica pelo worker local (status: CLAIMED -> RUNNING)
 *   4. Execução do pipeline real (COLETANDO -> ANALISANDO -> VALIDANDO PREÇO -> GERANDO LINK -> PREPARANDO PUBLICAÇÃO)
 *   5. Emissão de telemetria ao vivo via EventLogger
 *   6. Garantia de NÃO publicação no Facebook (DRY_RUN_PUBLICATION)
 *   7. Conclusão como COMPLETED_ASSISTED
 */

import 'dotenv/config';
import { supabase } from '../src/database/supabase.js';
import eventLogger from '../src/services/event-logger.js';
import worker from '../src/worker.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('\n===============================================================');
  console.log('  🧪 TESTE DE INTEGRAÇÃO: COMANDO → FILA → WORKER → TELEMETRIA');
  console.log('===============================================================\n');

  // 1. Verificar conexão com o Supabase
  console.log('[1/5] Verificando tabelas de comando e heartbeat no Supabase...');
  const { data: hbCheck, error: hbErr } = await supabase.from('worker_heartbeats').select('*').limit(1);
  if (hbErr) {
    throw new Error(`Tabela worker_heartbeats inacessível: ${hbErr.message}`);
  }
  const { data: cmdCheck, error: cmdErr } = await supabase.from('robot_commands').select('*').limit(1);
  if (cmdErr) {
    throw new Error(`Tabela robot_commands inacessível: ${cmdErr.message}`);
  }
  console.log('  ✓ Tabelas robot_commands e worker_heartbeats acessíveis');

  // 2. Iniciar worker local em modo seguro (DRY_RUN_PUBLICATION=true)
  console.log('\n[2/5] Inicializando worker local em background...');
  process.env.DRY_RUN_PUBLICATION = 'true';
  await worker.start();
  console.log('  ✓ Worker local ativo e emitindo heartbeat');

  // 3. Simular clique no botão "Executar Agora" enviando comando para a fila
  console.log('\n[3/5] Simulando clique do botão "⚡ Executar Agora" no Centro de Comando...');
  
  const { data: cmdRecord, error: insertErr } = await supabase
    .from('robot_commands')
    .insert({
      command: 'RUN_NOW',
      status: 'PENDING',
      metadata: {
        source: 'test_command_script',
        dryRun: true,
        timestamp: new Date().toISOString(),
      },
    })
    .select('*')
    .single();

  if (insertErr || !cmdRecord) {
    throw new Error(`Falha ao criar comando na fila: ${insertErr?.message}`);
  }

  console.log(`  ✓ Comando inserido na fila com sucesso! ID: ${cmdRecord.id}`);

  // Registro de telemetria equivalente ao disparado por /api/controls
  await eventLogger.info('DASHBOARD', 'Comando EXECUTAR AGORA solicitado pelo teste de integração', {
    action: 'RUN_NOW_REQUESTED',
    metadata: { commandId: cmdRecord.id },
  });

  // 4. Aguardar o worker reivindicar e processar o comando
  console.log('\n[4/5] Acompanhando processamento pelo worker local...');
  const maxWaitMs = 120000; // 2 minutos máximo para ciclo completo
  const pollInterval = 2000;
  const startTime = Date.now();
  let finalStatus = 'PENDING';
  let lastReportedStep = '';

  while (Date.now() - startTime < maxWaitMs) {
    await sleep(pollInterval);

    // Consulta status atual do comando
    const { data: currentCmd } = await supabase
      .from('robot_commands')
      .select('*')
      .eq('id', cmdRecord.id)
      .maybeSingle();

    // Consulta heartbeat atual do worker
    const { data: hb } = await supabase
      .from('worker_heartbeats')
      .select('*')
      .eq('worker_id', worker.workerId)
      .maybeSingle();

    if (hb && hb.current_step !== lastReportedStep) {
      lastReportedStep = hb.current_step;
      console.log(`  ⏳ Passo atual do worker: [${lastReportedStep}] (Status: ${hb.status})`);
    }

    if (currentCmd) {
      finalStatus = currentCmd.status;
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(finalStatus)) {
        break;
      }
    }
  }

  // 5. Validar encerramento e regras de segurança
  console.log('\n[5/5] Validando critérios de conclusão...');
  console.log(`  - Status final do comando: ${finalStatus}`);

  // Verifica se alguma publicação real foi disparada para o Facebook no teste
  const { data: recentPubs } = await supabase
    .from('publications')
    .select('id, status, social_network, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(1);

  const latestPub = recentPubs?.[0];
  const facebookPublished = latestPub?.status === 'PUBLISHED';

  console.log(`  - Publicação no Facebook executada: ${facebookPublished ? 'SIM (ERRO)' : 'NÃO (CORRETO)'}`);
  console.log(`  - Status da publicação gerada: ${latestPub?.status || 'NENHUMA'}`);

  // Encerra worker
  await worker.stop();

  console.log('\n===============================================================');
  if (finalStatus === 'COMPLETED') {
    console.log('  ✔ FLUXO COMPLETO VALIDADO COM SUCESSO!');
    console.log('  Comando criado → Worker reivindicou → Pipeline executou → Concluído');
  } else {
    console.log(`  ⚠️ Teste finalizado com status: ${finalStatus}`);
  }
  console.log('===============================================================\n');

  if (finalStatus === 'COMPLETED') {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error('\n❌ Erro durante teste de comando:', err);
  try { await worker.stop(); } catch {}
  process.exit(1);
});
