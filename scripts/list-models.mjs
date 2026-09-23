/**
 * Script utilitário — extrai modelos baratos do catálogo OpenRouter.
 * Lê o JSON da API, filtra text->text, ordena por preço (prompt+completion).
 * Usado apenas durante setup — não faz parte do produto.
 */
import fs from 'fs';

const raw = fs.readFileSync(
  'C:/Users/Eddie Vanilla/.gemini/antigravity-ide/brain/633dc4d9-fa19-4c31-a52c-41da88c328ef/.system_generated/steps/90/content.md',
  'utf8'
);

// Extrai o JSON do conteúdo markdown
const jsonStart = raw.indexOf('{"data":[');
const jsonStr   = raw.slice(jsonStart);
const data      = JSON.parse(jsonStr);

const models = data.data
  .filter(m => {
    const mod = m.architecture?.modality || '';
    return mod.includes('text->text') || mod.startsWith('text');
  })
  .map(m => ({
    id:         m.id,
    name:       m.name,
    prompt:     parseFloat(m.pricing?.prompt  || 9999),
    completion: parseFloat(m.pricing?.completion || 9999),
    total:      parseFloat(m.pricing?.prompt || 9999) + parseFloat(m.pricing?.completion || 9999),
    context:    m.context_length,
    json:       (m.supported_parameters || []).includes('structured_outputs') ||
                (m.supported_parameters || []).includes('response_format'),
  }))
  .filter(m => !m.id.includes(':free') && m.total < 0.0000015)  // excluir gratuitos e caros
  .sort((a, b) => a.total - b.total)
  .slice(0, 30);

models.forEach(m => {
  const pPer1k  = (m.prompt     * 1_000_000).toFixed(4);
  const cPer1k  = (m.completion * 1_000_000).toFixed(4);
  const jsonTag = m.json ? '✓JSON' : '     ';
  console.log(`${jsonTag} | $${pPer1k}/$${cPer1k} per 1M tok | ${m.id}`);
});
