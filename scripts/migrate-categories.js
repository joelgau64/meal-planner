// Script: migre les recettes Petit-déjeuner et Snack vers Dîner
// Usage: node scripts/migrate-categories.js

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';

async function notionFetch(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.notion.com${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

async function getRecettesByCategory(categorie) {
  const res = await notionFetch(`/v1/databases/${DB_RECETTES}/query`, 'POST', {
    page_size: 100,
    filter: { property: 'Catégorie', select: { equals: categorie } }
  });
  return res.results || [];
}

async function updateCategorie(pageId, newCat) {
  const res = await notionFetch(`/v1/pages/${pageId}`, 'PATCH', {
    properties: { 'Catégorie': { select: { name: newCat } } }
  });
  if (res.object === 'error') throw new Error(res.message);
}

async function main() {
  if (!NOTION_TOKEN) {
    console.error('❌ NOTION_TOKEN manquant.');
    process.exit(1);
  }

  const toMigrate = ['Petit-déjeuner', 'Snack'];
  let total = 0;

  for (const cat of toMigrate) {
    console.log(`\n🔍 Recherche des recettes "${cat}"...`);
    const recettes = await getRecettesByCategory(cat);
    console.log(`   ${recettes.length} recette(s) trouvée(s)`);

    for (const page of recettes) {
      const nom = page.properties?.['Nom']?.title?.[0]?.plain_text || 'Sans titre';
      process.stdout.write(`   → ${nom}... `);
      try {
        await updateCategorie(page.id, 'Dîner');
        console.log('✓ Dîner');
        total++;
      } catch (e) {
        console.log(`❌ ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }
  }

  console.log(`\n✅ ${total} recettes migrées vers "Dîner"`);
}

main().catch(console.error);
