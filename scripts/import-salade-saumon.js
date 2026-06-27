// node scripts/import-salade-saumon.js
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';

const recette = {
  nom: "Salade fraîcheur au saumon frais",
  categorie: "Déjeuner",
  temps: 25,
  portions: 4,
  ingredients: `400g de filets de saumon frais (ou restes de saumon cuit)
400g de tomates cerises coupées en deux
1 concombre coupé en tranches
150g de petits pois (frais ou surgelés)
1 avocat coupé en tranches
1 poivron rouge coupé en petits cubes
2 petits oignons rouges émincés finement
6 tiges d'aneth
1 bouquet de persil
6 tiges de basilic
Pour la vinaigrette:
2 càs de jus de citron
4 càs d'huile d'olive extra vierge
1 càc de moutarde de Dijon
Sel et poivre noir`,
  instructions: `1. Assaisonner les filets de saumon, les déposer côté peau dans un plat huilé et cuire 12 à 15 min à 200°C. Laisser refroidir, retirer la peau et émietter avec une fourchette.
2. Si petits pois frais, les blanchir 3 min dans l'eau bouillante salée puis passer sous l'eau froide. Si surgelés, les décongeler simplement.
3. Hacher l'aneth, le persil et le basilic, réserver quelques feuilles pour la décoration.
4. Dans un saladier, mettre les tomates cerises, le concombre, l'oignon rouge, le poivron et les petits pois. Saler et poivrer.
5. Préparer la vinaigrette : mélanger la moutarde, le jus de citron, sel et poivre, puis ajouter l'huile d'olive et émulsionner.
6. Ajouter le saumon émietté et les herbes aux crudités, verser la vinaigrette et mélanger délicatement.
7. Décorer avec les tranches d'avocat et quelques feuilles de basilic. Servir aussitôt.`,
  photo: "https://lacuisinedegeraldine.fr/wp-content/uploads/2023/06/fresh-salmon-salad-60.jpg",
  source: "https://lacuisinedegeraldine.fr/salade-fraicheur-au-saumon-frais"
};

async function main() {
  if (!NOTION_TOKEN) { console.error('NOTION_TOKEN manquant'); process.exit(1); }

  // Vérifier si existe déjà
  const search = await fetch(`https://api.notion.com/v1/databases/${DB_RECETTES}/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    body: JSON.stringify({ filter: { property: 'Nom', title: { equals: recette.nom } } })
  }).then(r => r.json());

  const existing = search.results?.[0];
  const method = existing ? 'PATCH' : 'POST';
  const url = existing ? `https://api.notion.com/v1/pages/${existing.id}` : 'https://api.notion.com/v1/pages';

  const properties = {
    'Nom':                  { title:     [{ text: { content: recette.nom } }] },
    'Catégorie':            { select:    { name: recette.categorie } },
    'Temps de préparation': { number:    recette.temps },
    'Portions':             { number:    recette.portions },
    'Ingrédients':          { rich_text: [{ text: { content: recette.ingredients } }] },
    'Instructions':         { rich_text: [{ text: { content: recette.instructions } }] },
    'Note':                 { select:    { name: '****' } },
    'Likes':                { number:    0 },
    'Dislikes':             { number:    0 },
    'Fois cuisinée':        { number:    0 },
    'Photo':                { url:       recette.photo },
    'Source':               { url:       recette.source },
  };

  process.stdout.write(existing ? '🔄 Mise à jour... ' : '📥 Import... ');
  const body = existing ? { properties } : { parent: { database_id: DB_RECETTES }, properties };
  const data = await fetch(url, {
    method,
    headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    body: JSON.stringify(body)
  }).then(r => r.json());

  if (data.object === 'error') throw new Error(data.message);
  console.log('✅ Salade fraîcheur au saumon importée avec petits pois !');
}

main().catch(console.error);
