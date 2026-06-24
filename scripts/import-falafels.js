// node scripts/import-falafels.js
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';
const PEXELS_KEY = '4g2jiEPcHQiYGhnNjrviL0NacwVzxAKrQ7qokCncr1lauq2ARQdhTRFp';

const recette = {
  nom: "Assiette falafels, carottes et patates douces rôties",
  categorie: "Déjeuner",
  temps: 60,
  portions: 4,
  ingredients: `2 boîtes de pois chiches (2 × 400g égouttés)
1 oignon
4 gousses d'ail
1 bouquet de persil plat
1 bouquet de coriandre fraîche
1 càs cumin en poudre
1 càs coriandre en poudre
1 càc bicarbonate de soude
3-4 càs farine
Sel, poivre
Huile de friture
Pour les légumes rôtis:
2 patates douces
4 carottes
2 càs huile d'olive
1 càc cumin
1 càc paprika fumé
Sel, poivre
Pour le service:
Houmous (maison ou commerce)
4 pains pita
Tomates cerises, concombre, salade
Pour la sauce tahini:
3 càs tahini
1 citron (jus)
1 gousse d'ail
4 càs eau froide
Sel`,
  instructions: `1. Préchauffer le four à 200°C.
2. Couper patates douces en cubes 2cm, carottes en rondelles. Enrober huile d'olive, cumin, paprika, sel, poivre. Rôtir 25-30 min en retournant à mi-cuisson.
3. Égoutter et rincer les pois chiches. Sécher 1h sur un torchon ou 20 min au four à 100°C — étape critique.
4. Mixer pois chiches, oignon, ail, persil, coriandre, épices. Texture grumeleuse, pas lisse. Ajouter 3-4 càs de farine — la boulette doit tenir sans coller.
5. Ajouter bicarbonate, saler, poivrer. Réfrigérer 1h minimum.
6. Sauce tahini : mélanger tahini, jus de citron, ail écrasé, eau froide. Saler.
7. Former boulettes de 3cm. Tester une boulette en friture — si elle s'effondre, ajouter farine et remettre 30 min au frigo.
8. Chauffer huile à 175°C. Frire par fournées 3-4 min jusqu'à brun foncé uniforme. Égoutter, saler immédiatement.
9. Étaler houmous dans les assiettes. Disposer falafels, légumes rôtis, crudités. Arroser de sauce tahini.`
};

async function main() {
  if (!NOTION_TOKEN) { console.error('NOTION_TOKEN manquant'); process.exit(1); }

  // Chercher si recette existe déjà
  process.stdout.write('🔍 Recherche recette existante... ');
  const search = await fetch(`https://api.notion.com/v1/databases/${DB_RECETTES}/query`, {
    method: 'POST',
    headers: {'Authorization':`Bearer ${NOTION_TOKEN}`,'Content-Type':'application/json','Notion-Version':'2022-06-28'},
    body: JSON.stringify({filter:{property:'Nom',title:{contains:'falafel'}}})
  });
  const existing = await search.json();
  const existingPage = existing.results?.[0];
  console.log(existingPage ? '🔄 Mise à jour' : '➕ Nouvelle recette');

  // Photo
  process.stdout.write('🖼️  Photo... ');
  const pRes = await fetch('https://api.pexels.com/v1/search?query=falafel+plate+food&per_page=3&orientation=landscape',{headers:{Authorization:PEXELS_KEY}});
  const pData = await pRes.json();
  const photo = pData.photos?.[0]?.src?.large2x || null;
  console.log(photo ? '✓' : 'aucune');

  const properties = {
    'Nom':{title:[{text:{content:recette.nom}}]},
    'Catégorie':{select:{name:recette.categorie}},
    'Temps de préparation':{number:recette.temps},
    'Portions':{number:recette.portions},
    'Ingrédients':{rich_text:[{text:{content:recette.ingredients}}]},
    'Instructions':{rich_text:[{text:{content:recette.instructions}}]},
    'Note':{select:{name:'***'}},
    'Likes':{number:0},'Dislikes':{number:0},'Fois cuisinée':{number:0},
    ...(photo?{'Photo':{url:photo}}:{})
  };

  process.stdout.write('📤 Notion... ');
  const method = existingPage ? 'PATCH' : 'POST';
  const url = existingPage ? `https://api.notion.com/v1/pages/${existingPage.id}` : 'https://api.notion.com/v1/pages';
  const body = existingPage ? {properties} : {parent:{database_id:DB_RECETTES},properties};

  const res = await fetch(url, {
    method,
    headers:{'Authorization':`Bearer ${NOTION_TOKEN}`,'Content-Type':'application/json','Notion-Version':'2022-06-28'},
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if(data.object==='error') throw new Error(data.message);
  console.log('✅');
}

main().catch(console.error);
