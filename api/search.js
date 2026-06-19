export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });

  const month = new Date().getMonth() + 1;
  const saison = month >= 3 && month <= 5 ? 'printemps' :
                 month >= 6 && month <= 8 ? 'été' :
                 month >= 9 && month <= 11 ? 'automne' : 'hiver';
  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: 'Tu es un chef cuisinier expert en cuisine française et méditerranéenne. Retourne UNIQUEMENT un tableau JSON valide, sans backtick ni texte autour.',
        messages: [{
          role: 'user',
          content: `Nous sommes le ${today}, saison: ${saison}, région: Île-de-France. L'utilisateur demande: "${query}". Propose 8 recettes adaptées avec produits de saison. Par défaut pour 4 personnes. Pour chaque recette retourne: {"titre":"...","description":"description appétissante 1-2 phrases","categorie":"Déjeuner|Dîner|Dessert|Petit-déjeuner|Snack","temps":30,"difficulte":"Facile|Moyen|Difficile","url":"URL réelle d'une recette similaire sur marmiton.org ou 750g.com","emoji":"emoji du plat","portions":4}. Retourne un tableau JSON de 8 objets.`
        }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      })
    });

    const claudeData = await claudeRes.json();
    const text = (claudeData.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const clean = text.replace(/```json\n?|```\n?/g, '').trim();
    const arr = JSON.parse(clean);

    const results = arr.map(r => ({
      titre: r.titre,
      url: r.url || '',
      description: r.description,
      categorie: r.categorie,
      temps: r.temps,
      difficulte: r.difficulte,
      emoji: r.emoji,
    }));

    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
