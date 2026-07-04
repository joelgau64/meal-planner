export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });

  const spoonacularKey = process.env.SPOONACULAR_API_KEY;
  const googleKey      = process.env.GOOGLE_SEARCH_API_KEY;
  const googleCX       = process.env.GOOGLE_SEARCH_CX;
  const anthropicKey   = process.env.ANTHROPIC_API_KEY;

  const month = new Date().getMonth() + 1;
  const saison = month >= 3 && month <= 5 ? 'printemps' :
                 month >= 6 && month <= 8 ? 'été' :
                 month >= 9 && month <= 11 ? 'automne' : 'hiver';
  const EMOJIS = ['🍽️','🥗','🍲','🥘','🍜','🥩','🐟','🥦','🍋','🫐','🥑','🍅'];

  // ── 1. Brave Search (sites validés FR, 2000 req/mois gratuit) ──────────────
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (braveKey) {
    const SITES = '(site:marmiton.org OR site:750g.com OR site:jow.fr OR site:cuisineaz.com)';
    const braveSearch = async (q) => {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10&country=fr&search_lang=fr`;
      const r = await fetch(url, { headers: { 'Accept': 'application/json', 'X-Subscription-Token': braveKey } });
      if (!r.ok) throw new Error(`Brave HTTP ${r.status}`);
      const d = await r.json();
      return d.web?.results || [];
    };
    try {
      // 1er essai : sites validés uniquement. Retry sans filtre si vide.
      let items = await braveSearch(`recette ${query} ${SITES}`);
      if (items.length === 0) items = await braveSearch(`recette ${query}`);
      if (items.length > 0) {
        const results = items.slice(0, 9).map((item, i) => ({
          titre: item.title.replace(/\s*[-|:]\s*(Marmiton|750g|CuisineAZ|Jow|Cuisine AZ|Recette.*)$/gi, '').trim(),
          url: item.url,
          description: (item.description || '').replace(/<[^>]+>/g, ''),
          source: item.meta_url?.hostname || 'web',
          categorie: 'Dîner',
          temps: null,
          difficulte: null,
          emoji: EMOJIS[i % EMOJIS.length],
          image: item.thumbnail?.src || null,
        }));
        return res.status(200).json({ results, source: 'brave' });
      }
    } catch (err) {
      console.warn('[search] Brave:', err.message);
    }
  }

  // ── 2. Spoonacular ───────────────────────────────────────────────────────────
  if (spoonacularKey) {
    try {
      const q = encodeURIComponent(query);
      const url = `https://api.spoonacular.com/recipes/complexSearch?apiKey=${spoonacularKey}&query=${q}&number=9&addRecipeInformation=true&instructionsRequired=true&sort=relevance`;
      const r = await fetch(url);
      const d = await r.json();
      if (d.results?.length > 0) {
        const results = d.results.map((r, i) => ({
          titre: r.title,
          url: r.sourceUrl || '',
          description: r.summary ? r.summary.replace(/<[^>]+>/g, '').substring(0, 160) + '…' : '',
          source: r.sourceName || 'Spoonacular',
          categorie: r.dishTypes?.includes('dessert') ? 'Dessert'
                   : r.dishTypes?.includes('lunch') ? 'Déjeuner' : 'Dîner',
          temps: r.readyInMinutes || null,
          difficulte: !r.readyInMinutes || r.readyInMinutes <= 20 ? 'Facile'
                    : r.readyInMinutes <= 45 ? 'Moyen' : 'Difficile',
          emoji: EMOJIS[i % EMOJIS.length],
          image: r.image || null,
          spoonacularId: r.id,
        }));
        return res.status(200).json({ results, source: 'spoonacular' });
      }
    } catch (err) {
      console.warn('[search] Spoonacular:', err.message);
    }
  }

  // ── 3. Fallback Claude Haiku ────────────────────────────────────────────────
  if (!anthropicKey) return res.status(500).json({ error: 'Aucune source disponible', source: 'none' });
  try {
    const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 1500,
        system: 'Chef cuisinier. Retourne UNIQUEMENT un tableau JSON valide, sans backtick.',
        messages: [{ role: 'user', content: `Date: ${today}, saison: ${saison}, région: Île-de-France. Demande: "${query}". 8 recettes pour 4 personnes. Format: {"titre":"...","description":"...","categorie":"Déjeuner|Dîner|Dessert","temps":30,"difficulte":"Facile|Moyen|Difficile","url":"","emoji":"🍽️"}. Tableau JSON UNIQUEMENT.` }],
      })
    });
    const d = await r.json();
    const text = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON');
    return res.status(200).json({ results: JSON.parse(match[0]), source: 'claude-haiku' });
  } catch (err) {
    return res.status(500).json({ error: err.message, source: 'error' });
  }
}
