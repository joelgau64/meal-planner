// Script: ajoute 12 recettes estivales dans la file d'attente du planning Notion
// Usage: node scripts/queue-estivales.js

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';
const DB_PLANNING = 'dc70bd98-0691-41b9-abfc-5bde68630995';

const RECETTES_ESTIVALES = [
  'Bowl avocat saumon',
  'Salade caprese',
  'Assiette falafels houmous',
  'Poke bowl teriyaki',
  'Salade quinoa légumes grillés',
  'Salade de lentilles estivale',
  'Brochettes poulet marinade grecque',
  'Soupe froide betterave',
  'Clafoutis cerises léger',
  'Salade pastèque feta menthe',
  'Panna cotta fruits de la passion',
  'Fattoush libanais',
];

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

// Cherche une recette par nom dans la DB Recettes
async function findRecette(nom) {
  const res = await notionFetch(`/v1/databases/${DB_RECETTES}/query`, 'POST', {
    filter: {
      property: 'Nom',
      title: { equals: nom }
    }
  });
  return res.results?.[0] || null;
}

// Ajoute dans la file d'attente du planning
async function addToQueue(nom, recetteId) {
  const res = await notionFetch('/v1/pages', 'POST', {
    parent: { database_id: DB_PLANNING },
    properties: {
      'Nom': { title: [{ text: { content: nom } }] },
      'Recette ID': { rich_text: [{ text: { content: recetteId || '' } }] },
      'Recette': { rich_text: [{ text: { content: nom } }] },
      'File d\'attente': { checkbox: true },
      'Portions': { number: 4 },
      'Acheté': { checkbox: false },
    }
  });
  if (res.object === 'error') throw new Error(res.message);
  return res;
}

async function main() {
  if (!NOTION_TOKEN) {
    console.error('❌ NOTION_TOKEN manquant.');
    process.exit(1);
  }

  console.log(`📋 Ajout de ${RECETTES_ESTIVALES.length} recettes dans la file d'attente...\n`);

  let ok = 0, fail = 0;
  for (const nom of RECETTES_ESTIVALES) {
    process.stdout.write(`➕ ${nom}... `);
    try {
      // Chercher l'ID de la recette dans Notion
      const recette = await findRecette(nom);
      const recetteId = recette?.id || '';
      if (!recette) process.stdout.write('(recette non trouvée en DB, ajout quand même) ');

      await addToQueue(nom, recetteId);
      console.log('✓');
      ok++;
    } catch (e) {
      console.log(`❌ ${e.message}`);
      fail++;
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n✅ ${ok} recettes ajoutées à la file d'attente, ${fail} erreurs`);
}

main().catch(console.error);
