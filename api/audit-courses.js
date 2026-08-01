// api/audit-courses.js
//
// Version serverless du script scripts/audit-fix-truncated-ingredients.js.
// Utilise NOTION_TOKEN déjà configuré sur Vercel (comme api/notion.js).
//
// Usage depuis un navigateur (mobile ou desktop, pas de terminal) :
//   GET /api/audit-courses                        -> page HTML (rapport dry-run), écran maintenu allumé
//   GET /api/audit-courses?apply=1&confirm=OUI     -> page HTML, applique les corrections dans Notion
//   GET /api/audit-courses?format=json             -> réponse JSON brute (même logique, sans page HTML)

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

async function runAudit(token, apply) {
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
    return {
      mode: 'dry-run',
      found: suspects.length,
      suspects,
      note: suspects.length
        ? 'Relance avec ?apply=1&confirm=OUI pour corriger ces articles dans Notion.'
        : 'Rien à corriger.',
    };
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

  return { mode: 'apply', found: suspects.length, fixed, errors, suspects };
}

// Page HTML légère : elle ne fait pas elle-même l'audit (trop lent pour bloquer le rendu),
// elle acquiert le Wake Lock DÈS l'affichage puis va chercher le résultat via ?format=json,
// pour que le téléphone reste allumé pendant toute la durée de l'appel à Notion.
function renderShellHtml(apiUrl) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Audit Courses</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#0b0b0f;color:#eaeaf0;line-height:1.5}
  h1{font-size:1.2rem}
  .status{color:#9aa0ab;font-size:.9rem;margin-bottom:16px}
  .card{background:#16161d;border:1px solid #2a2a35;border-radius:10px;padding:14px;margin-bottom:10px}
  .old{color:#ff8a8a}
  .new{color:#8affa0}
  .meta{color:#9aa0ab;font-size:.85rem;margin-top:4px}
  .ok{color:#8affa0}
  .err{color:#ff8a8a}
  a{color:#7fb2ff}
  code{background:#22222c;padding:2px 5px;border-radius:4px}
</style>
</head>
<body>
  <h1>🔍 Audit articles Courses</h1>
  <div class="status" id="status">Connexion à Notion… (écran maintenu allumé)</div>
  <div id="results"></div>

<script>
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) { /* pas grave si indisponible (ex: batterie faible, navigateur non supporté) */ }
}
document.addEventListener('visibilitychange', () => {
  if (wakeLock === null && document.visibilityState === 'visible') keepAwake();
});
keepAwake();

fetch(${JSON.stringify(apiUrl)})
  .then(r => r.json())
  .then(data => {
    document.getElementById('status').textContent =
      data.mode === 'apply' ? 'Corrections appliquées ✓' : 'Rapport (dry-run) ✓';
    const results = document.getElementById('results');
    if (!data.found) {
      results.innerHTML = '<div class="card ok">Rien à corriger. ✓</div>';
    } else {
      results.innerHTML = data.suspects.map(s => \`
        <div class="card">
          <div><span class="old">"\${s.article}"</span> → <span class="new">"\${s.correctName}"</span></div>
          <div class="meta">recette : \${s.recette} · préfixe manquant : <code>\${s.missingPrefix}</code></div>
        </div>
      \`).join('');
      if (data.mode === 'dry-run') {
        results.innerHTML += '<p><a href="?apply=1&confirm=OUI">→ Appliquer ces ' + data.found + ' correction(s)</a></p>';
      } else {
        results.innerHTML += '<p class="ok">' + data.fixed + '/' + data.found + ' corrigé(s).</p>';
        if (data.errors && data.errors.length) {
          results.innerHTML += '<p class="err">' + data.errors.length + ' erreur(s), voir la réponse JSON.</p>';
        }
      }
    }
    if (wakeLock) wakeLock.release().catch(()=>{});
  })
  .catch(err => {
    document.getElementById('status').textContent = 'Erreur';
    document.getElementById('results').innerHTML = '<div class="card err">' + err.message + '</div>';
    if (wakeLock) wakeLock.release().catch(()=>{});
  });
</script>
</body>
</html>`;
}

export default async function handler(req, res) {
  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: 'NOTION_TOKEN not configured' });

  const apply = req.query.apply === '1' && req.query.confirm === 'OUI';
  const wantsJson = req.query.format === 'json';

  if (!wantsJson) {
    // Requête de navigation : renvoyer tout de suite la coquille HTML (rapide),
    // elle-même ira chercher le résultat via ?format=json en gardant l'écran allumé.
    const selfUrl = `/api/audit-courses?format=json${apply ? '&apply=1&confirm=OUI' : ''}`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderShellHtml(selfUrl));
  }

  try {
    const result = await runAudit(token, apply);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
