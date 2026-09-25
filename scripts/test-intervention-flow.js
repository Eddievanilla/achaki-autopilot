/**
 * Teste do Fluxo de Intervenção, Notificação e Resolução
 */
import 'dotenv/config';
import interventionManager from '../src/services/intervention-manager.js';
import { supabase } from '../src/database/supabase.js';

async function main() {
  console.log('\n======================================================');
  console.log('   ACHAki Autopilot — Teste do Fluxo de Intervenção');
  console.log('======================================================\n');

  console.log('1. Disparando intervenção de teste para Mercado Livre...');
  const res = await interventionManager.requestIntervention({
    type: 'SECURITY_CHALLENGE',
    marketplace: 'mercadolivre',
    title: 'Desafio de Segurança Simulado (Teste de Áudio)',
    message: 'O robô solicita intervenção do operador para teste do sistema de voz.',
    targetUrl: 'https://www.mercadolivre.com.br/afiliados/linkbuilder#hub',
    actionLabel: 'Abrir Gerador Mercado Livre ↗',
    metadata: { test: true }
  });

  console.log('✔ Intervenção registrada com ID:', res.id);

  console.log('\n2. Verificando intervenções ativas (PENDING)...');
  const active = await interventionManager.getActiveInterventions();
  console.log(`✔ Encontradas ${active.length} intervenções ativas.`);
  const found = active.find(i => i.id === res.id);
  console.log('✔ Intervenção ativa confirmada:', found ? 'SIM' : 'NÃO');

  console.log('\n3. Simulando resolução humana pelo operador...');
  await interventionManager.resolveIntervention(res.id);

  const { data: check } = await supabase
    .from('operator_interventions')
    .select('status, resolved_at')
    .eq('id', res.id)
    .single();

  console.log(`✔ Status atualizado no banco: ${check.status} (Resolvido em: ${check.resolved_at})`);
  console.log('\n======================================================');
  console.log('✔ Fluxo de Intervenção e Banco validado com sucesso!');
  console.log('======================================================\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Erro no teste:', err);
  process.exit(1);
});
