export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = req.query.url || (req.body && req.body.url);
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!r.ok) return res.status(502).json({ error: `Page inaccessible (HTTP ${r.status})` });
    const html = await r.text();

    // Image de la recette, par ordre de fiabilité décroissante (avant nettoyage du HTML) :
    // 1) og:image  2) twitter:image  3) JSON-LD schema.org Recipe/ImageObject (très courant
    // sur les plugins de recette WordPress, parfois seule source quand il n'y a pas d'og:image)
    let image = null;
    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    image = ogMatch?.[1] || null;

    if (!image) {
      const twMatch = html.match(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i);
      image = twMatch?.[1] || null;
    }

    if (!image) {
      const ldBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
      for (const block of ldBlocks) {
        try {
          const data = JSON.parse(block[1].trim());
          const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
          for (const item of items) {
            const types = [].concat(item?.['@type'] || []);
            if (!types.some(t => /recipe/i.test(String(t)))) continue;
            let img = item.image;
            if (Array.isArray(img)) img = img[0];
            if (img && typeof img === 'object') img = img.url || img['@id'] || null;
            if (typeof img === 'string' && img.trim()) { image = img.trim(); break; }
          }
        } catch { /* bloc JSON-LD invalide ou non pertinent, on ignore */ }
        if (image) break;
      }
    }

    if (image && image.startsWith('//')) image = 'https:' + image;
    if (image && image.startsWith('/')) { try { image = new URL(image, url).href; } catch { /* ignore */ } }

    // Nettoyage : supprime script/style/nav/footer/header, décode les entités courantes,
    // convertit les balises en sauts de ligne pour garder une structure lisible pour Claude.
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&(rsquo|lsquo|#39|apos);/gi, "'")
      .replace(/&(rdquo|ldquo|quot);/gi, '"')
      .replace(/&eacute;/gi, 'é').replace(/&egrave;/gi, 'è').replace(/&agrave;/gi, 'à')
      .replace(/&ccedil;/gi, 'ç').replace(/&ocirc;/gi, 'ô').replace(/&ecirc;/gi, 'ê')
      .replace(/[ \t]+/g, ' ')
      .replace(/(\n\s*){2,}/g, '\n')
      .trim();

    if (!text || text.length < 50) return res.status(502).json({ error: 'Contenu de page vide' });

    return res.status(200).json({ text: text.slice(0, 16000), image, url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
