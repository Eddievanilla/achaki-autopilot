// Temporary script to test generatePost with a dummy product
import 'dotenv/config';
import OpenRouterAgent from '../src/agents/openrouter-agent.js';
import logger from '../src/utils/logger.js';

async function run() {
  const agent = new OpenRouterAgent();
  const product = {
    name: 'EcoBottle 500ml',
    price: 19.99,
    stars: 4.5,
    sales: 5000,
    link: 'https://example.com/ecobottle'
  };
  try {
    const result = await agent.generatePost(product);
    console.log('GENERATEPOST RESULT:');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    logger.error('generatePost test failed', err);
    process.exit(1);
  }
}

run();
