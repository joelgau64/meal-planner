export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });

  // Déterminer la saison selon la date actuelle
  const month = new Date().getMonth() + 1;
  const saison = month >= 3 && month <= 5 ? 'printemps' :
                 month >= 6 && month <= 8 ? 'été' :
                 month >= 9 && month <= 11 ? 'automne' : 'hiver';

  // Détecter localisation via IP (header Vercel)
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || '';
  const region = 'Île-de-France'; // fallback, enrichi si IP disponible

  // Enrichir la query avec contexte saisonnier
  const enrichedQuery = `recette ${query} produits de saison ${saison} ${region} pour 4 personnes`;

  // 1. Essayer Google Custom Search
  if (apiKey && cx) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(enrichedQuery)}&num=10&lr=lang_fr&gl=fr`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.items && data.items.length > 0) {
        const results = data.items.map(item => ({
          titre: item.title.replace(/[-|].*?(Marmiton|750g|CuisineAZ|Chef Simon|Cuisine AZ)$/i, '').trim(),
          url: item.link,
          description: item.snippet,
          source: item.displayLink,
        }));
        return res.status(200).json({ results, source: 'google' });
      }
    } catch (err) {
      console.error('Google Search error:', err);
    }
  }

  // 2. Fallback Claude si Google échoue ou renvoie vide
  if (!anthropicKey) return res.status(200).json({ results: [] });

  try {
    const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
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
          content: `Nous sommes le ${today}, saison: ${saison}, région: ${region}. L'utilisateur demande: "${query}". Propose 8 recettes adaptées avec produits de saison disponibles en ${region}. Pour chaque recette: {"titre":"...","description":"description appétissante 1-2 phrases","categorie":"Déjeuner|Dîner|Dessert|Petit-déjeuner|Snack","temps":30,"difficulte":"Facile|Moyen|Difficile","url":"URL réelle d'une recette similaire sur marmiton.org ou 750g.com","emoji":"emoji du plat","portions":4}. Retourne un tableau JSON de 8 objets.`
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
      source: 'claude',
      categorie: r.categorie,
      temps: r.temps,
      difficulte: r.difficulte,
      emoji: r.emoji,
    }));

    return res.status(200).json({ results, source: 'claude' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
