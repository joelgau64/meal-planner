export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });

  const googleKey = process.env.GOOGLE_SEARCH_API_KEY;
  const googleCX  = process.env.GOOGLE_SEARCH_CX;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const month = new Date().getMonth() + 1;
  const saison = month >= 3 && month <= 5 ? 'printemps' :
                 month >= 6 && month <= 8 ? 'été' :
                 month >= 9 && month <= 11 ? 'automne' : 'hiver';

  // ── 1. Essai Google Custom Search (gratuit, vraies URLs) ─────────────────
  if (googleKey && googleCX) {
    try {
      const q = encodeURIComponent(`${query} recette`);
      const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${googleCX}&q=${q}&num=9&lr=lang_fr&gl=fr`;
      const r = await fetch(url);
      const d = await r.json();

      if (d.error) {
        console.warn('[search] Google CSE error:', d.error.message);
      } else if (d.items?.length > 0) {
        const results = d.items.map(item => ({
          titre: item.title.replace(/\s*[-|]\s*(Marmiton|750g|CuisineAZ|Chef Simon|Cuisine AZ|Recette\.de)\s*$/gi, '').trim(),
          url: item.link,
          description: item.snippet,
          source: item.displayLink,
          categorie: 'Dîner',
          temps: null,
          difficulte: null,
          emoji: null,
        }));
        return res.status(200).json({ results, source: 'google' });
      }
    } catch (err) {
      console.warn('[search] Google CSE exception:', err.message);
    }
  }

  // ── 2. Fallback Claude (sans web search = rapide, ~3s) ───────────────────
  if (!anthropicKey) {
    return res.status(500).json({ error: 'Aucune source de recherche disponible (Google CSE non configuré, ANTHROPIC_API_KEY absent)', source: 'none' });
  }

  try {
    const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // Haiku = moins cher que Sonnet
        max_tokens: 1500,
        system: 'Tu es un chef cuisinier. Retourne UNIQUEMENT un tableau JSON valide, sans backtick.',
        messages: [{
          role: 'user',
          content: `Date: ${today}, saison: ${saison}, région: Île-de-France.
Demande: "${query}"
Propose 8 recettes adaptées, produits de saison, pour 4 personnes par défaut.
Pour chaque: {"titre":"...","description":"1-2 phrases appétissantes","categorie":"Déjeuner|Dîner|Dessert","temps":30,"difficulte":"Facile|Moyen|Difficile","url":"https://www.marmiton.org/recettes/recette_[slug].aspx","emoji":"🍽️"}
Tableau JSON de 8 objets, RIEN d'autre.`
        }],
      })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    const text = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array in response');
    const arr = JSON.parse(match[0]);
    return res.status(200).json({ results: arr, source: 'claude-haiku' });
  } catch (err) {
    return res.status(500).json({ error: `Claude fallback failed: ${err.message}`, source: 'error' });
  }
}
