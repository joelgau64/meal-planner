// node scripts/import-quiches-tartes.js
// Bulk import — 13 recettes du livre "Recettes instables - Quiches et tartes"
// Cas particulier : source fixe, photos laissées vides (fallback emoji dans l'app).
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';
const SOURCE = 'Recettes instables - Quiches et tartes';

const recettes = [
  {
    nom: "Tarte fine au zaatar et tomates multicolores",
    categorie: "Déjeuner", temps: 35, portions: 4,
    ingredients: `1 pâte à pizza préétalée\n400g de tomates multicolores\n2 càs de zaatar\n6 càs d'huile d'olive\n1/2 botte de basilic`,
    instructions: `1. Déroulez la pâte avec son papier sur une plaque. Mélangez le zaatar avec la moitié de l'huile, puis couvrez-en la pâte et enfournez pour 15 min à four chaud (220°C).\n2. Coupez les tomates en fines rondelles. Déposez-les sur la pizza dès la sortie du four, assaisonnez, arrosez du reste d'huile et parsemez de basilic.`,
  },
  {
    nom: "Tarte épaisse aux deux saumons",
    categorie: "Dîner", temps: 65, portions: 6,
    ingredients: `1 pâte brisée préétalée\n300g de saumon frais en gros dés\n100g de saumon fumé en lanières\n3 œufs\n25cl de crème liquide\n2 càs de moutarde\nPoivre`,
    instructions: `1. Déroulez la pâte avec son papier dans un moule à tarte à bord haut (ø 20-22 cm), puis étalez la moutarde dessus. Répartissez les saumons sur la tarte.\n2. Fouettez les œufs avec la crème, du poivre et un peu de sel (le saumon fumé est déjà salé), puis versez sur la pâte et enfournez pour 50 min à four chaud (180°C).`,
  },
  {
    nom: "Tartelettes aux carottes et aux noisettes",
    categorie: "Déjeuner", temps: 55, portions: 4,
    ingredients: `1 pâte feuilletée préétalée\n700g de carottes en rondelles\n30g de noisettes concassées\n3 càs d'huile d'olive\n1 ou 2 càc de cumin en poudre\n20cl de crème liquide\n1 oignon rouge émincé\nSel, poivre`,
    instructions: `1. Dans une sauteuse, faites suer l'oignon avec l'huile. Ajoutez les carottes, du sel, du poivre et le cumin, puis laissez cuire 20 min à feu doux, sans couvrir, en remuant de temps en temps. Hors du feu, ajoutez la crème et mélangez.\n2. Garnissez de pâte 4 moules à tartelettes (ø 13 cm). Piquez à la fourchette, puis couvrez de carottes. Parsemez de noisettes.\n3. Enfournez pour 20 min à four chaud (180°C). Servez tiède.`,
  },
  {
    nom: "Flamiche aux poireaux et aux lardons",
    categorie: "Dîner", temps: 60, portions: 4,
    ingredients: `1 pâte brisée préétalée\n500g de blancs de poireau en rondelles\n125g de lardons fumés\n4 œufs\n30cl de crème fraîche épaisse\n20g de beurre\nSel, poivre`,
    instructions: `1. Dans une sauteuse, faites cuire les poireaux dans le beurre 15 min à feu doux en remuant. Faites revenir les lardons à la poêle.\n2. Garnissez de pâte un moule à tarte (ø 28 cm). Déposez les lardons.\n3. Battez les œufs avec la crème, du sel et du poivre. Ajoutez les poireaux et mélangez. Versez la préparation dans le moule et enfournez pour 35 à 40 min à four chaud (200°C).`,
  },
  {
    nom: "Quiche lorraine",
    categorie: "Dîner", temps: 60, portions: 4,
    ingredients: `1 pâte brisée préétalée\n150g de lardons allumettes\n4 œufs\n25cl de crème fraîche épaisse\nPoivre`,
    instructions: `1. Garnissez de pâte un moule à tarte (ø 24 cm). Couvrez de papier sulfurisé, puis de légumes secs en tassant bien. Enfournez pour 10 min à four chaud (180°C). Sortez le moule du four, retirez les légumes secs et le papier.\n2. Plongez les lardons dans l'eau frémissante, remuez, puis égouttez. Mélangez les œufs et la crème.\n3. Déposez les lardons sur la pâte, puis versez la crème et poivrez. Enfournez pour 30 à 35 min.`,
  },
  {
    nom: "Tarte soleil aux poivrons, aubergines et sardines",
    categorie: "Déjeuner", temps: 45, portions: 6,
    ingredients: `2 pâtes feuilletées préétalées\n4 poivrons grillés en bocal\n200g de caviar d'aubergine\n1 boîte de sardines à l'huile désarêtées\n4 brins de menthe hachés`,
    instructions: `1. Étalez le caviar d'aubergine sur 1 pâte. Ajoutez les sardines émiettées, la menthe et les poivrons en lanières. Recouvrez avec l'autre pâte en pressant légèrement les bords.\n2. Placez un verre à l'envers au centre. Avec un couteau, coupez les pâtes du centre vers l'extérieur, d'abord en 4, puis en 8, 16, et enfin 32 afin d'obtenir des bandelettes. Torsadez chacune des bandelettes en appuyant bien sur l'extrémité.\n3. Enfournez pour 25 min à four chaud (190°C).`,
  },
  {
    nom: "Tourte au bœuf et à la feta",
    categorie: "Dîner", temps: 75, portions: 6,
    ingredients: `2 pâtes feuilletées préétalées\n500g de bœuf haché\n100g de feta émiettée\n1 oignon haché\n1 œuf (blanc et jaune séparés)\n200g de sauce tomate\nSel, poivre`,
    instructions: `1. Mélangez l'oignon avec la viande, le blanc d'œuf et la sauce tomate, puis assaisonnez.\n2. Garnissez de pâte un moule à tarte (ø 24 cm). Couvrez de farce et parsemez de feta.\n3. Couvrez de la seconde pâte, soudez les bords en les humidifiant, retirez l'excédent, puis badigeonnez de jaune d'œuf battu avec un peu d'eau.\n4. Creusez une petite cheminée au centre et enfournez pour 1h à four chaud (170°C).`,
  },
  {
    nom: "Pizza aux légumes grillés",
    categorie: "Dîner", temps: 30, portions: 4,
    ingredients: `1 pâte à pizza préétalée\n500g de légumes grillés surgelés\n2 càs de concentré de tomate\n1 gousse d'ail pressée\n1 càs de câpres\n1/2 bouquet de basilic effeuillé\nHuile d'olive\nSel, poivre`,
    instructions: `1. Faites décongeler les légumes. Laissez-les mariner 5 min avec l'ail et de l'huile. Salez et poivrez.\n2. Étalez le concentré de tomate sur la pâte, puis répartissez les légumes dessus. Enfournez pour 10 à 15 min à four chaud (200°C).\n3. À la sortie du four, ajoutez les câpres et le basilic.`,
  },
  {
    nom: "Quiche aux légumes et au mascarpone",
    categorie: "Dîner", temps: 65, portions: 4,
    ingredients: `1 pâte feuilletée préétalée\n250g de mascarpone\n100g de parmesan râpé\n100g de tomates cerises coupées en 2\n100g de petits pois frais ou surgelés\n1/2 bouquet de basilic ciselé\n3 œufs\nSel, poivre`,
    instructions: `1. Déroulez la pâte dans un moule à tarte (ø 26 cm). Couvrez de papier sulfurisé et de légumes secs. Enfournez pour 10 min à four chaud (180°C).\n2. Pendant ce temps, faites cuire les petits pois 5 min à l'eau bouillante salée.\n3. Battez les œufs avec le mascarpone, le parmesan, du sel et du poivre. Ajoutez les petits pois et le basilic. Versez sur la pâte. Ajoutez les tomates et enfournez pour 40 min. Servez chaud.`,
  },
  {
    nom: "Quiche au thon",
    categorie: "Dîner", temps: 50, portions: 4,
    ingredients: `1 pâte brisée préétalée\n1 boîte de thon (200g égoutté)\n3 œufs\n10cl de crème liquide\n1 ou 2 càs de moutarde\nSel, poivre`,
    instructions: `1. Égouttez le thon, puis écrasez-le à la fourchette. Fouettez les œufs avec la moutarde et la crème. Salez peu et poivrez.\n2. Garnissez de pâte un moule à tarte. Piquez à la fourchette. Répartissez le thon dessus, puis versez la préparation aux œufs.\n3. Enfournez pour 30 à 35 min à four chaud (180°C). Servez chaud ou froid.`,
  },
  {
    nom: "Quiche à la truite et aux fines herbes",
    categorie: "Dîner", temps: 55, portions: 4,
    ingredients: `1 pâte brisée préétalée\n300g de filet de truite\n3 œufs\n50g d'emmental râpé\nquelques brins d'aneth ciselés\n1 petit bouquet de ciboulette ciselé\n10cl de lait\nSel, poivre`,
    instructions: `1. Garnissez de pâte un moule à tarte. Piquez le fond à la fourchette.\n2. Faites cuire la truite 5 min à la vapeur, puis coupez-la en dés. Répartissez-les sur la pâte.\n3. Fouettez les œufs avec le lait et le fromage. Salez, poivrez et ajoutez l'aneth et la ciboulette. Versez sur le fond de tarte. Enfournez pour 35 min à four chaud (180°C). Servez chaud.`,
  },
  {
    nom: "Pizza Margherita",
    categorie: "Dîner", temps: 30, portions: 4,
    ingredients: `1 pâte à pizza préétalée\n200g de sauce tomate au basilic\n2 boules de mozzarella en tranches\n2 tranches de jambon en dés\n1/2 càc d'herbes de Provence\nSel, poivre`,
    instructions: `1. Déroulez la pâte avec son papier sur une plaque. Couvrez de sauce tomate.\n2. Répartissez le jambon et la mozzarella dessus. Parsemez d'herbes de Provence, salez et poivrez.\n3. Enfournez pour 15 min environ à four chaud (180°C).`,
  },
  {
    nom: "Quiche aux petits pois, menthe et jambon",
    categorie: "Dîner", temps: 70, portions: 4,
    ingredients: `1 pâte brisée préétalée\n125g de petits pois écossés\n2 tranches de jambon en dés\n2 œufs\n20cl de crème liquide\n20 feuilles de menthe ciselées\nSel, poivre`,
    instructions: `1. Faites cuire les petits pois 10 min à l'eau bouillante salée.\n2. Fouettez les œufs avec la crème, salez, poivrez, puis ajoutez la menthe. Égouttez les petits pois et passez-les sous l'eau froide.\n3. Garnissez de pâte un moule à tarte. Piquez la pâte et répartissez les petits pois et le jambon dessus. Versez la préparation aux œufs, puis enfournez pour 45 min à four chaud (180°C).`,
  },
];

