export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });

  const spoonacularKey = process.env.SPOONACULAR_API_KEY;
  const anthropicKey   = process.env.ANTHROPIC_API_KEY;

  const month = new Date().getMonth() + 1;
  const saison = month >= 3 && month <= 5 ? 'printemps' :
                 month >= 6 && month <= 8 ? 'été' :
                 month >= 9 && month <= 11 ? 'automne' : 'hiver';

  // ── 1. Spoonacular (gratuit 150 req/jour, vraies recettes) ────────────────
  if (spoonacularKey) {
    try {
      const q = encodeURIComponent(query);
      const url = `https://api.spoonacular.com/recipes/complexSearch?apiKey=${spoonacularKey}&query=${q}&number=9&addRecipeInformation=true&language=fr&sort=relevance`;
      const r = await fetch(url);
      const d = await r.json();

      if (d.status === 'failure') {
        console.warn('[search] Spoonacular error:', d.message);
      } else if (d.results?.length > 0) {
        const EMOJIS = ['🍽️','🥗','🍲','🥘','🍜','🥩','🐟','🥦','🍋','🫐'];
        const results = d.results.map((r, i) => ({
          titre: r.title,
          url: r.sourceUrl || r.spoonacularSourceUrl || '',
          description: r.summary
            ? r.summary.replace(/<[^>]+>/g, '').substring(0, 150) + '…'
            : `${r.readyInMinutes} min · ${r.servings} pers.`,
          source: r.creditsText || r.sourceName || 'Spoonacular',
          categorie: r.dishTypes?.includes('dessert') ? 'Dessert'
                   : r.dishTypes?.includes('lunch') ? 'Déjeuner' : 'Dîner',
          temps: r.readyInMinutes || null,
          difficulte: r.readyInMinutes < 20 ? 'Facile'
                    : r.readyInMinutes < 45 ? 'Moyen' : 'Difficile',
          emoji: EMOJIS[i % EMOJIS.length],
          image: r.image || null,
          spoonacularId: r.id,
        }));
        return res.status(200).json({ results, source: 'spoonacular' });
      }
    } catch (err) {
      console.warn('[search] Spoonacular exception:', err.message);
    }
  }

  // ── 2. Fallback Claude Haiku (sans web search, ~3s) ───────────────────────
  if (!anthropicKey) {
    return res.status(500).json({ error: 'Aucune source disponible', source: 'none' });
  }

  try {
    const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: 'Tu es un chef cuisinier. Retourne UNIQUEMENT un tableau JSON valide, sans backtick.',
        messages: [{
          role: 'user',
          content: `Date: ${today}, saison: ${saison}, région: Île-de-France.
Demande: "${query}"
Propose 8 recettes adaptées, produits de saison, pour 4 personnes.
Pour chaque: {"titre":"...","description":"1-2 phrases appétissantes","categorie":"Déjeuner|Dîner|Dessert","temps":30,"difficulte":"Facile|Moyen|Difficile","url":"https://www.marmiton.org/recettes/recette_[slug].aspx","emoji":"🍽️"}
Tableau JSON de 8 objets UNIQUEMENT.`
        }],
      })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    const text = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array in response');
    return res.status(200).json({ results: JSON.parse(match[0]), source: 'claude-haiku' });
  } catch (err) {
    return res.status(500).json({ error: `Fallback failed: ${err.message}`, source: 'error' });
  }
}
