import { guard } from './_guard.js';

// Le proxy n'accepte que les modèles utilisés par l'app, plafonne max_tokens et
// n'autorise que l'outil web_search. Avant : relais brut de n'importe quel body
// (modèle, tokens, serveurs MCP…) vers la clé Anthropic, ouvert à tous (CORS *).
const MODELS = new Set(['claude-haiku-4-5-20251001', 'claude-sonnet-4-5']);
const MAX_TOKENS = 4000;

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : { ...req.body }; }
  catch { return res.status(400).json({ error: 'JSON invalide' }); }

  if (!MODELS.has(body.model)) return res.status(400).json({ error: `Modèle non autorisé: ${body.model}` });
  body.max_tokens = Math.min(Number(body.max_tokens) || 1500, MAX_TOKENS);
  delete body.mcp_servers;
  if (body.tools) body.tools = body.tools.filter(t => t?.type?.startsWith('web_search'));
  if (body.tools && !body.tools.length) delete body.tools;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
