// Script: ajoute des photos aux recettes Notion via Pexels
// Usage:
//   $env:NOTION_TOKEN="secret_xxx"
//   $env:PEXELS_API_KEY="ta_clé_pexels"
//   node scripts/add-photos.js

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';

if (!NOTION_TOKEN || !PEXELS_API_KEY) {
  console.error('❌ Variables manquantes:');
  console.error('   $env:NOTION_TOKEN="secret_xxx"');
  console.error('   $env:PEXELS_API_KEY="ta_clé_pexels"');
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

// Dictionnaire FR -> EN pour meilleurs résultats Pexels
const TR = {
  'poulet':'chicken','boeuf':'beef','porc':'pork','saumon':'salmon',
  'cabillaud':'cod fish','merlu':'hake','bar':'sea bass','thon':'tuna',
  'crevettes':'shrimp','pâtes':'pasta','farfalle':'pasta','orecchiette':'pasta',
  'nouilles':'noodles','riz':'rice','curry':'curry','salade':'salad',
  'soupe':'soup','tarte':'tart','tomate':'tomato','champignon':'mushroom',
  'quinoa':'quinoa','citron':'lemon','épinards':'spinach','courgette':'zucchini',
  'aubergine':'eggplant','artichaut':'artichoke','petits pois':'peas',
  'jambon':'ham','bacon':'bacon','mozzarella':'mozzarella','pesto':'pesto',
  'citronnelle':'lemongrass','olives':'olives','cappuccino':'soup mushroom',
  'tatin':'tart tomato','roulés':'rolls fish','vietnamien':'vietnamese food',
  'japonais':'japanese food','italien':'italian food','marocain':'moroccan food',
  'brocoli':'broccoli','lait de coco':'coconut curry'
};

function toEnglish(nom) {
  let q = nom.toLowerCase();
  for (const [fr, en] of Object.entries(TR)) {
    q = q.replace(new RegExp(fr, 'gi'), en);
  }
  q = q.replace(/\b(au|aux|à|la|le|les|de|du|des|et|en|avec|sur|ma|mon)\b/gi, ' ');
  return q.replace(/\s+/g, ' ').trim() + ' food dish';
}

async function findPhoto(nom) {
  const query = toEnglish(nom);
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`;
  const res = await fetch(url, {
    headers: { 'Authorization': PEXELS_API_KEY }
  });
  const data = await res.json();
  // Prendre la première photo en format large
  return data.photos?.[0]?.src?.large2x || data.photos?.[0]?.src?.large || null;
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

  if (!recettes.length) { console.log('✅ Toutes les recettes ont une photo !'); return; }

  let ok = 0, skip = 0;
  for (const page of recettes) {
    const nom = page.properties?.['Nom']?.title?.[0]?.plain_text || 'Sans titre';
    process.stdout.write(`🖼️  ${nom}... `);
    try {
      const photoUrl = await findPhoto(nom);
      if (photoUrl) {
        await updatePhoto(page.id, photoUrl);
        console.log('✓');
        ok++;
      } else {
        console.log('⚠️  aucune image');
        skip++;
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.log(`❌ ${e.message}`);
      skip++;
    }
  }
  console.log(`\n✅ ${ok} photos ajoutées, ${skip} ignorées`);
}

main().catch(console.error);
