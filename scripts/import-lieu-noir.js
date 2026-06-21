// node scripts/import-lieu-noir.js
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';
const DB_PLANNING = 'dc70bd98-0691-41b9-abfc-5bde68630995';
const PEXELS_KEY = '4g2jiEPcHQiYGhnNjrviL0NacwVzxAKrQ7qokCncr1lauq2ARQdhTRFp';

const recette = {
  nom: "Lieu noir sur la peau, brocoli vapeur, sauce vierge",
  categorie: "Dîner",
  temps: 25,
  portions: 4,
  ingredients: `4 filets de lieu noir (150-180g chacun)
500g pommes de terre Charlotte
1 brocoli (400g en fleurettes)
2 càs huile d'olive
1 noix de beurre
Sel, poivre
Pour la sauce vierge:
200g tomates cerises (coupées en deux)
1 bouquet de basilic frais
1 bouquet de ciboulette
1 citron (jus)
4 càs huile d'olive extra vierge
Sel, poivre`,
  instructions: `1. Cuire les pommes de terre à l'autocuiseur vapeur 12-15 min selon la taille.
2. Ajouter les fleurettes de brocoli dans le panier vapeur les 3-4 dernières minutes.
3. Préparer la sauce vierge : couper les tomates cerises en deux, ciseler basilic et ciboulette. Mélanger avec le jus de citron et l'huile d'olive. Saler et poivrer. Réserver à température ambiante.
4. Sortir les filets de lieu noir du réfrigérateur 15 min avant. Sécher avec du papier absorbant.
5. Chauffer une poêle à feu vif avec l'huile d'olive. Poser les filets côté peau, appuyer 30 secondes.
6. Cuire 4-5 min côté peau sans toucher. Retourner, éteindre le feu, laisser reposer 1-2 min.
7. Saler en fin de cuisson. Servir avec les légumes vapeur et la sauce vierge à température ambiante.`
};

async function findPhoto() {
  const res = await fetch(`https://api.pexels.com/v1/search?query=fish+fillet+crispy+skin+food&per_page=3&orientation=landscape`, {
    headers: { 'Authorization': PEXELS_KEY }
  });
  const data = await res.json();
  return data.photos?.[0]?.src?.large2x || null;
}

async function notionPost(path, body) {
  const res = await fetch(`https://api.notion.com${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.object === 'error') throw new Error(data.message);
  return data;
}

async function main() {
  console.log('🖼️  Recherche photo...');
  const photo = await findPhoto().catch(() => null);

  console.log('📥 Import recette dans Notion...');
  const page = await notionPost('/v1/pages', {
    parent: { database_id: DB_RECETTES },
    properties: {
      'Nom': { title: [{ text: { content: recette.nom } }] },
      'Catégorie': { select: { name: recette.categorie } },
      'Temps de préparation': { number: recette.temps },
      'Portions': { number: recette.portions },
      'Ingrédients': { rich_text: [{ text: { content: recette.ingredients } }] },
      'Instructions': { rich_text: [{ text: { content: recette.instructions } }] },
      'Note': { select: { name: '***' } },
      'Likes': { number: 0 }, 'Dislikes': { number: 0 }, 'Fois cuisinée': { number: 0 },
      ...(photo ? { 'Photo': { url: photo } } : {}),
    }
  });
  console.log('✓ Recette créée:', page.id);

  console.log('📅 Ajout au planning ce soir...');
  await notionPost('/v1/pages', {
    parent: { database_id: DB_PLANNING },
    properties: {
      'Repas': { title: [{ text: { content: recette.nom } }] },
      'Date': { date: { start: '2026-06-21' } },
      'Moment': { select: { name: 'Dîner' } },
      'Recette': { rich_text: [{ text: { content: recette.nom } }] },
      'Recette ID': { rich_text: [{ text: { content: page.id } }] },
      'Portions': { number: recette.portions },
      'Acheté': { checkbox: false },
      "File d'attente": { checkbox: false },
    }
  });
  console.log('✓ Planifié ce soir en Dîner');
  console.log('\n✅ Tout est prêt ! Bon appétit 🍽️');
}

main().catch(console.error);
