// node scripts/import-semaine.js
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';
const DB_PLANNING = 'dc70bd98-0691-41b9-abfc-5bde68630995';
const PEXELS_KEY  = '4g2jiEPcHQiYGhnNjrviL0NacwVzxAKrQ7qokCncr1lauq2ARQdhTRFp';

const recettes = [
  {
    nom: "Tatin de tomates à l'italienne",
    categorie: "Déjeuner",
    temps: 70,
    portions: 4,
    ingredients: `1 pâte feuilletée
800g de tomates
250g de mozzarella
1 gousse d'ail
2 càs de sucre roux
2 càs d'huile d'olive
1 brin de romarin
Sel et poivre`,
    instructions: `1. Préchauffez le four à 180°C. Coupez les tomates en deux et retirez les pépins.
2. Huilez le fond d'un moule à tarte et saupoudrez-le de sucre roux. Déposez les demi-tomates côté chair vers le fond puis parsemez d'ail haché. Enfournez pour 25 min jusqu'à ce que le jus des tomates se soit évaporé.
3. Coupez la mozzarella en fines tranches et disposez-les sur les tomates. Recouvrez avec la pâte feuilletée et piquez-la avec une fourchette.
4. Enfournez pour 25 min de nouveau. Retournez le moule sur un plat et parsemez de romarin avant de servir.`,
    date: '2026-06-28',
    moment: 'Déjeuner',
    search: 'tomato tarte tatin italian food',
  },
  {
    nom: "Poulet italien à la sauce tomate",
    categorie: "Dîner",
    temps: 95,
    portions: 4,
    ingredients: `4 cuisses de poulet coupées en deux à la jointure
4 càs d'huile d'olive
1 gros oignon finement haché
1 branche de céleri finement hachée
75g de pancetta coupée en dés
2 gousses d'ail pilées
3 feuilles de laurier
4 càs de vermouth sec ou de vin blanc
800g de tomates en boîte
1 càc de sucre en poudre
3 càs de purée de tomates séchées
25g de feuilles de basilic ciselées
8 olives noires
Sel et poivre`,
    instructions: `1. Salez et poivrez le poulet. Faites chauffer l'huile dans une sauteuse et faites dorer le poulet. Réservez sur un plat.
2. Faites revenir l'oignon, le céleri et la pancetta 10 min à feu doux. Ajoutez l'ail et le laurier, remuez 1 minute.
3. Ajoutez le vermouth ou vin blanc, les tomates, le sucre et la purée de tomates séchées. Salez, poivrez, portez à ébullition. Remettez le poulet, baissez le feu et laissez frémir 1 heure à découvert.
4. Juste avant de servir, ajoutez le basilic et les olives. Vérifiez l'assaisonnement.`,
    date: '2026-06-30',
    moment: 'Dîner',
    search: 'italian chicken tomato sauce olives',
  }
];

async function findPhoto(q) {
  try {
    const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=3&orientation=landscape`, { headers: { Authorization: PEXELS_KEY } });
    const d = await r.json();
    return d.photos?.[0]?.src?.large2x || null;
  } catch { return null; }
}

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

  for (const r of recettes) {
    console.log(`\n📥 ${r.nom}`);

    process.stdout.write('   🖼️  Photo... ');
    const photo = await findPhoto(r.search);
    console.log(photo ? '✓' : 'aucune');

    process.stdout.write('   📤 Recette... ');
    const page = await notionPost('https://api.notion.com/v1/pages', {
      parent: { database_id: DB_RECETTES },
      properties: {
        'Nom':                  { title:     [{ text: { content: r.nom } }] },
        'Catégorie':            { select:    { name: r.categorie } },
        'Temps de préparation': { number:    r.temps },
        'Portions':             { number:    r.portions },
        'Ingrédients':          { rich_text: [{ text: { content: r.ingredients } }] },
        'Instructions':         { rich_text: [{ text: { content: r.instructions } }] },
        'Likes':                { number:    0 },
        'Dislikes':             { number:    0 },
        'Fois cuisinée':        { number:    0 },
        ...(photo ? { 'Photo': { url: photo } } : {})
      }
    });
    console.log('✓');

    process.stdout.write(`   📅 Planning ${r.date} (${r.moment})... `);
    await notionPost('https://api.notion.com/v1/pages', {
      parent: { database_id: DB_PLANNING },
      properties: {
        'Repas':          { title:     [{ text: { content: r.nom } }] },
        'Date':           { date:      { start: r.date } },
        'Moment':         { select:    { name: r.moment } },
        'Recette':        { rich_text: [{ text: { content: r.nom } }] },
        'Recette ID':     { rich_text: [{ text: { content: page.id } }] },
        'Portions':       { number:    r.portions },
        "File d'attente": { checkbox:  false },
      }
    });
    console.log('✓');
  }
  console.log('\n✅ Les deux recettes sont importées et planifiées !');
  console.log('   📅 Tatin → Dimanche 28 juin, Déjeuner');
  console.log('   📅 Poulet → Lundi 29 juin, Dîner');
}

main().catch(console.error);
