// Script: ajoute des photos aux recettes Notion via Google Custom Search Images
// Usage:
//   Windows: $env:NOTION_TOKEN="secret_xxx"; $env:GOOGLE_SEARCH_API_KEY="xxx"; $env:GOOGLE_SEARCH_CX="xxx"; node scripts/add-photos.js
//   Mac/Linux: NOTION_TOKEN=xxx GOOGLE_SEARCH_API_KEY=xxx GOOGLE_SEARCH_CX=xxx node scripts/add-photos.js

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const GOOGLE_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_SEARCH_CX;
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';

if (!NOTION_TOKEN || !GOOGLE_API_KEY || !GOOGLE_CX) {
  console.error('❌ Variables manquantes. Usage:');
  console.error('   $env:NOTION_TOKEN="secret_xxx"');
  console.error('   $env:GOOGLE_SEARCH_API_KEY="xxx"');
  console.error('   $env:GOOGLE_SEARCH_CX="c16fa150d77c3479c"');
  console.error('   node scripts/add-photos.js');
  process.exit(1);
}

async function notionFetch(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.notion.com${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

async function getRecettesWithoutPhoto() {
  const recettes = [];
  let cursor = undefined;
  do {
    const res = await notionFetch(`/v1/databases/${DB_RECETTES}/query`, 'POST', {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
      filter: { property: 'Photo', url: { is_empty: true } }
    });
    if (res.results) recettes.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return recettes;
}

async function findPhoto(nom) {
  const query = `${nom} recette plat cuisiné`;
  const url = `https://www.googleapis.com/customsearch/v1`
    + `?key=${GOOGLE_API_KEY}`
    + `&cx=${GOOGLE_CX}`
    + `&q=${encodeURIComponent(query)}`
    + `&searchType=image`
    + `&num=5`
    + `&imgType=photo`
    + `&imgSize=large`
    + `&safe=active`
    + `&gl=fr`
    + `&lr=lang_fr`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    throw new Error(`Google API: ${data.error.message}`);
  }

  const items = data.items || [];
  // Préférer JPG/PNG HTTPS, éviter logos et SVG
  const item = items.find(i =>
    i.link?.startsWith('https') &&
    !i.link.includes('logo') &&
    !i.link.endsWith('.svg') &&
    !i.link.endsWith('.gif')
  ) || items.find(i => i.link?.startsWith('https'));

  return item?.link || null;
}

async function updatePhoto(pageId, photoUrl) {
  const res = await notionFetch(`/v1/pages/${pageId}`, 'PATCH', {
    properties: { 'Photo': { url: photoUrl } }
  });
  if (res.object === 'error') throw new Error(res.message);
}

async function main() {
  console.log('🔍 Récupération des recettes sans photo...');
  const recettes = await getRecettesWithoutPhoto();
  console.log(`📋 ${recettes.length} recettes sans photo\n`);

  if (recettes.length === 0) {
    console.log('✅ Toutes les recettes ont déjà une photo !');
    return;
  }

  let ok = 0, skip = 0;

  for (const page of recettes) {
    const nom = page.properties?.['Nom']?.title?.[0]?.plain_text || 'Sans titre';
    process.stdout.write(`🖼️  ${nom}... `);
    try {
      const photoUrl = await findPhoto(nom);
      if (photoUrl) {
        await updatePhoto(page.id, photoUrl);
        console.log(`✓`);
        ok++;
      } else {
        console.log(`⚠️  aucune image trouvée`);
        skip++;
      }
      // 700ms entre chaque requête pour rester dans les limites Google (100 req/jour)
      await new Promise(r => setTimeout(r, 700));
    } catch (e) {
      console.log(`❌ ${e.message}`);
      skip++;
    }
  }

  console.log(`\n✅ ${ok} photos ajoutées, ${skip} ignorées`);
  if (ok + skip > 50) console.log('⚠️  Attention: quota Google proche (100 req/jour)');
}

main().catch(console.error);
