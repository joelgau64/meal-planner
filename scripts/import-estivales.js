import { readFileSync } from 'fs';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';
const PEXELS_API_KEY = '4g2jiEPcHQiYGhnNjrviL0NacwVzxAKrQ7qokCncr1lauq2ARQdhTRFp';

if (!NOTION_TOKEN) {
  console.error('❌ NOTION_TOKEN manquant.');
  process.exit(1);
}

const TR = {
  'bowl':'bowl food','avocat':'avocado','saumon':'salmon','caprese':'caprese salad',
  'falafels':'falafel houmous','houmous':'hummus','poke':'poke bowl',
  'teriyaki':'teriyaki bowl','quinoa':'quinoa salad grilled vegetables',
  'lentilles':'lentil salad feta','brochettes poulet':'chicken skewers grilled',
  'betterave':'beetroot cold soup','clafoutis':'clafoutis cherries dessert',
  'pastèque':'watermelon feta salad','panna cotta':'panna cotta passion fruit',
  'fattoush':'fattoush lebanese salad'
};

async function findPhoto(nom) {
  try {
    let q = nom.toLowerCase();
    for (const [fr, en] of Object.entries(TR)) {
      if (q.includes(fr)) { q = en; break; }
    }
    q += ' food dish';
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=3&orientation=landscape`;
    const res = await fetch(url, { headers: { 'Authorization': PEXELS_API_KEY } });
    const data = await res.json();
    return data.photos?.[0]?.src?.large2x || null;
  } catch { return null; }
}

async function createPage(recette, photo) {
  const body = {
    parent: { database_id: DB_RECETTES },
    properties: {
      'Nom': { title: [{ text: { content: recette.nom } }] },
      'Catégorie': { select: { name: recette.categorie } },
      'Temps de préparation': { number: recette.temps },
      'Portions': { number: recette.portions },
      'Ingrédients': { rich_text: [{ text: { content: recette.ingredients } }] },
      'Instructions': { rich_text: [{ text: { content: recette.instructions } }] },
      'Note': { select: { name: '***' } },
      'Likes': { number: 0 },
      'Dislikes': { number: 0 },
      'Fois cuisinée': { number: 0 },
      ...(photo ? { 'Photo': { url: photo } } : {}),
    }
  };

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.object === 'error') throw new Error(data.message);
  return data;
}

async function main() {
  const recettes = JSON.parse(readFileSync('./scripts/recettes-estivales.json', 'utf8'));
  console.log(`📋 Import de ${recettes.length} recettes estivales...\n`);

  let ok = 0, fail = 0;
  for (const recette of recettes) {
    process.stdout.write(`➕ ${recette.nom}... `);
    try {
      const photo = await findPhoto(recette.nom);
      await createPage(recette, photo);
      console.log(photo ? '✓ (avec photo)' : '✓ (sans photo)');
      ok++;
    } catch (e) {
      console.log(`❌ ${e.message}`);
      fail++;
    }
    await new Promise(r => setTimeout(r, 400));
  }
  console.log(`\n✅ ${ok} recettes importées, ${fail} erreurs`);
}

main().catch(console.error);
