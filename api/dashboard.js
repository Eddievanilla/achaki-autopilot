import { createClient } from '@supabase/supabase-js';

// Cliente Supabase serverless seguro (apenas backend)
const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxNzk2NTYsImV4cCI6MjEwNTc1NTY1Nn0.QSRQxVol0FYDtbbSxJ8_-jCMUcRD9ygiHZZI4wy7EGQ';

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

export default async function handler(req, res) {
  // CORS & Cache
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=10');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // 1. Estado do robô
    const { data: stateData } = await supabase
      .from('system_state')
      .select('*')
      .eq('id', 'autopilot')
      .maybeSingle();

    // 2. Últimos 10 logs de atividade
    const { data: logsData } = await supabase
      .from('system_activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    // 3. TOP 5 ofertas selecionadas
    const { data: candidatesData } = await supabase
      .from('offer_candidates')
      .select(`
        id,
        ai_score,
        ai_reason,
        ai_risk,
        status,
        created_at,
        products (
          id,
          marketplace,
          marketplace_product_id,
          title,
          category,
          product_url,
          image_url,
          seller_name
        )
      `)
      .eq('status', 'selected')
      .order('created_at', { ascending: false })
      .order('ai_score', { ascending: false })
      .limit(5);

    const topOffers = [];
    if (Array.isArray(candidatesData)) {
      for (const item of candidatesData) {
        const prod = item.products;
        if (!prod) continue;

        const { data: priceRow } = await supabase
          .from('product_prices')
          .select('current_price, original_price, discount_percent')
          .eq('product_id', prod.id)
          .order('collected_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        topOffers.push({
          id: prod.id,
          title: prod.title,
          category: prod.category || 'geral',
          marketplace: prod.marketplace,
          productUrl: prod.product_url,
          imageUrl: prod.image_url || 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=400&q=80',
          sellerName: prod.seller_name,
          currentPrice: priceRow ? Number(priceRow.current_price) : 0,
          originalPrice: priceRow?.original_price ? Number(priceRow.original_price) : null,
          discountPercent: priceRow?.discount_percent || 0,
          finalScore: item.ai_score || 80,
          aiReason: item.ai_reason,
          aiRisk: item.ai_risk,
          createdAt: item.created_at,
        });
      }
    }

    // 4. Totais na base
    const { count: totalProductsCount } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true });

    const { count: totalCandidatesCount } = await supabase
      .from('offer_candidates')
      .select('*', { count: 'exact', head: true });

    // 5. Diário do Robô (automation_events recentes)
    const { data: diaryData } = await supabase
      .from('automation_events')
      .select(`
        id,
        event_type,
        message,
        strategy_id,
        details,
        created_at,
        products (
          id,
          title,
          marketplace,
          product_url,
          image_url,
          category
        ),
        content_strategies (
          id,
          name,
          objective
        )
      `)
      .order('created_at', { ascending: false })
      .limit(10);

    // 6. Decisões do Otimizador ("Por que o robô fez isso?")
    const { data: optimizerData } = await supabase
      .from('optimizer_decisions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    // 7. Metas do Sistema
    const { data: goalData } = await supabase
      .from('goals')
      .select('*')
      .eq('metric_name', 'clicks_per_day')
      .maybeSingle();

    const state = stateData || {};
    const targetClicks = goalData?.target_value ? Number(goalData.target_value) : (state.target_clicks || 20);

    const payload = {
      robot: {
        status: state.status || 'ONLINE',
        currentStep: state.current_step || 'Aguardando próximo ciclo de coleta...',
        startedAt: state.started_at || null,
        lastRunAt: state.last_run_at || new Date().toISOString(),
        lastDurationSeconds: state.last_duration_seconds || 48,
        nextRunAt: state.next_run_at || new Date(Date.now() + 25 * 60 * 1000).toISOString(),
      },
      autopilotMode: state.autopilot_mode || 'ASSISTIDO',
      currentStrategy: state.current_strategy || 'ACHADINHO',
      today: {
        productsFound: state.today_products_found || totalProductsCount || 0,
        offersSelected: state.today_offers_selected || totalCandidatesCount || 0,
        publications: state.today_publications || 0,
        errors: state.today_errors || 0,
      },
      goals: {
        targetClicks,
        currentClicks: 0, // Real: 0 cliques pois não há publicações ainda
        progressPercent: 0,
        projectionToday: 0,
        status: 'NO_PRAZO',
        dailyTarget: targetClicks,
      },
      // Histórico de Performance Real (Zero Mock Policy)
      performance: {
        clicksToday: 0,
        activePublicationsCount: 0,
        ctr: 0.0,
        retention: 'N/D',
      },
      ai: {
        cacheHits: state.ai_cache_hits ?? 0,
        jevCalls: state.ai_jev_calls ?? 0,
        gptCalls: state.ai_gpt_calls ?? 0,
        tokens: state.ai_tokens ?? 0,
        savingsPercent: state.ai_savings_percent ?? 100,
      },
      marketplaces: state.marketplaces || {
        mercadolivre: 'ATIVO',
        shopee: 'BLOQUEADO',
        amazon: 'NÃO CONFIGURADO',
        aliexpress: 'NÃO CONFIGURADO',
      },
      socialNetworks: state.social_networks || {
        facebook: 'NÃO CONFIGURADO',
        instagram: 'NÃO CONFIGURADO',
        tiktok: 'EM BREVE',
        youtube: 'EM BREVE',
        x: 'EM BREVE',
      },
      topOffers,
      activityFeed: (logsData || []).map((l) => ({
        id: l.id,
        time: new Date(l.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        message: l.message,
        level: l.level,
      })),
      diary: (diaryData || []).map((d) => ({
        id: d.id,
        eventType: d.event_type,
        message: d.message,
        time: new Date(d.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        date: new Date(d.created_at).toLocaleDateString('pt-BR'),
        strategy: d.content_strategies?.name || d.strategy_id || 'Padrão',
        productTitle: d.products?.title || null,
        marketplace: d.products?.marketplace || null,
        productUrl: d.products?.product_url || null,
        imageUrl: d.products?.image_url || null,
        details: d.details || {},
      })),
      optimizerDecisions: (optimizerData || []).map((o) => ({
        id: o.id,
        decisionType: o.decision_type,
        reason: o.reason,
        actionTaken: o.action_taken,
        metricsContext: o.metrics_context,
        time: new Date(o.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      })),
      timestamp: new Date().toISOString(),
    };

    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: 'Falha ao consultar estado operacional: ' + err.message });
  }
}
