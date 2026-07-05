// POST /api/import-recipe
// Permet de déléguer l'ajout d'une recette (par ex. depuis Claude) sans passer par le terminal.
// Body attendu: { recipe: {...}, plan?: { date, moment } }
// Sécurité: nécessite un header x-import-token correspondant à IMPORT_TOKEN (env Vercel).

const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';
const DB_PLANNING = 'dc70bd98-0691-41b9-abfc-5bde68630995';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-import-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const IMPORT_TOKEN = process.env.IMPORT_TOKEN;
  if (!NOTION_TOKEN) return res.status(500).json({ error: 'NOTION_TOKEN non configuré' });
  if (IMPORT_TOKEN && req.headers['x-import-token'] !== IMPORT_TOKEN) {
    return res.status(401).json({ error: 'Token invalide' });
  }

  const { recipe, plan } = req.body || {};
  if (!recipe?.nom) return res.status(400).json({ error: 'recipe.nom requis' });

  const notion = (path, body, method = 'POST') => fetch(`https://api.notion.com${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    body: JSON.stringify(body),
  }).then(r => r.json());

  try {
    // Déduplication par titre exact
    const existing = await notion(`/v1/databases/${DB_RECETTES}/query`, {
      filter: { property: 'Nom', title: { equals: recipe.nom } }, page_size: 1,
    });
    let recetteId = existing.results?.[0]?.id;
    let skipped = false;

    if (recetteId) {
      skipped = true;
    } else {
      const props = {
        'Nom': { title: [{ text: { content: recipe.nom } }] },
        'Catégorie': { select: { name: recipe.categorie || 'Dîner' } },
        'Temps de préparation': { number: Number(recipe.temps) || 30 },
        'Portions': { number: Number(recipe.portions) || 4 },
        'Ingrédients': { rich_text: [{ text: { content: String(recipe.ingredients || '') } }] },
        'Instructions': { rich_text: [{ text: { content: String(recipe.instructions || '') } }] },
        'Likes': { number: 0 }, 'Dislikes': { number: 0 }, 'Fois cuisinée': { number: 0 },
        ...(recipe.note ? { 'Note': { select: { name: recipe.note } } } : {}),
        ...(recipe.photo ? { 'Photo': { url: recipe.photo } } : {}),
        ...(recipe.source ? { 'Source': { url: recipe.source } } : {}),
      };
      const created = await notion('/v1/pages', { parent: { database_id: DB_RECETTES }, properties: props });
      if (created.object === 'error') throw new Error(created.message);
      recetteId = created.id;
    }

    let planned = false;
    if (plan?.date) {
      const planRes = await notion('/v1/pages', {
        parent: { database_id: DB_PLANNING },
        properties: {
          'Repas': { title: [{ text: { content: recipe.nom } }] },
          'Date': { date: { start: plan.date } },
          'Moment': { select: { name: plan.moment || 'Dîner' } },
          'Recette': { rich_text: [{ text: { content: recipe.nom } }] },
          'Recette ID': { rich_text: [{ text: { content: recetteId } }] },
          'Portions': { number: Number(recipe.portions) || 4 },
          "File d'attente": { checkbox: false },
        },
      });
      if (planRes.object === 'error') throw new Error(planRes.message);
      planned = true;
    }

    return res.status(200).json({ ok: true, recetteId, skipped, planned });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
