import { supabase } from '../src/database/supabase.js';

async function checkApprCols() {
  const { data, error } = await supabase.from('publication_approvals').select('*').limit(1);
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Columns in publication_approvals:', Object.keys(data[0] || {}));
  }
}

checkApprCols().then(() => process.exit(0));
