// node scripts/create-frigo-db.js
// Crée la base "Frigo" dans Notion avec le schéma typé, sous le même parent que la DB Recettes.
// Usage (cmd) :
//   set NOTION_TOKEN=ntn_...
//   node scripts/create-frigo-db.js
// Affiche l'ID de la nouvelle base à coller ensuite dans l'app.

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';

async function notion(path, opts = {}) {
  const r = await fetch(`https://api.notion.com${path}`, {
    method: opts.method || 'GET',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const data = await r.json();
  if (data.object === 'error') throw new Error(`${data.status} ${data.code}: ${data.message}`);
  return data;
}

async function main() {
  if (!NOTION_TOKEN) { console.error('❌ NOTION_TOKEN manquant. Fais: set NOTION_TOKEN=ton_token'); process.exit(1); }

  // 1. Trouver le parent : on récupère la DB Recettes et on lit son parent (page).
  process.stdout.write('🔍 Recherche du parent (via DB Recettes)... ');
  const recettesDb = await notion(`/v1/databases/${DB_RECETTES}`);
  const parent = recettesDb.parent;
  let parentPayload;

  if (parent?.type === 'page_id') {
    parentPayload = { type: 'page_id', page_id: parent.page_id };
    console.log('✓ page', parent.page_id);
  } else if (parent?.type === 'workspace') {
    console.error('\n❌ La DB Recettes est à la racine du workspace. L\'API ne peut pas créer une DB à la racine.');
    console.error('   Crée manuellement une page Notion (ex: "Meal Planner"), déplace-y la DB Recettes, puis relance.');
    process.exit(1);
  } else {
    console.error('\n❌ Parent inattendu:', JSON.stringify(parent));
    process.exit(1);
  }

  // 2. Créer la DB Frigo.
  process.stdout.write('🧊 Création de la base "Frigo"... ');
  const db = await notion('/v1/databases', {
    method: 'POST',
    body: {
      parent: parentPayload,
      title: [{ type: 'text', text: { content: 'Frigo' } }],
      properties: {
        'Article':            { title: {} },
        'Protéine':           { select: { options: [
          { name: 'Viande',  color: 'red' },
          { name: 'Poisson', color: 'blue' },
          { name: 'Volaille', color: 'yellow' },
          { name: 'Autre',   color: 'gray' },
        ] } },
        'Forme':              { select: { options: [
          { name: 'Filet',    color: 'default' },
          { name: 'Cuisses',  color: 'default' },
          { name: 'Pavé',     color: 'default' },
          { name: 'Steak',    color: 'default' },
          { name: 'Entier',   color: 'default' },
          { name: 'Haché',    color: 'default' },
          { name: 'Tranches', color: 'default' },
          { name: 'Autre',    color: 'default' },
        ] } },
        'Date de péremption': { date: {} },
        'Quantité':           { rich_text: {} },
        'Ajouté le':          { date: {} },
        'Consommé':           { checkbox: {} },
      },
    },
  });

  console.log('✓');
  console.log('\n✅ Base "Frigo" créée avec succès !');
  console.log('\n════════════════════════════════════════');
  console.log('  DB_FRIGO ID :', db.id);
  console.log('════════════════════════════════════════');
  console.log('\n👉 Copie cet ID et colle-le dans le chat, je câble la feature.');
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
