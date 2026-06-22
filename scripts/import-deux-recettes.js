// node scripts/import-deux-recettes.js
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';
const PEXELS_KEY = '4g2jiEPcHQiYGhnNjrviL0NacwVzxAKrQ7qokCncr1lauq2ARQdhTRFp';

// Recette 1 pré-extraite (Laurent Mariotte)
const RECETTE_1 = {
  nom: "Gâteau glacé au yaourt aux fruits rouges",
  categorie: "Dessert",
  temps: 240,
  portions: 8,
  ingredients: `500g yaourt grec entier
200g fruits rouges (fraises, framboises, myrtilles)
150g sucre glace
3 blancs d'œufs
200ml crème liquide entière
1 càs jus de citron
1 càc extrait de vanille
Quelques feuilles de menthe fraîche`,
  instructions: `1. Fouetter les blancs d'œufs en neige ferme avec la moitié du sucre glace.
2. Monter la crème liquide bien froide en chantilly avec l'extrait de vanille.
3. Mélanger le yaourt grec avec le reste du sucre glace et le jus de citron.
4. Incorporer délicatement les blancs en neige au yaourt, puis la chantilly.
5. Ajouter les 3/4 des fruits rouges coupés en morceaux.
6. Verser dans un moule à cake chemisé de film alimentaire.
7. Placer au congélateur minimum 4 heures (idéalement une nuit).
8. Démouler 10 min avant de servir, garnir avec les fruits restants et la menthe.`,
  source: "https://www.laurentmariotte.com/ma-recette-de-gateau-glace-au-yaourt/"
};

function parseJSON(text){
  const match = text.match(/\{[\s\S]*\}/);
  if(!match) throw new Error('No JSON in: '+text.substring(0,100));
  return JSON.parse(match[0]);
}

async function extractRecipe(url){
  const res = await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01'},
    body: JSON.stringify({
      model:'claude-sonnet-4-6', max_tokens:2000,
      system:'Tu es un expert en recettes. Retourne UNIQUEMENT un objet JSON valide, rien d\'autre.',
      messages:[{role:'user',content:`Visite cette URL et extrais la recette en français:\n${url}\n\nJSON (RIEN D'AUTRE): {"nom":"...","categorie":"Déjeuner|Dîner|Dessert","temps":30,"portions":4,"ingredients":"UN ingrédient par ligne","instructions":"étapes numérotées","note":"***"}`}],
      tools:[{type:'web_search_20250305',name:'web_search'}]
    })
  });
  const data = await res.json();
  const text = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
  return parseJSON(text);
}

async function findPhoto(nom){
  try{
    const q = encodeURIComponent(nom+' food dish');
    const res = await fetch(`https://api.pexels.com/v1/search?query=${q}&per_page=3&orientation=landscape`,{headers:{Authorization:PEXELS_KEY}});
    const data = await res.json();
    return data.photos?.[0]?.src?.large2x || null;
  }catch(e){ return null; }
}

async function importToNotion(recipe, url, photo){
  const res = await fetch('https://api.notion.com/v1/pages',{
    method:'POST',
    headers:{'Authorization':`Bearer ${NOTION_TOKEN}`,'Content-Type':'application/json','Notion-Version':'2022-06-28'},
    body: JSON.stringify({
      parent:{database_id:DB_RECETTES},
      properties:{
        'Nom':{title:[{text:{content:recipe.nom}}]},
        'Catégorie':{select:{name:recipe.categorie||'Dessert'}},
        'Temps de préparation':{number:Number(recipe.temps)||60},
        'Portions':{number:Number(recipe.portions)||4},
        'Ingrédients':{rich_text:[{text:{content:String(recipe.ingredients||'')}}]},
        'Instructions':{rich_text:[{text:{content:String(recipe.instructions||'')}}]},
        'Note':{select:{name:'***'}},
        'Likes':{number:0},'Dislikes':{number:0},'Fois cuisinée':{number:0},
        'Source':{url:url},
        ...(photo?{'Photo':{url:photo}}:{})
      }
    })
  });
  const data = await res.json();
  if(data.object==='error') throw new Error(data.message);
  return data;
}

async function main(){
  if(!NOTION_TOKEN){ console.error('NOTION_TOKEN manquant'); process.exit(1); }

  // Recette 1 — pré-extraite
  console.log('\n📥 Gâteau glacé au yaourt (Laurent Mariotte)');
  try{
    process.stdout.write('   🖼️  Photo... ');
    const photo1 = await findPhoto(RECETTE_1.nom);
    console.log(photo1?'✓':'aucune');
    process.stdout.write('   📤 Notion... ');
    await importToNotion(RECETTE_1, RECETTE_1.source, photo1);
    console.log('✅');
  }catch(e){ console.log('❌', e.message); }

  // Recette 2 — Samsung Food (nécessite ANTHROPIC_API_KEY)
  if(!ANTHROPIC_KEY){ console.log('\n⚠️  ANTHROPIC_API_KEY manquant — recette Samsung Food ignorée'); return; }
  console.log('\n📥 Samsung Food (https://s.samsungfood.com/3D2Ru)');
  try{
    process.stdout.write('   🔍 Extraction... ');
    const recipe2 = await extractRecipe('https://s.samsungfood.com/3D2Ru');
    console.log(recipe2.nom);
    process.stdout.write('   🖼️  Photo... ');
    const photo2 = await findPhoto(recipe2.nom);
    console.log(photo2?'✓':'aucune');
    process.stdout.write('   📤 Notion... ');
    await importToNotion(recipe2, 'https://s.samsungfood.com/3D2Ru', photo2);
    console.log('✅');
  }catch(e){ console.log('❌', e.message); }
}

main().catch(console.error);
