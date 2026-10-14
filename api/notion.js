import { guard } from './_guard.js';

const NOTION_VERSION = '2022-06-28';

// Liste blanche : le proxy ne relaie QUE ce dont l'app a besoin, sur les 5 bases connues.
// Avant : n'importe quel chemin / méthode (y compris DELETE) sur tout l'espace Notion partagé
// avec l'intégration, ouvert à n'importe quel site (CORS *).
const DBS = new Set([
  '39c7b0f8-bf02-4893-bc05-6d82b8c38617', // Recettes
  'dc70bd98-0691-41b9-abfc-5bde68630995', // Planning
  '35f5b3b5-095f-4998-a014-9a112807e711', // Courses
  '3ba7bf2a-8f76-81bd-a878-dbf3ae8be0be', // Frigo
  '39d12e37-62b0-4116-9c92-d6d3f6473d69', // Ingrédients (dictionnaire)
]);
const norm = id => String(id || '').replace(/-/g, '').toLowerCase();
const DB_NORM = new Set([...DBS].map(norm));
const UUID = '[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}';

function allowed(method, path, body) {
  let m;
  if (method === 'POST' && (m = path.match(new RegExp(`^/v1/databases/(${UUID})/query$`, 'i'))))
    return DB_NORM.has(norm(m[1]));
  if (method === 'POST' && path === '/v1/pages')
    return DB_NORM.has(norm(body?.parent?.database_id));
  if ((method === 'PATCH' || method === 'GET') && new RegExp(`^/v1/pages/${UUID}$`, 'i').test(path))
    return true;
  return false;
}

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: 'NOTION_TOKEN not configured' });

  const notionPath = String(req.query.path || '');
  const parsedBody = typeof req.body === 'string' ? safeParse(req.body) : req.body;
  if (!allowed(req.method, notionPath, parsedBody)) {
    return res.status(403).json({ object: 'error', message: `Route Notion non autorisée: ${req.method} ${notionPath}` });
  }

  try {
    const body = req.method !== 'GET' && parsedBody ? JSON.stringify(parsedBody) : undefined;
    const response = await fetch(`https://api.notion.com${notionPath}`, {
      method: req.method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body,
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ object: 'error', message: err.message });
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
