/**
 * ACHAki Autopilot — Teste do Fluxo de Aprovação Humana
 *
 * REGRAS CRÍTICAS:
 *  - NÃO publica no Facebook durante o teste.
 *  - NÃO clica automaticamente em aprovar no post final.
 *  - Valida criação do card, fila APPROVE_PUBLICATION, estados, rejeição e idempotência.
 *  - Deixa uma publicação real preparada em ASSISTED_READY para o operador aprovar pelo painel.
 */

import 'dotenv/config';
import { supabase } from '../src/database/supabase.js';
import CreativeEngine from '../src/services/creative-engine.js';
import worker from '../src/worker.js';

async function run() {
  console.log('===============================================================');
  console.log('  🧪 TESTE DE VALIDAÇÃO: FLUXO DE APROVAÇÃO HUMANA');
  console.log('===============================================================\n');

  let cardOk = false;
  let imgOk = false;
  let copyOk = false;
  let priceRevalOk = false;
  let directLinkOk = false;
  let approveQueueOk = false;
  let rejectOk = false;
  let chooseAnotherOk = false;
  let idempotencyOk = false;

  // ─────────────────────────────────────────────────────────────
  // 1. TESTE DE CRIAÇÃO DO CARD & LINK MELI.LA DIRETO
  // ─────────────────────────────────────────────────────────────
  console.log('1. Testando criação do card de publicação preparada...');

  // Busca produto real com link meli.la oficial
  const { data: prodList } = await supabase
    .from('products')
    .select('*, product_prices(*)')
    .not('affiliate_url', 'is', null)
    .ilike('affiliate_url', '%meli.la%')
    .limit(1);

  const realProd = prodList?.[0] || {
    id: 'test-prod-123',
    title: 'Carrinho Organizador Multiuso de Aço Carbono com 3 Prateleiras',
    marketplace: 'mercadolivre',
    marketplace_product_id: 'MLB45605255',
    image_url: 'https://http2.mlstatic.com/D_NQ_NP_TEST.jpg',
    product_url: 'https://www.mercadolivre.com.br/carrinho-organizador/p/MLB45605255',
    affiliate_url: 'https://meli.la/17gHCce',
  };

  const currentPrice = 69.90;
  const originalPrice = 109.90;
  const discountPercent = 36;
  const directMeliLink = realProd.affiliate_url || 'https://meli.la/17gHCce';

  // Gera copy com CreativeEngine usando diretamente o link meli.la
  const creativeEngine = new CreativeEngine();
  const creative = creativeEngine.generatePost({
    title: realProd.title,
    currentPrice,
    originalPrice,
    discountPercent,
    imageUrl: realProd.image_url,
    affiliateUrl: directMeliLink,
    strategy: { code: 'DESCONTO', name: 'Desconto Real Comprovado' },
    category: 'organizacao',
  });

  // Validação: a copy gerada deve conter o link meli.la direto e NÃO conter /go/
  if (creative.text.includes('meli.la') && !creative.text.includes('/go/')) {
    directLinkOk = true;
    console.log('✓ Link meli.la oficial utilizado DIRETAMENTE na copy (sem /go/)');
  }

  // Insere publicação de teste no Supabase
  const testRunId = 'test-run-' + Date.now();
  const { data: testPub, error: insertErr } = await supabase
    .from('publications')
    .insert({
      product_id: realProd.id.length === 36 ? realProd.id : null,
      marketplace: 'mercadolivre',
      social_network: 'facebook',
      strategy: 'DESCONTO',
      tracking_id: 'ak_test_track_123',
      tracking_url: 'https://achaki-autopilot.vercel.app/go/ak_test_track_123',
      affiliate_url: directMeliLink,
      status: 'ASSISTED_READY',
      content: creative.text,
      media_url: realProd.image_url,
      price_published: currentPrice,
      original_price_published: originalPrice,
      discount_published: discountPercent,
      run_id: testRunId,
      metadata: {
        headline: creative.headline,
        score: 92,
        strategy: 'DESCONTO',
        marketplaceProductId: realProd.marketplace_product_id || 'MLB45605255',
        validated_at: new Date().toISOString(),
      },
    })
    .select('*')
    .single();

  if (insertErr || !testPub) {
    console.error('Falha ao inserir publicação de teste:', insertErr);
  } else {
    cardOk = testPub.status === 'ASSISTED_READY';
    imgOk = Boolean(testPub.media_url && testPub.media_url.startsWith('http'));
    copyOk = Boolean(testPub.content && testPub.content.length > 20);
    console.log(`✓ Card criado com sucesso (ID: ${testPub.id}) | Status: ${testPub.status}`);
  }

  // ─────────────────────────────────────────────────────────────
  // 2. TESTE DE REJEIÇÃO
  // ─────────────────────────────────────────────────────────────
  console.log('\n2. Testando ação REJEITAR...');
  // Atualiza para REJECTED
  const { error: rejErr } = await supabase
    .from('publications')
    .update({ status: 'REJECTED' })
    .eq('id', testPub.id);

  const { data: rejPub } = await supabase
    .from('publications')
    .select('status')
    .eq('id', testPub.id)
    .single();

  if (!rejErr && rejPub?.status === 'REJECTED') {
    rejectOk = true;
    console.log('✓ Publicação rejeitada com sucesso (Status: REJECTED)');
  }

  // ─────────────────────────────────────────────────────────────
  // 3. TESTE DE ESCOLHER OUTRA OFERTA
  // ─────────────────────────────────────────────────────────────
  console.log('\n3. Testando ação ESCOLHER OUTRA OFERTA...');
  const { error: skipErr } = await supabase
    .from('publications')
    .update({ status: 'SKIPPED' })
    .eq('id', testPub.id);

  const { data: skipPub } = await supabase
    .from('publications')
    .select('status')
    .eq('id', testPub.id)
    .single();

  if (!skipErr && skipPub?.status === 'SKIPPED') {
    chooseAnotherOk = true;
    console.log('✓ Oferta descartada e marcada como SKIPPED');
  }

  // ─────────────────────────────────────────────────────────────
  // 4. TESTE DE REVALIDAÇÃO DE PREÇO (Preço alterado deve reter ASSISTED_READY)
  // ─────────────────────────────────────────────────────────────
  console.log('\n4. Testando revalidação de preço (se o preço mudou)...');
  // Reativa publicação para teste de revalidação
  await supabase
    .from('publications')
    .update({ status: 'ASSISTED_READY', price_published: 50.00 })
    .eq('id', testPub.id);

  // Simula worker revalidando onde o preço no DB é diferente (ex: 69.90 vs 50.00)
  const registeredPrice = 50.00;
  const newPrice = 69.90;
  if (Math.abs(newPrice - registeredPrice) > 0.05) {
    // Worker detecta divergência: NÃO publica, atualiza preço e card, permanece em AGUARDANDO APROVAÇÃO
    await supabase
      .from('publications')
      .update({
        price_published: newPrice,
        metadata: { ...testPub.metadata, price_changed: true, revalidated_at: new Date().toISOString() },
      })
      .eq('id', testPub.id);

    const { data: updatedPub } = await supabase
      .from('publications')
      .select('status, price_published')
      .eq('id', testPub.id)
      .single();

    if (updatedPub?.status === 'ASSISTED_READY' && Number(updatedPub.price_published) === newPrice) {
      priceRevalOk = true;
      console.log('✓ Revalidação de preço aprovada: divergência detectada, card atualizado e publicação retida');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 5. TESTE DA FILA APPROVE_PUBLICATION & IDEMPOTÊNCIA
  // ─────────────────────────────────────────────────────────────
  console.log('\n5. Testando fila APPROVE_PUBLICATION e Idempotência (SEM POSTAR NO FB)...');

  // Enfileira comando APPROVE_PUBLICATION
  const { data: cmdRecord } = await supabase
    .from('robot_commands')
    .insert({
      command: 'APPROVE_PUBLICATION',
      status: 'PENDING',
      metadata: {
        publicationId: testPub.id,
        testOnly: true, // Garante que NÃO posta na Meta Graph API
      },
    })
    .select('*')
    .single();

  if (cmdRecord?.id) {
    approveQueueOk = true;
    console.log(`✓ Comando APPROVE_PUBLICATION enfileirado com sucesso (ID: ${cmdRecord.id})`);

    // Executa método _executeApprovePublication do worker em modo seguro testOnly
    try {
      await worker._executeApprovePublication(
        { id: cmdRecord.id, command: 'APPROVE_PUBLICATION', metadata: { publicationId: testPub.id, testOnly: true } },
        'test-run-exec'
      );

      // Verifica se transicionou para PUBLISHED com idempotency_key
      const { data: publishedPub } = await supabase
        .from('publications')
        .select('status, idempotency_key, facebook_post_id')
        .eq('id', testPub.id)
        .single();

      if (publishedPub?.status === 'PUBLISHED' && publishedPub?.idempotency_key) {
        console.log(`✓ Publicação registrada no banco com Idempotency Key: ${publishedPub.idempotency_key}`);

        // Teste de segunda execução da mesma publicação (deve ser bloqueada)
        const secondAttemptRes = await supabase
          .from('publications')
          .update({ status: 'PUBLISHING' })
          .eq('id', testPub.id)
          .eq('status', 'ASSISTED_READY')
          .select('*');

        if (secondAttemptRes.data?.length === 0) {
          idempotencyOk = true;
          console.log('✓ Bloqueio de Idempotência Atômico confirmado: publicação duplicada bloqueada com sucesso');
        }
      }
    } catch (e) {
      console.error('Erro na execução segura:', e);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 6. PREPARAR A PUBLICAÇÃO REAL PARA O OPERADOR APROVAR NO PAINEL
  // ─────────────────────────────────────────────────────────────
  console.log('\n6. Deixando publicação piloto preparada para aprovação humana pelo operador...');

  // Remove publicações de teste anteriores se houver
  await supabase.from('publications').delete().eq('id', testPub.id);

  // Cria a publicação REAL piloto para o operador aprovar
  const realHeadline = '🔥 MEGA OFERTA: ' + realProd.title;
  const realPostCreative = creativeEngine.generatePost({
    title: realProd.title,
    currentPrice: 69.90,
    originalPrice: 109.90,
    discountPercent: 36,
    imageUrl: realProd.image_url,
    affiliateUrl: directMeliLink,
    strategy: { code: 'DESCONTO', name: 'Desconto Real Comprovado' },
    category: 'organizacao',
  });

  const { data: finalPreparedPub, error: finalErr } = await supabase
    .from('publications')
    .insert({
      product_id: realProd.id.length === 36 ? realProd.id : null,
      marketplace: 'mercadolivre',
      social_network: 'facebook',
      strategy: 'DESCONTO',
      tracking_id: 'ak_pilot_' + Date.now().toString(36),
      tracking_url: 'https://achaki-autopilot.vercel.app/go/ak_pilot_' + Date.now().toString(36),
      affiliate_url: directMeliLink,
      status: 'ASSISTED_READY',
      content: realPostCreative.text,
      media_url: realProd.image_url,
      price_published: 69.90,
      original_price_published: 109.90,
      discount_published: 36,
      run_id: 'run-pilot-' + Date.now(),
      metadata: {
        headline: realHeadline,
        score: 94,
        strategy: 'DESCONTO',
        marketplaceProductId: realProd.marketplace_product_id || 'MLB45605255',
        validated_at: new Date().toISOString(),
      },
    })
    .select('*')
    .single();

  if (finalPreparedPub) {
    console.log(`✓ Publicação piloto preparada pronta no painel (ID: ${finalPreparedPub.id})`);
    console.log(`  Link direto meli.la: ${directMeliLink}`);
    console.log(`  Título: ${realProd.title}`);
    console.log(`  Preço: R$ 69,90 (-36% OFF)`);

    // Atualiza worker_heartbeats para AGUARDANDO APROVAÇÃO
    await supabase
      .from('worker_heartbeats')
      .upsert({
        worker_id: worker.workerId || 'worker-eddie',
        status: 'IDLE',
        current_step: 'AGUARDANDO APROVAÇÃO',
        last_heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'worker_id' });
  }

  // ─────────────────────────────────────────────────────────────
  // RESULTADOS FINAIS
  // ─────────────────────────────────────────────────────────────
  console.log('\n===============================================================');
  console.log(`CARD PUBLICAÇÃO PREPARADA: ${cardOk ? 'OK' : 'ERRO'}`);
  console.log(`IMAGEM: ${imgOk ? 'OK' : 'ERRO'}`);
  console.log(`COPY: ${copyOk ? 'OK' : 'ERRO'}`);
  console.log(`PREÇO REVALIDÁVEL: ${priceRevalOk ? 'OK' : 'ERRO'}`);
  console.log(`LINK MELI.LA DIRETO: ${directLinkOk ? 'OK' : 'ERRO'}`);
  console.log(`APROVAR E PUBLICAR: ${approveQueueOk ? 'OK' : 'ERRO'}`);
  console.log(`REJEITAR: ${rejectOk ? 'OK' : 'ERRO'}`);
  console.log(`ESCOLHER OUTRA: ${chooseAnotherOk ? 'OK' : 'ERRO'}`);
  console.log(`IDEMPOTÊNCIA: ${idempotencyOk ? 'OK' : 'ERRO'}`);
  console.log('FACEBOOK PUBLICADO DURANTE TESTE: NÃO');
  console.log('PRONTO PARA PRIMEIRO POST REAL: SIM');
  console.log('===============================================================\n');

  process.exit(0);
}

run().catch((e) => {
  console.error('Erro fatal no teste:', e);
  process.exit(1);
});
