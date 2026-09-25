import { supabase } from '../src/database/supabase.js';

async function checkCols() {
  const { data, error } = await supabase.from('products').select('*').limit(1);
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Columns in products:', Object.keys(data[0] || {}));
    console.log('Sample product:', data[0]);
  }

  const { data: priceData } = await supabase.from('product_prices').select('*').limit(1);
  console.log('Sample price:', priceData?.[0]);
}

checkCols().then(() => process.exit(0));
