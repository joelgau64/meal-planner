export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });

  const spoonacularKey = process.env.SPOONACULAR_API_KEY;
  const edamamId      = process.env.EDAMAM_APP_ID;
  const edamamKey     = process.env.EDAMAM_APP_KEY;
  const anthropicKey  = process.env.ANTHROPIC_API_KEY;

  const month = new Date().getMonth() + 1;
  const saison = month >= 3 && month <= 5 ? 'printemps' :
                 month >= 6 && month <= 8 ? 'été' :
                 month >= 9 && month <= 11 ? 'automne' : 'hiver';

  const EMOJIS = ['🍽️','🥗','🍲','🥘','🍜','🥩','🐟','🥦','🍋','🫐','🥑','🍅'];

  // ── Spoonacular ─────────────────────────────────────────────────────────────
  async function fetchSpoonacular() {
    if (!spoonacularKey) return [];
    const q = encodeURIComponent(query);
    const url = `https://api.spoonacular.com/recipes/complexSearch?apiKey=${spoonacularKey}&query=${q}&number=6&addRecipeInformation=true&instructionsRequired=true&sort=relevance`;
    const r = await fetch(url);
    const d = await r.json();
    if (d.status === 'failure' || !d.results?.length) return [];
    return d.results.map((r, i) => ({
      titre: r.title,
      url: r.sourceUrl || '',
      description: r.summary ? r.summary.replace(/<[^>]+>/g, '').substring(0, 160) + '…' : '',
      source: r.sourceName || 'Spoonacular',
      categorie: r.dishTypes?.includes('dessert') ? 'Dessert'
               : r.dishTypes?.includes('lunch') || r.dishTypes?.includes('salad') ? 'Déjeuner' : 'Dîner',
      temps: r.readyInMinutes || null,
      difficulte: !r.readyInMinutes || r.readyInMinutes <= 20 ? 'Facile'
                : r.readyInMinutes <= 45 ? 'Moyen' : 'Difficile',
      emoji: EMOJIS[i % EMOJIS.length],
      image: r.image || null,
      spoonacularId: r.id,
      _source: 'spoonacular',
    }));
  }

  // ── Edamam ───────────────────────────────────────────────────────────────────
  async function fetchEdamam() {
    if (!edamamId || !edamamKey) return [];
    const q = encodeURIComponent(query);
    const url = `https://api.edamam.com/api/recipes/v2?type=public&q=${q}&app_id=${edamamId}&app_key=${edamamKey}&field=label&field=url&field=source&field=image&field=totalTime&field=cuisineType&field=mealType&field=dishType&from=0&to=6`;
    const r = await fetch(url);
    const d = await r.json();
    if (!d.hits?.length) return [];
    return d.hits.map((h, i) => {
      const recipe = h.recipe;
      const totalTime = recipe.totalTime > 0 ? recipe.totalTime : null;
      return {
        titre: recipe.label,
        url: recipe.url || '',
        description: `${recipe.source} · ${recipe.cuisineType?.join(', ') || ''}`,
        source: recipe.source || 'Edamam',
        categorie: recipe.dishType?.includes('desserts') ? 'Dessert'
                 : recipe.mealType?.includes('lunch') ? 'Déjeuner' : 'Dîner',
        temps: totalTime,
        difficulte: !totalTime || totalTime <= 20 ? 'Facile'
                  : totalTime <= 45 ? 'Moyen' : 'Difficile',
        emoji: EMOJIS[(i + 6) % EMOJIS.length],
        image: recipe.image || null,
        edamamId: h._links?.self?.href || null,
        _source: 'edamam',
      };
    });
  }

  // ── Lancer les deux en parallèle ─────────────────────────────────────────────
  const [spoonResults, edamamResults] = await Promise.allSettled([
    fetchSpoonacular(),
    fetchEdamam(),
  ]).then(r => r.map(p => p.status === 'fulfilled' ? p.value : []));

  // Merger + dédupliquer par titre (lowercase, 30 premiers chars)
  const seen = new Set();
  const merged = [];
  for (const item of [...spoonResults, ...edamamResults]) {
    const key = item.titre.toLowerCase().substring(0, 30);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }

  if (merged.length > 0) {
    const sources = [...new Set(merged.map(r => r._source))].join('+');
    return res.status(200).json({ results: merged.slice(0, 9), source: sources });
  }

  // ── Fallback Claude Haiku ────────────────────────────────────────────────────
  if (!anthropicKey) return res.status(500).json({ error: 'Aucune source disponible', source: 'none' });

  try {
    const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: 'Tu es un chef cuisinier. Retourne UNIQUEMENT un tableau JSON valide, sans backtick.',
        messages: [{ role: 'user', content: `Date: ${today}, saison: ${saison}, région: Île-de-France. Demande: "${query}". Propose 8 recettes pour 4 personnes. Pour chaque: {"titre":"...","description":"1-2 phrases","categorie":"Déjeuner|Dîner|Dessert","temps":30,"difficulte":"Facile|Moyen|Difficile","url":"","emoji":"🍽️"}. Tableau JSON UNIQUEMENT.` }],
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
