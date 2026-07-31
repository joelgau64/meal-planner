// api/audit-courses.js
//
// Version serverless du script scripts/audit-fix-truncated-ingredients.js.
// Utilise NOTION_TOKEN déjà configuré sur Vercel (comme api/notion.js).
//
// Usage depuis un navigateur (mobile ou desktop, pas de terminal) :
//   GET /api/audit-courses                        -> rapport dry-run (JSON), aucune écriture
//   GET /api/audit-courses?apply=1&confirm=OUI     -> applique les corrections dans Notion

const NOTION_VERSION = '2022-06-28';
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';
const DB_COURSES = '35f5b3b5-095f-4998-a014-9a112807e711';
const RISKY_PREFIXES = ['g', 'l', 'kg', 'ml', 'cl', 'dl', 'oz', 'lb'];

// Portage exact de la regex corrigée dans src/App.jsx (parseIngredients)
function parseIngredients(text) {
  if (!text) return [];
  return text.split(/\n|,(?=\s*\d|\s*[A-ZÀ-Ö])/g)
    .map(s => s.trim()).filter(Boolean)
    .map(line => {
      const match = line.match(/^([\d.,\/]+)\s*(g|kg|ml|cl|l|dl|c\.?à\.?s\.?|c\.?à\.?c\.?|tasse|cuillère[s]?|tbsp|tsp|cup|oz|lb|pincée[s]?)?\b\s*(.+)/i);
      if (match) {
        return { name: match[3].trim() };
      }
      return { name: line };
    });
}

function normalize(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function getTitle(prop) {
  return (prop?.title || []).map(t => t.plain_text).join('').trim();
}
function getText(prop) {
  return (prop?.rich_text || []).map(t => t.plain_text).join('').trim();
}

async function queryAll(token, dbId) {
  let results = [];
  let cursor = undefined;
  do {
    const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`Notion query failed: ${JSON.stringify(data)}`);
    results = results.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

export default async function handler(req, res) {
  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: 'NOTION_TOKEN not configured' });

  const apply = req.query.apply === '1' && req.query.confirm === 'OUI';

  try {
    const recettesPages = await queryAll(token, DB_RECETTES);
    const recettesByNom = new Map();
    for (const page of recettesPages) {
      const p = page.properties;
      const nom = getTitle(p['Nom']);
      const ingredients = getText(p['Ingrédients']);
      if (nom) recettesByNom.set(normalize(nom), ingredients);
    }

    const coursesPages = await queryAll(token, DB_COURSES);
    const suspects = [];

    for (const page of coursesPages) {
      const p = page.properties;
      const article = getTitle(p['Article']);
      const recetteField = getText(p['Recette']);
      if (!article || !recetteField) continue;

      const recetteNoms = recetteField.split(',').map(s => s.trim()).filter(Boolean);
      let bestMatch = null;

      for (const recetteNom of recetteNoms) {
        const ingredientsText = recettesByNom.get(normalize(recetteNom));
        if (!ingredientsText) continue;
        const parsed = parseIngredients(ingredientsText);
        for (const ing of parsed) {
          const correctNorm = normalize(ing.name);
          const articleNorm = normalize(article);
          if (correctNorm === articleNorm) { bestMatch = null; break; }
          if (correctNorm.endsWith(articleNorm) && correctNorm.length > articleNorm.length) {
            const missingPrefix = correctNorm.slice(0, correctNorm.length - articleNorm.length);
            if (RISKY_PREFIXES.includes(missingPrefix)) {
              bestMatch = { correctName: ing.name, recette: recetteNom, missingPrefix };
            }
          }
        }
      }

      if (bestMatch) suspects.push({ pageId: page.id, article, ...bestMatch });
    }

    if (!apply) {
      return res.status(200).json({
        mode: 'dry-run',
        found: suspects.length,
        suspects,
        note: suspects.length
          ? 'Relance avec ?apply=1&confirm=OUI pour corriger ces articles dans Notion.'
          : 'Rien à corriger.',
      });
    }

    let fixed = 0;
    const errors = [];
    for (const s of suspects) {
      try {
        const r = await fetch(`https://api.notion.com/v1/pages/${s.pageId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Notion-Version': NOTION_VERSION,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ properties: { Article: { title: [{ text: { content: s.correctName } }] } } }),
        });
        if (!r.ok) errors.push({ article: s.article, error: await r.text() });
        else fixed++;
      } catch (e) {
        errors.push({ article: s.article, error: e.message });
      }
    }

    return res.status(200).json({ mode: 'apply', found: suspects.length, fixed, errors, suspects });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
