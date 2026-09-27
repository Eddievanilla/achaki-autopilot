import localCreativeCacheManager from '../src/services/factory/local-creative-cache-manager.js';

async function testEtapa4() {
  console.log('🧪 Iniciando teste da Etapa 4 (Auto-Limpeza e Zero Bytes)...');

  console.log('\n🧹 1. Executando varredura de cache expirado nos diretórios temporários...');
  const res = await localCreativeCacheManager.cleanExpiredCache();
  console.log(`✅ Varredura concluída: ${res.deletedCount} itens limpos (${(res.freedBytes / 1024 / 1024).toFixed(2)} MB liberados).`);

  console.log('\n🧪 2. Testando cleanJobArtifacts com mock job...');
  const cleanRes = await localCreativeCacheManager.cleanJobArtifacts({
    creativeId: 'test_mock_job_123',
    version: 1,
  });
  console.log(`✅ cleanJobArtifacts concluído (${cleanRes.freedBytes} bytes).`);

  console.log('\n🎉 Teste da Etapa 4 finalizado com sucesso!');
}

testEtapa4().catch(err => {
  console.error('❌ Falha no teste da Etapa 4:', err);
  process.exit(1);
});
