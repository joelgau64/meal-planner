// GET /api/inspect?what=...  — endpoint READ-ONLY de diagnostic.
// Permet d'inspecter l'état des données Notion sans lancer de script local.
// Sécurité : lecture seule (aucune écriture possible), et gate optionnel par IMPORT_TOKEN.
//
// Exemples :
//   /api/inspect?what=schemas                     → types de toutes les propriétés des 4 DBs
//   /api/inspect?what=recette&q=poulet            → recettes dont le nom contient "poulet"
//   /api/inspect?what=frigo                       → contenu du frigo (non consommé), trié péremption
//   /api/inspect?what=count                       → nombre d'entrées par DB
//   /api/inspect?what=planning&days=14            → planning des 14 prochains jours

const DBS = {
  recettes: '39c7b0f8-bf02-4893-bc05-6d82b8c38617',
  planning: 'dc70bd98-0691-41b9-abfc-5bde68630995',
  courses:  '35f5b3b5-095f-4998-a014-9a112807e711',
  frigo:    '3ba7bf2a-8f76-81bd-a878-dbf3ae8be0be',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const IMPORT_TOKEN = process.env.IMPORT_TOKEN;
  if (!NOTION_TOKEN) return res.status(500).json({ error: 'NOTION_TOKEN non configuré' });
  // Gate optionnel : si IMPORT_TOKEN est défini, l'exiger.
  if (IMPORT_TOKEN && req.query.token !== IMPORT_TOKEN) {
    return res.status(401).json({ error: 'token requis' });
  }

  const notion = (path, body) => fetch(`https://api.notion.com${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(r => r.json());

  const what = req.query.what || 'count';

  try {
    // --- Schémas : types de propriétés (détecte les mismatches type) ---
    if (what === 'schemas') {
      const out = {};
      for (const [name, id] of Object.entries(DBS)) {
        const db = await notion(`/v1/databases/${id}`);
        if (db.object === 'error') { out[name] = { error: db.message }; continue; }
        out[name] = Object.fromEntries(Object.entries(db.properties).map(([k, v]) => [k, v.type]));
      }
      return res.status(200).json({ what, schemas: out });
    }

    // --- Comptages ---
    if (what === 'count') {
      const out = {};
      for (const [name, id] of Object.entries(DBS)) {
        const q = await notion(`/v1/databases/${id}/query`, { page_size: 100 });
        out[name] = (q.results || []).length + (q.has_more ? '+' : '');
      }
      return res.status(200).json({ what, counts: out });
    }

    // --- Recettes (filtre nom optionnel) ---
    if (what === 'recette') {
      const q = req.query.q;
      const filter = q ? { property: 'Nom', title: { contains: q } } : undefined;
      const data = await notion(`/v1/databases/${DBS.recettes}/query`, { ...(filter ? { filter } : {}), page_size: 25 });
      const rows = (data.results || []).map(p => ({
        id: p.id,
        nom: p.properties['Nom']?.title?.[0]?.plain_text || '',
        categorie: p.properties['Catégorie']?.select?.name || '',
        temps: p.properties['Temps de préparation']?.number ?? null,
        ingredients_len: (p.properties['Ingrédients']?.rich_text?.[0]?.plain_text || '').length,
        instructions_len: (p.properties['Instructions']?.rich_text?.[0]?.plain_text || '').length,
        source: p.properties['Source']?.url || '',
        photo: p.properties['Photo']?.url || '(vide)',
        commentaires: p.properties['Commentaires']?.rich_text?.[0]?.plain_text || '',
      }));
      return res.status(200).json({ what, q: q || null, count: rows.length, rows });
    }

    // --- Frigo (non consommé, trié péremption) ---
    if (what === 'frigo') {
      const data = await notion(`/v1/databases/${DBS.frigo}/query`, { page_size: 100 });
      const rows = (data.results || []).map(p => ({
        id: p.id,
        article: p.properties['Article']?.title?.[0]?.plain_text || '',
        proteine: p.properties['Protéine']?.select?.name || '',
        forme: p.properties['Forme']?.select?.name || '',
        peremption: p.properties['Date de péremption']?.date?.start || null,
        quantite: p.properties['Quantité']?.rich_text?.[0]?.plain_text || '',
        consomme: !!p.properties['Consommé']?.checkbox,
      })).filter(r => !r.consomme).sort((a, b) => (a.peremption || '9999').localeCompare(b.peremption || '9999'));
      return res.status(200).json({ what, count: rows.length, rows });
    }

    // --- Planning (N prochains jours) ---
    if (what === 'planning') {
      const days = parseInt(req.query.days || '14');
      const today = new Date().toISOString().split('T')[0];
      const until = new Date(Date.now() + days * 864e5).toISOString().split('T')[0];
      const data = await notion(`/v1/databases/${DBS.planning}/query`, {
        filter: { and: [
          { property: 'Date', date: { on_or_after: today } },
          { property: 'Date', date: { on_or_before: until } },
        ] },
        page_size: 100,
      });
      const rows = (data.results || []).map(p => ({
        repas: p.properties['Repas']?.title?.[0]?.plain_text || '',
        date: p.properties['Date']?.date?.start || null,
        moment: p.properties['Moment']?.select?.name || '',
        cuisine: !!p.properties['Cuisiné']?.checkbox,
        queue: !!p.properties["File d'attente"]?.checkbox,
      })).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      return res.status(200).json({ what, days, count: rows.length, rows });
    }

    return res.status(400).json({ error: `what inconnu: ${what}`, options: ['schemas', 'count', 'recette', 'frigo', 'planning'] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
