// api/audit-photos.js
//
// Détecte les recettes dont la Photo a été attribuée par l'ancien script
// api/enrich-recipes.js (correspondance par mots-clés sur ~100 URLs Samsung Food
// fixes) alors que la recette n'a jamais eu Samsung Food comme source réelle —
// cas fréquent de photo qui ne correspond pas au plat.
//
// Pour chaque suspect :
//   - si la recette a sa propre Source (non-Samsung Food), on tente d'en extraire
//     la vraie og:image et on la substitue ;
//   - sinon, on retire simplement la Photo (l'app retombe sur l'emoji, ce qui
//     est plus honnête qu'une photo d'un autre plat).
//
// Usage depuis un navigateur (mobile ou desktop, pas de terminal) :
//   GET /api/audit-photos                        -> rapport dry-run (aucune écriture)
//   GET /api/audit-photos?apply=1&confirm=OUI     -> applique les corrections dans Notion
//   GET /api/audit-photos?format=json             -> réponse JSON brute

const NOTION_VERSION = '2022-06-28';
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';

function getTitle(prop) { return (prop?.title || []).map(t => t.plain_text).join('').trim(); }
function getUrl(prop) { return prop?.url || null; }

async function queryAll(token, dbId) {
  let results = [];
  let cursor = undefined;
  do {
    const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`Notion query failed: ${JSON.stringify(data)}`);
    results = results.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function fetchOgImage(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    let img = m?.[1] || null;
    if (img && img.startsWith('//')) img = 'https:' + img;
    if (img && img.startsWith('/')) { try { img = new URL(img, url).href; } catch { /* ignore */ } }
    return img;
  } catch { return null; }
}

async function notionPatch(pageId, properties, token) {
  const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || 'Notion patch failed');
  return data;
}

async function runAudit(token, apply) {
  const pages = await queryAll(token, DB_RECETTES);
  const suspects = [];

  for (const page of pages) {
    const p = page.properties;
    const nom = getTitle(p['Nom']);
    const photo = getUrl(p['Photo']);
    const source = getUrl(p['Source']);
    if (!photo) continue;
    const photoIsSamsung = photo.includes('samsungfood.com');
    const sourceIsSamsung = (source || '').includes('samsungfood.com');
    // Suspect : photo Samsung Food attribuée alors que la vraie source de la recette n'en est pas une
    if (photoIsSamsung && !sourceIsSamsung) {
      suspects.push({ id: page.id, nom, oldPhoto: photo, source: source || null });
    }
  }

  if (!apply) {
    return { mode: 'dry-run', found: suspects.length, suspects };
  }

  let fixed = 0;
  const errors = [];
  const applied = [];
  for (const s of suspects) {
    try {
      let newPhoto = null;
      if (s.source) newPhoto = await fetchOgImage(s.source);
      await notionPatch(s.id, { Photo: { url: newPhoto || null } }, token);
      applied.push({ ...s, newPhoto: newPhoto || '(retirée)' });
      fixed++;
    } catch (e) {
      errors.push({ nom: s.nom, error: e.message });
    }
  }
  return { mode: 'apply', found: suspects.length, fixed, errors, suspects: applied };
}

function renderShellHtml(apiUrl) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Audit photos recettes</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d0d12;color:#e6e6ea;padding:20px;max-width:640px;margin:0 auto}
  h1{font-size:1.2rem}
  .status{color:#9aa0ab;font-size:.9rem;margin-bottom:16px}
  .card{background:#16161d;border:1px solid #2a2a35;border-radius:10px;padding:14px;margin-bottom:10px}
  .old{color:#ff8a8a}
  .new{color:#8affa0}
  .meta{color:#9aa0ab;font-size:.85rem;margin-top:4px;word-break:break-all}
  .ok{color:#8affa0}
  .err{color:#ff8a8a}
  a{color:#7fb2ff}
  code{background:#22222c;padding:2px 5px;border-radius:4px}
</style>
</head>
<body>
  <h1>🖼️ Audit photos recettes</h1>
  <div class="status" id="status">Connexion à Notion… (écran maintenu allumé)</div>
  <div id="results"></div>

<script>
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
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
      results.innerHTML = '<div class="card ok">Aucune photo suspecte trouvée. ✓</div>';
    } else {
      results.innerHTML = data.suspects.map(s => \`
        <div class="card">
          <div><strong>\${s.nom}</strong></div>
          <div class="meta old">ancienne (Samsung Food) : \${s.oldPhoto}</div>
          <div class="meta \${s.newPhoto ? 'new' : ''}">\${data.mode === 'apply' ? 'nouvelle : ' + (s.newPhoto || '(retirée)') : (s.source ? 'source propre trouvée, sera re-extraite : ' + s.source : 'pas de source propre → photo sera retirée')}</div>
        </div>
      \`).join('');
      if (data.mode === 'dry-run') {
        results.innerHTML += '<p><a href="?apply=1&confirm=OUI">→ Corriger ces ' + data.found + ' photo(s)</a></p>';
      } else {
        results.innerHTML += '<p class="ok">' + data.fixed + '/' + data.found + ' corrigée(s).</p>';
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
    const selfUrl = `/api/audit-photos?format=json${apply ? '&apply=1&confirm=OUI' : ''}`;
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
