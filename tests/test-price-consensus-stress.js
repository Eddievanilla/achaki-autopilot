import { PriceValidationEngine } from '../src/services/price-validation-engine.js';
import { GoalOptimizer } from '../src/agents/goal-optimizer.js';

async function runTests() {
  console.log('===============================================================');
  console.log('🧪 TESTE DE ESTRESSE — ACHAki Autopilot Multi-Source & Consensus');
  console.log('===============================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`✓ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`✖ [FAIL] ${message}`);
    }
  }

  const pve = new PriceValidationEngine();

  // ─────────────────────────────────────────────────────────────────
  // TESTE 1: CAPTCHA na PDP tratado sem bypass -> Fallback para Fonte C
  // ─────────────────────────────────────────────────────────────────
  console.log('--- TESTE 1: CAPTCHA na PDP (SOURCE_UNAVAILABLE) com Fallback Legítimo ---');
  const candidateWithCaptchaPdp = {
    productId: 'MLB3800842215',
    title: 'Camiseta Dry-fit Preta Caveira Unisex Dark Lab',
    currentPrice: 69.90,
    originalPrice: 109.90,
    discountPercent: 36,
    productUrl: 'https://produto.mercadolivre.com.br/MLB-3800842215-mock-blocked',
    collectedAt: new Date().toISOString(),
    shipping: 'Full',
  };

  // Mock de page que retorna SECURITY_CHALLENGE para simular WAF/CAPTCHA real do ML
  const mockCaptchaPage = {
    goto: async () => {},
    waitForTimeout: async () => {},
    evaluate: async () => ({
      title: 'Mercado Libre',
      isAvailable: false,
      isSecurityChallenge: true,
      error: 'SECURITY_CHALLENGE',
    }),
  };

  const res1 = await pve.validateCandidatePrice(candidateWithCaptchaPdp, { page: mockCaptchaPage });
  assert(res1.isValid === true, 'Produto validado com sucesso mesmo com CAPTCHA na PDP');
  assert(res1.confidence === 'MEDIUM', 'Confiança definida como MEDIUM via Fonte C (Vitrine Real)');
  assert(res1.data.source === 'STOREFRONT_LISTING', 'Fonte primária atribuída como STOREFRONT_LISTING');
  assert(res1.data.pdpNote && res1.data.pdpNote.includes('PDP indisponível por checkpoint'), 'Registrou nota explícita sobre indisponibilidade de PDP sem bypass');
  assert(res1.data.currentPrice === 69.90, 'Preço mantido estritamente igual ao capturado (sem invenção)');

  // ─────────────────────────────────────────────────────────────────
  // TESTE 2: Preço Divergente Bloqueado (Confiança LOW -> Rejeitado)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- TESTE 2: Preço Divergente entre Fontes (Bloqueio Obrigatório) ---');
  const mockSupabaseDivergent = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({
              data: [{ current_price: 139.90, original_price: 180.00, discount_percent: 22, collected_at: new Date().toISOString() }]
            })
          })
        })
      })
    })
  };

  const candidateDivergent = {
    productId: 'MLB-DIV-TEST',
    dbId: 'prod-div-uuid',
    title: 'Produto Teste Preço Divergente',
    currentPrice: 69.90,
    originalPrice: 109.90,
    discountPercent: 36,
    productUrl: null, // Sem PDP para isolar teste de divergência Storefront vs Banco
    collectedAt: new Date().toISOString(),
  };

  const res2 = await pve.validateCandidatePrice(candidateDivergent, { supabase: mockSupabaseDivergent });
  assert(res2.isValid === false, 'Preço divergente foi BLOQUEADO com sucesso');
  assert(res2.confidence === 'LOW', 'Confiança classificada como LOW');
  assert(res2.validationCode === 'PRICE_VALIDATION_FAILED', 'Código de validação correto');

  // ─────────────────────────────────────────────────────────────────
  // TESTE 3: Desconto Falso / Inconsistência Matemática Bloqueada
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- TESTE 3: Inconsistência Matemática no Desconto (Tolerância Zero) ---');
  const candidateFakeDiscount = {
    productId: 'MLB-FAKE-DISC',
    title: 'Produto com Desconto Falso',
    currentPrice: 90.00,
    originalPrice: 100.00, // Desconto real é 10%
    discountPercent: 50,   // Tag alega falsamente 50%
    productUrl: null,
    collectedAt: new Date().toISOString(),
  };

  const res3 = await pve.validateCandidatePrice(candidateFakeDiscount, {});
  assert(res3.isValid === false, 'Desconto falso rejeitado pela validação matemática');
  assert(res3.confidence === 'LOW', 'Confiança LOW para dados inconsistentes');

  // ─────────────────────────────────────────────────────────────────
  // TESTE 4: Duas Fontes Compatíveis -> Consenso HIGH
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- TESTE 4: Consenso HIGH (Duas Fontes Compatíveis) ---');
  const mockSupabaseConsistent = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({
              data: [{ current_price: 69.90, original_price: 109.90, discount_percent: 36, collected_at: new Date().toISOString() }]
            })
          })
        })
      })
    })
  };

  const candidateHigh = {
    productId: 'MLB-HIGH-TEST',
    dbId: 'prod-high-uuid',
    title: 'Produto Consenso Alto',
    currentPrice: 69.90,
    originalPrice: 109.90,
    discountPercent: 36,
    productUrl: null,
    collectedAt: new Date().toISOString(),
  };

  const res4 = await pve.validateCandidatePrice(candidateHigh, { supabase: mockSupabaseConsistent });
  assert(res4.isValid === true, 'Produto com 2 fontes compatíveis validado');
  assert(res4.confidence === 'HIGH', 'Consenso classificado como HIGH');
  assert(res4.data.consensus.sourcesCount === 2, 'Total de fontes confirmadas: 2');

  // ─────────────────────────────────────────────────────────────────
  // TESTE 5: GoalOptimizer — Status Estritos e Ações Dinâmicas
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- TESTE 5: GoalOptimizer (Metas, Ritmo e Ações) ---');
  const optimizer = new GoalOptimizer({ targetClicks: 20 });

  const evalZero = optimizer.evaluate({ currentClicks: 0, publicationsToday: 0 });
  assert(evalZero.status === 'SEM DADOS', 'Status sem publicações é SEM DADOS');
  assert(evalZero.targetClicks === 20, 'Meta alvo é 20 cliques');

  const evalLow = optimizer.evaluate({ currentClicks: 2, publicationsToday: 3 });
  assert(evalLow.status === 'ABAIXO DO RITMO' || evalLow.status === 'NO RITMO', 'Status de ritmo avaliado');

  const evalFull = optimizer.evaluate({ currentClicks: 22, publicationsToday: 5 });
  assert(evalFull.status === 'META ATINGIDA', 'Status com 22 cliques é META ATINGIDA');

  console.log(`\n===============================================================`);
  console.log(`🏁 RESULTADO DOS TESTES UNITÁRIOS: ${passed}/${total} APROVADOS`);
  console.log(`===============================================================`);

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});
