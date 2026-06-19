// Script: ajoute des photos aux recettes Notion
// Usage: NOTION_TOKEN=xxx node scripts/add-photos.js

const NOTION_TOKEN = process.env.NOTION_TOKEN;
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

// Dictionnaire FR -> EN pour meilleurs résultats
const TRANSLATIONS = {
  'poulet':'chicken','boeuf':'beef','porc':'pork','saumon':'salmon',
  'cabillaud':'cod','merlu':'hake','bar':'sea bass','thon':'tuna',
  'crevettes':'shrimp','moules':'mussels','pâtes':'pasta','riz':'rice',
  'farfalle':'pasta farfalle','orecchiette':'pasta','nouilles':'noodles',
  'curry':'curry','salade':'salad','soupe':'soup','tarte':'tart',
  'tomate':'tomato','champignon':'mushroom','quinoa':'quinoa',
  'citron':'lemon','épinards':'spinach','artichauts':'artichoke',
  'courgette':'zucchini','aubergine':'eggplant','poivron':'bell pepper',
  'vietnamien':'vietnamese','japonais':'japanese','italien':'italian',
  'marocain':'moroccan','thaï':'thai','libanais':'lebanese',
  'cappuccino':'cappuccino','roulés':'rolls','tatin':'tarte tatin',
  'petits pois':'peas','jambon':'ham','bacon':'bacon','lait de coco':'coconut milk',
  'mozzarella':'mozzarella','pesto':'pesto','menthe':'mint',
  'citronnelle':'lemongrass','olives':'olives'
};

function translateQuery(nom) {
  let q = nom.toLowerCase();
  for (const [fr, en] of Object.entries(TRANSLATIONS)) {
    q = q.replace(new RegExp(fr, 'g'), en);
  }
  // Nettoyer les mots français résiduels communs
  q = q.replace(/\b(au|aux|à|la|le|les|de|du|des|et|en|avec|sur)\b/g, ' ');
  q = q.replace(/\s+/g, ' ').trim();
  return `${q} food dish`;
}

// Foodish API - photos de plats aléatoires par catégorie (sans clé)
async function findPhotoFoodish(nom) {
  const categories = ['burger','butter-chicken','dessert','dosa','idly','pasta','pizza','rice','samosa','soup'];
  const nomLower = nom.toLowerCase();
  let cat = 'pasta';
  if (nomLower.includes('soupe') || nomLower.includes('cappuccino')) cat = 'soup';
  else if (nomLower.includes('dessert') || nomLower.includes('tarte') || nomLower.includes('tatin')) cat = 'dessert';
  else if (nomLower.includes('riz') || nomLower.includes('curry')) cat = 'rice';
  else if (nomLower.includes('pizza')) cat = 'pizza';
  else if (nomLower.includes('burger')) cat = 'burger';
  
  const res = await fetch(`https://foodish-api.com/api/images/${cat}`);
  const data = await res.json();
  return data.image || null;
}

// Unsplash Source (sans clé, URL directe)
function getUnsplashUrl(nom) {
  const q = encodeURIComponent(translateQuery(nom));
  // URL aléatoire Unsplash par query - retourne directement une image
  return `https://source.unsplash.com/800x600/?${q}`;
}

async function resolveUnsplashUrl(nom) {
  // source.unsplash.com redirige vers l'image finale - on suit la redirection
  const url = getUnsplashUrl(nom);
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (res.ok && res.url !== url) return res.url; // URL finale après redirect
    return url; // fallback: URL source directe
  } catch {
    return url;
  }
}

async function updatePhoto(pageId, photoUrl) {
  await notionFetch(`/v1/pages/${pageId}`, 'PATCH', {
    properties: { 'Photo': { url: photoUrl } }
  });
}

async function main() {
  if (!NOTION_TOKEN) {
    console.error('❌ NOTION_TOKEN manquant. Usage: NOTION_TOKEN=xxx node scripts/add-photos.js');
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
      // Unsplash Source (sans clé)
      const photoUrl = await resolveUnsplashUrl(nom);
      if (photoUrl) {
        await updatePhoto(page.id, photoUrl);
        console.log(`✓`);
        ok++;
      } else {
        console.log(`⚠️  aucune image`);
        skip++;
      }
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.log(`❌ ${e.message}`);
      skip++;
    }
  }

  console.log(`\n✅ ${ok} photos ajoutées, ${skip} ignorées`);
}

main().catch(console.error);
