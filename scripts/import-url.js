// Usage: node scripts/import-url.js <URL>
import { execSync } from 'child_process';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';
const PEXELS_KEY = '4g2jiEPcHQiYGhnNjrviL0NacwVzxAKrQ7qokCncr1lauq2ARQdhTRFp';

const url = process.argv[2];
if(!url){ console.error('Usage: node scripts/import-url.js <URL>'); process.exit(1); }
if(!NOTION_TOKEN){ console.error('NOTION_TOKEN manquant'); process.exit(1); }
if(!ANTHROPIC_KEY){ console.error('ANTHROPIC_API_KEY manquant'); process.exit(1); }

const RECIPE_JSON_PROMPT = `Retourne UNIQUEMENT ce JSON sans backticks:
{"nom":"nom du plat","categorie":"Déjeuner|Dîner|Dessert|Sauce & Marinade","temps":30,"portions":4,"ingredients":"UN ingrédient par ligne avec quantité métrique","instructions":"étapes numérotées séparées par \\n","note":"***"}`;

async function main(){
  console.log('🔍 Extraction de la recette depuis', url);

  const res = await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01'},
    body: JSON.stringify({
      model:'claude-sonnet-4-6', max_tokens:2000,
      system:'Tu es un expert en recettes françaises. Retourne UNIQUEMENT un JSON valide, sans backticks ni texte autour.',
      messages:[{role:'user',content:`Visite cette URL et extrais la recette complète en français avec mesures métriques:\n${url}\n\n${RECIPE_JSON_PROMPT}`}],
      tools:[{type:'web_search_20250305',name:'web_search'}]
    })
  });
  const data = await res.json();
  const text = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
  const clean = text.replace(/```json\n?|```\n?/g,'').trim();
  const recipe = JSON.parse(clean);
  console.log('✓ Recette extraite:', recipe.nom);

  // Photo Pexels
  const q = encodeURIComponent(recipe.nom+' food dish');
  const pRes = await fetch(`https://api.pexels.com/v1/search?query=${q}&per_page=3&orientation=landscape`,{headers:{Authorization:PEXELS_KEY}});
  const pData = await pRes.json();
  const photo = pData.photos?.[0]?.src?.large2x || null;
  if(photo) console.log('✓ Photo trouvée');

  // Import Notion
  const nRes = await fetch('https://api.notion.com/v1/pages',{
    method:'POST',
    headers:{'Authorization':`Bearer ${NOTION_TOKEN}`,'Content-Type':'application/json','Notion-Version':'2022-06-28'},
    body: JSON.stringify({
      parent:{database_id:DB_RECETTES},
      properties:{
        'Nom':{title:[{text:{content:recipe.nom}}]},
        'Catégorie':{select:{name:recipe.categorie||'Dîner'}},
        'Temps de préparation':{number:recipe.temps||30},
        'Portions':{number:recipe.portions||4},
        'Ingrédients':{rich_text:[{text:{content:recipe.ingredients||''}}]},
        'Instructions':{rich_text:[{text:{content:recipe.instructions||''}}]},
        'Note':{select:{name:'***'}},
        'Likes':{number:0},'Dislikes':{number:0},'Fois cuisinée':{number:0},
        'Source':{url:url},
        ...(photo?{'Photo':{url:photo}}:{})
      }
    })
  });
  const nData = await nRes.json();
  if(nData.object==='error') throw new Error(nData.message);
  console.log('✅ Importée dans Notion !');
}

main().catch(console.error);