async function main() {
  if (!NOTION_TOKEN) { console.error('NOTION_TOKEN manquant'); process.exit(1); }
  let ok = 0, skip = 0, fail = 0;

  for (const r of recettes) {
    // Déduplication par titre exact
    const existing = await fetch(`https://api.notion.com/v1/databases/${DB_RECETTES}/query`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
      body: JSON.stringify({ filter: { property: 'Nom', title: { equals: r.nom } }, page_size: 1 })
    }).then(x => x.json());

    if (existing.results?.length > 0) {
      console.log('⏭️  déjà présent :', r.nom);
      skip++; continue;
    }

    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
      body: JSON.stringify({
        parent: { database_id: DB_RECETTES },
        properties: {
          'Nom': { title: [{ text: { content: r.nom } }] },
          'Catégorie': { select: { name: r.categorie } },
          'Temps de préparation': { number: r.temps },
          'Portions': { number: r.portions },
          'Ingrédients': { rich_text: [{ text: { content: r.ingredients } }] },
          'Instructions': { rich_text: [{ text: { content: r.instructions } }] },
          'Likes': { number: 0 }, 'Dislikes': { number: 0 }, 'Fois cuisinée': { number: 0 },
          'Commentaires': { rich_text: [{ text: { content: SOURCE } }] },
        }
      })
    });
    const data = await res.json();
    if (data.object === 'error') { console.log('❌', r.nom, '—', data.message); fail++; }
    else { console.log('✅', r.nom); ok++; }
    await new Promise(res => setTimeout(res, 350)); // throttle Notion
  }

  console.log(`\n📊 ${ok} ajoutées · ${skip} déjà présentes · ${fail} échecs`);
}

main().catch(console.error);
