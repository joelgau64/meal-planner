// Script: ajoute des photos aux recettes Notion qui n'en ont pas
// Usage: NOTION_TOKEN=xxx GOOGLE_SEARCH_API_KEY=xxx GOOGLE_SEARCH_CX=xxx node scripts/add-photos.js

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const GOOGLE_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_SEARCH_CX;
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';

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
    recettes.push(...(res.results || []));
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return recettes;
}

async function findPhoto(nom) {
  const query = `${nom} recette plat cuisiné`;
  const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&searchType=image&num=5&imgType=photo&imgSize=large&safe=active&gl=fr`;
  const res = await fetch(url);
  const data = await res.json();
  const items = data.items || [];
  // Préférer images jpg/png https, éviter les SVG et logos
  const item = items.find(i =>
    i.link?.startsWith('https') &&
    !i.link.includes('logo') &&
    !i.link.endsWith('.svg') &&
    (i.link.includes('.jpg') || i.link.includes('.jpeg') || i.link.includes('.png') || i.link.includes('.webp'))
  ) || items.find(i => i.link?.startsWith('https'));
  return item?.link || null;
}

async function updatePhoto(pageId, photoUrl) {
  await notionFetch(`/v1/pages/${pageId}`, 'PATCH', {
    properties: { 'Photo': { url: photoUrl } }
  });
}

async function main() {
  if (!NOTION_TOKEN || !GOOGLE_API_KEY || !GOOGLE_CX) {
    console.error('❌ Variables manquantes: NOTION_TOKEN, GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_CX');
    process.exit(1);
  }

  console.log('🔍 Récupération des recettes sans photo...');
  const recettes = await getRecettesWithoutPhoto();
  console.log(`📋 ${recettes.length} recettes sans photo\n`);

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
        console.log(`⚠️  aucune image`);
        skip++;
      }
      // Pause 600ms pour rester dans la limite Google (100 req/jour)
      await new Promise(r => setTimeout(r, 600));
    } catch (e) {
      console.log(`❌ ${e.message}`);
      skip++;
    }
  }

  console.log(`\n✅ ${ok} photos ajoutées, ${skip} ignorées`);
}

main().catch(console.error);
