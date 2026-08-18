// GET /api/recipe-image?q=nom+de+la+recette  → propose des images web pour une recette.
// Utilise Brave Image Search. Retourne plusieurs candidats pour que l'utilisateur choisisse.
// Aucune écriture : c'est à l'app d'enregistrer l'URL choisie après approbation.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'q requis' });

  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!braveKey) return res.status(500).json({ error: 'BRAVE_SEARCH_API_KEY non configuré' });

  try {
    // Requête ciblée "plat cuisiné" pour éviter les photos d'emballage/ingrédients bruts.
    const query = `${q} recette plat`;
    const url = `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=9&country=fr&safesearch=strict`;
    const r = await fetch(url, {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': braveKey },
    });
    if (!r.ok) {
      const txt = await r.text();
      return res.status(502).json({ error: `Brave images HTTP ${r.status}`, detail: txt.slice(0, 200) });
    }
    const d = await r.json();
    const candidates = (d.results || [])
      .map(item => ({
        url: item.properties?.url || item.thumbnail?.src || null,
        thumb: item.thumbnail?.src || item.properties?.url || null,
        source: item.source || item.meta_url?.hostname || '',
        title: item.title || '',
        width: item.properties?.width || null,
        height: item.properties?.height || null,
      }))
      .filter(c => c.url && c.url.startsWith('http'))
      // écarter les très petites images (souvent des icônes/logos)
      .filter(c => !c.width || c.width >= 300)
      .slice(0, 8);

    return res.status(200).json({ q, count: candidates.length, candidates });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
