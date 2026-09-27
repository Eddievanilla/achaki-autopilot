import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://fobehbttydmqupfpioux.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvYmVoYnR0eWRtcXVwZnBpb3V4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDE3OTY1NiwiZXhwIjoyMTA1NzU1NjU2fQ.zNuSE747_XrdbGPp6I-K4XY3P1xO9ZWkEn7dhBZREmo';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTables() {
  console.log('🔍 Inspecionando tabelas creative_assets e creative_versions...');

  const { data: assets, error: errAssets } = await supabase
    .from('creative_assets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3);

  if (errAssets) {
    console.error('❌ Erro em creative_assets:', errAssets.message);
  } else {
    console.log(`✅ creative_assets acessível! Encontrados ${assets.length} registros recentes.`);
    if (assets.length > 0) {
      console.log('Campos de creative_assets:', Object.keys(assets[0]));
    }
  }

  const { data: versions, error: errVersions } = await supabase
    .from('creative_versions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3);

  if (errVersions) {
    console.error('❌ Erro em creative_versions:', errVersions.message);
  } else {
    console.log(`✅ creative_versions acessível! Encontrados ${versions.length} registros recentes.`);
    if (versions.length > 0) {
      console.log('Campos de creative_versions:', Object.keys(versions[0]));
    }
  }

  const { data: jobs, error: errJobs } = await supabase
    .from('creative_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3);

  if (errJobs) {
    console.error('❌ Erro em creative_jobs:', errJobs.message);
  } else {
    console.log(`✅ creative_jobs acessível! Último status:`, jobs.map(j => ({ id: j.id, status: j.status, creative_id: j.creative_id })));
  }
}

checkTables();
