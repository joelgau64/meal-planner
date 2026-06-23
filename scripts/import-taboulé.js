// node scripts/import-taboulé.js
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';
const PEXELS_KEY = '4g2jiEPcHQiYGhnNjrviL0NacwVzxAKrQ7qokCncr1lauq2ARQdhTRFp';

const recette = {
  nom: "Taboulé libanais",
  categorie: "Déjeuner",
  temps: 20,
  portions: 4,
  ingredients: `200g boulghour fin
4 tomates bien mûres
1 concombre
2 bouquets de persil plat
1 bouquet de menthe fraîche
4 oignons verts
2 citrons (jus)
6 càs huile d'olive extra vierge
Sel, poivre`,
  instructions: `1. Verser le boulghour dans un saladier, couvrir d'eau froide à hauteur, laisser gonfler 15 min puis égoutter et essorer.
2. Hacher très finement le persil et la menthe (à la main au couteau, pas au mixeur).
3. Couper les tomates en très petits dés, saler légèrement et laisser dégorger 5 min.
4. Couper le concombre en petits dés, émincer les oignons verts.
5. Mélanger le boulghour avec les herbes, les légumes et les oignons.
6. Assaisonner avec le jus de citron, l'huile d'olive, sel et poivre.
7. Réfrigérer au moins 30 min avant de servir pour que les saveurs se mélangent.`,
  source: ""
};

async function main(){
  if(!NOTION_TOKEN){ console.error('NOTION_TOKEN manquant'); process.exit(1); }

  // Photo
  process.stdout.write('🖼️  Photo... ');
  let photo = null;
  try{
    const r = await fetch('https://api.pexels.com/v1/search?query=tabbouleh+lebanese+salad&per_page=3&orientation=landscape',{headers:{Authorization:PEXELS_KEY}});
    const d = await r.json();
    photo = d.photos?.[0]?.src?.large2x || null;
    console.log(photo?'✓':'aucune');
  }catch(e){ console.log('aucune'); }

  // Import
  process.stdout.write('📤 Notion... ');
  const res = await fetch('https://api.notion.com/v1/pages',{
    method:'POST',
    headers:{'Authorization':`Bearer ${NOTION_TOKEN}`,'Content-Type':'application/json','Notion-Version':'2022-06-28'},
    body: JSON.stringify({
      parent:{database_id:DB_RECETTES},
      properties:{
        'Nom':{title:[{text:{content:recette.nom}}]},
        'Catégorie':{select:{name:recette.categorie}},
        'Temps de préparation':{number:recette.temps},
        'Portions':{number:recette.portions},
        'Ingrédients':{rich_text:[{text:{content:recette.ingredients}}]},
        'Instructions':{rich_text:[{text:{content:recette.instructions}}]},
        'Note':{select:{name:'***'}},
        'Likes':{number:0},'Dislikes':{number:0},'Fois cuisinée':{number:0},
        ...(photo?{'Photo':{url:photo}}:{})
      }
    })
  });
  const data = await res.json();
  if(data.object==='error') throw new Error(data.message);
  console.log('✅ Taboulé libanais importé !');
}

main().catch(console.error);
