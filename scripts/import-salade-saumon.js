// node scripts/import-salade-saumon.js
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';

const recette = {
  nom: "Salade fraîcheur au saumon frais",
  categorie: "Déjeuner",
  temps: 25,
  portions: 4,
  ingredients: `4 pavés de saumon frais (environ 150g chacun)
150g de mesclun ou roquette
1 avocat
200g de tomates cerises
1 concombre
1 citron (jus)
2 càs d'huile d'olive
1 càs de sauce soja
1 càc de miel
Sel, poivre
Aneth ou ciboulette fraîche`,
  instructions: `1. Cuire les pavés de saumon à la poêle avec un filet d'huile d'olive, 4-5 min de chaque côté à feu moyen. Saler et poivrer. Laisser tiédir puis émietter grossièrement à la fourchette.
2. Préparer la vinaigrette : mélanger le jus de citron, l'huile d'olive, la sauce soja et le miel. Ajuster sel et poivre.
3. Couper les tomates cerises en deux, émincer le concombre en rondelles, couper l'avocat en tranches.
4. Disposer le mesclun dans les assiettes. Ajouter les légumes et les morceaux de saumon.
5. Arroser de vinaigrette et parsemer d'aneth ou de ciboulette ciselée. Servir immédiatement.`,
  photo: "https://lacuisinedegeraldine.fr/wp-content/uploads/2023/06/fresh-salmon-salad-60.jpg",
  source: "https://lacuisinedegeraldine.fr/salade-fraicheur-au-saumon-frais"
};

async function main() {
  if (!NOTION_TOKEN) { console.error('NOTION_TOKEN manquant'); process.exit(1); }

  process.stdout.write('📤 Import dans Notion... ');
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    body: JSON.stringify({
      parent: { database_id: DB_RECETTES },
      properties: {
        'Nom':                  { title:      [{ text: { content: recette.nom } }] },
        'Catégorie':            { select:     { name: recette.categorie } },
        'Temps de préparation': { number:     recette.temps },
        'Portions':             { number:     recette.portions },
        'Ingrédients':          { rich_text:  [{ text: { content: recette.ingredients } }] },
        'Instructions':         { rich_text:  [{ text: { content: recette.instructions } }] },
        'Note':                 { select:     { name: '****' } },
        'Likes':                { number:     0 },
        'Dislikes':             { number:     0 },
        'Fois cuisinée':        { number:     0 },
        'Photo':                { url:        recette.photo },
        'Source':               { url:        recette.source },
      }
    })
  });
  const data = await res.json();
  if (data.object === 'error') throw new Error(data.message);
  console.log('✅ Salade fraîcheur au saumon frais importée !');
}

main().catch(console.error);
