const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';
const DB_PLANNING = 'dc70bd98-0691-41b9-abfc-5bde68630995';
const PEXELS_KEY = '4g2jiEPcHQiYGhnNjrviL0NacwVzxAKrQ7qokCncr1lauq2ARQdhTRFp';

const recette = {
  nom: "Papillote de saumon lait de coco et gingembre",
  categorie: "Dîner",
  temps: 30,
  portions: 4,
  ingredients: `4 filets de saumon frais sans arêtes (150-180g chacun)
200ml lait de coco
2 càc gingembre frais râpé
2 càs sauce soja
2 càc miel
2 gousses d'ail écrasées
Coriandre fraîche ou oignons verts (facultatif)
Sel, poivre`,
  instructions: `1. Préchauffer le four à 180°C chaleur tournante.
2. Mélanger lait de coco, gingembre, sauce soja, miel et ail dans un bol. Goûter et ajuster — la sauce doit être douce et légèrement parfumée.
3. Déposer chaque filet au centre d'une feuille de papier aluminium. Verser la moitié de la sauce coco sur chaque filet. Assaisonner sel et poivre. Refermer hermétiquement en repliant bien les bords pour que le lait de coco ne s'échappe pas.
4. Déposer les papillotes sur une plaque et enfourner 18 à 20 minutes. La chair doit être opaque et se détacher facilement à la fourchette.
5. Ouvrir délicatement les papillotes en évitant la vapeur. Parsemer de coriandre ou oignons verts. Servir avec du riz basmati.`
};

async function notionPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {'Authorization':`Bearer ${NOTION_TOKEN}`,'Content-Type':'application/json','Notion-Version':'2022-06-28'},
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.object === 'error') throw new Error(data.message);
  return data;
}

async function main() {
  if (!NOTION_TOKEN) { console.error('NOTION_TOKEN manquant'); process.exit(1); }

  // Photo
  process.stdout.write('🖼️  Photo... ');
  let photo = null;
  try {
    const r = await fetch('https://api.pexels.com/v1/search?query=salmon+coconut+milk+papillote+food&per_page=3&orientation=landscape',{headers:{Authorization:PEXELS_KEY}});
    const d = await r.json();
    photo = d.photos?.[0]?.src?.large2x || null;
    console.log(photo ? '✓' : 'aucune');
  } catch(e) { console.log('aucune'); }

  // Import recette
  process.stdout.write('📥 Import recette... ');
  const page = await notionPost('https://api.notion.com/v1/pages', {
    parent: {database_id: DB_RECETTES},
    properties: {
      'Nom': {title:[{text:{content:recette.nom}}]},
      'Catégorie': {select:{name:recette.categorie}},
      'Temps de préparation': {number:recette.temps},
      'Portions': {number:recette.portions},
      'Ingrédients': {rich_text:[{text:{content:recette.ingredients}}]},
      'Instructions': {rich_text:[{text:{content:recette.instructions}}]},
      'Note': {select:{name:'***'}},
      'Likes': {number:0}, 'Dislikes': {number:0}, 'Fois cuisinée': {number:0},
      ...(photo ? {'Photo':{url:photo}} : {})
    }
  });
  console.log('✓', page.id);

  // Planifier ce soir
  process.stdout.write('📅 Planning ce soir... ');
  await notionPost('https://api.notion.com/v1/pages', {
    parent: {database_id: DB_PLANNING},
    properties: {
      'Repas': {title:[{text:{content:recette.nom}}]},
      'Date': {date:{start:'2026-06-27'}},
      'Moment': {select:{name:'Dîner'}},
      'Recette': {rich_text:[{text:{content:recette.nom}}]},
      'Recette ID': {rich_text:[{text:{content:page.id}}]},
      'Portions': {number:recette.portions},
      "File d'attente": {checkbox:false},
    }
  });
  console.log('✓ Planifié ce soir en Dîner');
  console.log('\n✅ Tout est prêt ! Bon appétit 🥥🐟');
}

main().catch(console.error);
