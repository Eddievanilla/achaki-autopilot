import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxNzk2NTYsImV4cCI6MjEwNTc1NTY1Nn0.QSRQxVol0FYDtbbSxJ8_-jCMUcRD9ygiHZZI4wy7EGQ';

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

export default async function handler(req, res) {
  // Extrai trackingId da query ou do caminho
  const trackingId = req.query.trackingId || req.url.split('/go/')[1]?.split('?')[0];

  if (!trackingId) {
    return res.redirect(302, 'https://achaki-autopilot.vercel.app');
  }

  try {
    // 1. Busca a publicação associada ao trackingId
    const { data: pub, error: pubErr } = await supabase
      .from('publications')
      .select('*')
      .eq('tracking_id', trackingId)
      .maybeSingle();

    if (pubErr || !pub) {
      console.warn(`[Tracking] Tracking ID não localizado: ${trackingId}`);
      return res.redirect(302, 'https://achaki-autopilot.vercel.app');
    }

    // 2. Proteção contra contagem artificial repetida (mesmo IP em menos de 10s)
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'anonymous';
    const ua = req.headers['user-agent'] || '';
    const ipHash = crypto.createHash('sha256').update(`${ip}-${ua}`).digest('hex').substring(0, 16);

    const tenSecondsAgo = new Date(Date.now() - 10 * 1000).toISOString();
    const { data: recentClicks } = await supabase
      .from('click_events')
      .select('id')
      .eq('tracking_id', trackingId)
      .eq('user_agent_hash', ipHash)
      .gte('clicked_at', tenSecondsAgo)
      .limit(1);

    const isDuplicate = recentClicks && recentClicks.length > 0;

    if (!isDuplicate) {
      // 3. Registrar evento real de clique
      await supabase.from('click_events').insert({
        tracking_id: trackingId,
        publication_id: pub.id,
        product_id: pub.product_id,
        marketplace: pub.marketplace,
        social_network: pub.social_network || 'facebook',
        strategy_id: pub.strategy || null,
        user_agent_hash: ipHash,
        clicked_at: new Date().toISOString(),
      });

      // 4. Incrementar métrica na tabela publication_metrics
      const { data: metrics } = await supabase
        .from('publication_metrics')
        .select('id, clicks')
        .eq('publication_id', pub.id)
        .maybeSingle();

      if (metrics) {
        await supabase
          .from('publication_metrics')
          .update({
            clicks: (metrics.clicks || 0) + 1,
            collected_at: new Date().toISOString(),
          })
          .eq('id', metrics.id);
      } else {
        await supabase.from('publication_metrics').insert({
          publication_id: pub.id,
          clicks: 1,
        });
      }

      // 5. Incrementar meta diária em goals
      const { data: goal } = await supabase
        .from('goals')
        .select('current_value')
        .eq('metric_name', 'clicks_per_day')
        .maybeSingle();

      if (goal) {
        await supabase
          .from('goals')
          .update({
            current_value: (Number(goal.current_value) || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('metric_name', 'clicks_per_day');
      }

      // 6. Log de auditoria
      await supabase.from('system_activity_logs').insert({
        message: `Clique rastreado no Facebook (${pub.marketplace}): ${trackingId}`,
        level: 'info',
      });
    }

    // 7. Redirecionamento imediato para a URL de afiliado (ou produto)
    const targetUrl = pub.affiliate_url || pub.product_url || 'https://achaki-autopilot.vercel.app';
    res.writeHead(302, { Location: targetUrl });
    res.end();
  } catch (err) {
    console.error(`[Tracking] Erro no redirecionamento: ${err.message}`);
    return res.redirect(302, 'https://achaki-autopilot.vercel.app');
  }
}
