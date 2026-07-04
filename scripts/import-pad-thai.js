// node scripts/import-pad-thai.js
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';
const DB_PLANNING = 'dc70bd98-0691-41b9-abfc-5bde68630995';
const PEXELS_KEY  = '4g2jiEPcHQiYGhnNjrviL0NacwVzxAKrQ7qokCncr1lauq2ARQdhTRFp';

const recette = {
  nom: "Pad Thaï aux œufs",
  categorie: "Dîner",
  temps: 25,
  portions: 4,
  ingredients: `380g de nouilles de riz
4 œufs
1 oignon émincé finement
1 càs de sauce soja
2 gousses d'ail émincées
3cm de gingembre râpé
4 tiges de ciboule émincées
50g de cacahuètes grillées concassées
100g de germes de soja
1/2 bouquet de coriandre
Huile neutre
Pour la sauce:
10cl de bouillon de légumes
3 càs de nuoc-mâm
1 càs de sucre roux
4 càs de préparation pour pad thaï`,
  instructions: `1. Faites tremper les nouilles dans un grand saladier d'eau froide.
2. Préparez la sauce en mélangeant tous les ingrédients.
3. Dans un wok avec un peu d'huile, faites revenir l'oignon 2 min. Ajoutez la sauce soja, l'ail et le gingembre.
4. Ajoutez les nouilles égouttées et la sauce, puis faites cuire 10 min environ, en mélangeant régulièrement. Dans un petit bol, battez les œufs en omelette, puis ajoutez-les au contenu du wok, en remuant vigoureusement.
5. À la fin de la cuisson, ajoutez la ciboule, les cacahuètes et les germes de soja. Servez avec un peu de coriandre.`,
};

async function notionPost(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    body: JSON.stringify(body)
  });
  const d = await r.json();
  if (d.object === 'error') throw new Error(d.message);
  return d;
}

async function main() {
  if (!NOTION_TOKEN) { console.error('NOTION_TOKEN manquant'); process.exit(1); }

  // Photo — plat végétarien, tag express
  process.stdout.write('🖼️  Photo... ');
  let photo = null;
  try {
    const r = await fetch('https://api.pexels.com/v1/search?query=pad+thai+noodles+eggs+wok&per_page=3&orientation=landscape', { headers: { Authorization: PEXELS_KEY } });
    const d = await r.json();
    photo = d.photos?.[0]?.src?.large2x || null;
    console.log(photo ? '✓' : 'aucune');
  } catch { console.log('aucune'); }

  process.stdout.write('📥 Recette... ');
  const page = await notionPost('https://api.notion.com/v1/pages', {
    parent: { database_id: DB_RECETTES },
    properties: {
      'Nom':                  { title:     [{ text: { content: recette.nom } }] },
      'Catégorie':            { select:    { name: recette.categorie } },
      'Temps de préparation': { number:    recette.temps },
      'Portions':             { number:    recette.portions },
      'Ingrédients':          { rich_text: [{ text: { content: recette.ingredients } }] },
      'Instructions':         { rich_text: [{ text: { content: recette.instructions } }] },
      'Likes':                { number:    0 },
      'Dislikes':             { number:    0 },
      'Fois cuisinée':        { number:    0 },
      ...(photo ? { 'Photo': { url: photo } } : {})
    }
  });
  console.log('✓');

  process.stdout.write('📅 Planning ce soir (Dîner)... ');
  await notionPost('https://api.notion.com/v1/pages', {
    parent: { database_id: DB_PLANNING },
    properties: {
      'Repas':          { title:     [{ text: { content: recette.nom } }] },
      'Date':           { date:      { start: '2026-07-04' } },
      'Moment':         { select:    { name: 'Dîner' } },
      'Recette':        { rich_text: [{ text: { content: recette.nom } }] },
      'Recette ID':     { rich_text: [{ text: { content: page.id } }] },
      'Portions':       { number:    recette.portions },
      "File d'attente": { checkbox:  false },
    }
  });
  console.log('✓');
  console.log('\n✅ Pad Thaï aux œufs importé et planifié ce soir ! 🥢');
}

main().catch(console.error);
