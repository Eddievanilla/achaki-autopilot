import NodeDiagnostics from '../src/services/creative-node/node-diagnostics.js';
import CreativeNodeInstaller from '../src/services/creative-node/node-installer.js';
import NodeRepairEngine from '../src/services/creative-node/node-repair.js';
import CreativeNodeSupervisor from '../src/services/creative-node/node-supervisor.js';

async function main() {
  console.log('=== 1. DIAGNÓSTICO DO COMPUTADOR ATUAL ===');
  const diag = await NodeDiagnostics.runFullDiagnostics();
  console.log(JSON.stringify(diag, null, 2));

  console.log('\n=== 2. INSTALANDO CREATIVE NODE ===');
  const installRes = await CreativeNodeInstaller.install();
  console.log('Install Result:', installRes);

  console.log('\n=== 3. AUTO-REPARO ===');
  const repairRes = await NodeRepairEngine.repairAll();
  console.log('Repair Result:', repairRes);

  console.log('\n=== 4. SUPERVISOR DE SAÚDE ===');
  const sup = await CreativeNodeSupervisor.evaluateHealth();
  console.log('Supervisor Health:', JSON.stringify(sup, null, 2));

  console.log('\n=== CONCLUÍDO COM SUCESSO ===');
}

main().catch(console.error);
