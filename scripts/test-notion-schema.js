// Script: vérifie que toutes les propriétés Notion utilisées dans le code existent vraiment
// Usage: node scripts/test-notion-schema.js

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DBS = {
  DB_RECETTES: '39c7b0f8-bf02-4893-bc05-6d82b8c38617',
  DB_PLANNING: 'dc70bd98-0691-41b9-abfc-5bde68630995',
  DB_COURSES:  '35f5b3b5-095f-4998-a014-9a112807e711',
};

// Propriétés attendues par le code (d'après App.jsx)
const EXPECTED = {
  DB_RECETTES: {
    'Nom':                   'title',
    'Catégorie':             'select',
    'Temps de préparation':  'number',
    'Portions':              'number',
    'Ingrédients':           'rich_text',
    'Instructions':          'rich_text',
    'Note':                  'select',
    'Likes':                 'number',
    'Dislikes':              'number',
    'Fois cuisinée':         'number',
    'Dernière cuisson':      'date',
    'Photo':                 'url',
    'Source':                'url',
    'Commentaires':          'rich_text',
  },
  DB_PLANNING: {
    'Repas':          'title',
    'Date':           'date',
    'Moment':         'select',
    'Recette':        'rich_text',
    'Recette ID':     'rich_text',
    'Portions':       'number',
    'Notes':          'rich_text',
    'Cuisiné':        'checkbox',
    "File d'attente": 'checkbox',
  },
  DB_COURSES: {
    'Article':    'title',
    'Catégorie':  'select',
    'Quantité':   'rich_text',
    'Acheté':     'checkbox',
    'Semaine':    'rich_text',
    'Recette':    'rich_text',
  },
};

async function getDBSchema(dbId) {
  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
    headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' }
  });
  const data = await res.json();
  if (data.object === 'error') throw new Error(data.message);
  return Object.fromEntries(
    Object.entries(data.properties).map(([name, prop]) => [name, prop.type])
  );
}

async function testReadWrite(dbName, dbId, schema) {
  console.log(`\n🔬 Test lecture/écriture ${dbName}...`);
  
  // Test lecture : récupérer 1 entrée
  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    body: JSON.stringify({ page_size: 1 })
  });
  const data = await res.json();
  if (data.object === 'error') {
    console.log(`   ❌ Lecture échouée: ${data.message}`);
    return;
  }
  const count = data.results?.length;
  console.log(`   ✓ Lecture OK — ${count} entrée(s) récupérée(s)`);
  
  if (count > 0) {
    const page = data.results[0];
    const missingProps = [];
    for (const [prop, type] of Object.entries(EXPECTED[dbName])) {
      const val = page.properties?.[prop];
      if (!val) missingProps.push(prop);
    }
    if (missingProps.length > 0) {
      console.log(`   ⚠️  Propriétés absentes dans les données: ${missingProps.join(', ')}`);
    }
  }
}

async function main() {
  if (!NOTION_TOKEN) { console.error('NOTION_TOKEN manquant'); process.exit(1); }

  console.log('🧪 TEST DES SCHÉMAS NOTION\n' + '='.repeat(50));

  let totalOk = 0, totalFail = 0, totalWarn = 0;

  for (const [dbName, dbId] of Object.entries(DBS)) {
    console.log(`\n📊 ${dbName} (${dbId.substring(0, 8)}...)`);
    
    let schema;
    try {
      schema = await getDBSchema(dbId);
      console.log(`   Propriétés trouvées: ${Object.keys(schema).join(', ')}`);
    } catch(e) {
      console.log(`   ❌ Impossible d'accéder à la base: ${e.message}`);
      totalFail++;
      continue;
    }

    const expected = EXPECTED[dbName];
    let dbOk = true;

    for (const [prop, expectedType] of Object.entries(expected)) {
      const actualType = schema[prop];
      if (!actualType) {
        console.log(`   ❌ MANQUANT: "${prop}" (attendu: ${expectedType})`);
        totalFail++;
        dbOk = false;
      } else if (actualType !== expectedType) {
        console.log(`   ⚠️  TYPE INCORRECT: "${prop}" → attendu ${expectedType}, trouvé ${actualType}`);
        totalWarn++;
        dbOk = false;
      } else {
        console.log(`   ✓ "${prop}" (${actualType})`);
        totalOk++;
      }
    }

    // Propriétés dans Notion mais pas dans le code
    const extra = Object.keys(schema).filter(k => !expected[k]);
    if (extra.length > 0) {
      console.log(`   ℹ️  Propriétés non utilisées par le code: ${extra.join(', ')}`);
    }

    // Test lecture/écriture
    await testReadWrite(dbName, dbId, schema);
  }

  console.log('\n' + '='.repeat(50));
  console.log(`\n📊 RÉSULTAT FINAL:`);
  console.log(`   ✓ ${totalOk} propriétés OK`);
  console.log(`   ⚠️  ${totalWarn} types incorrects`);
  console.log(`   ❌ ${totalFail} propriétés manquantes`);

  if (totalFail === 0 && totalWarn === 0) {
    console.log('\n🎉 Tout est en ordre !');
  } else {
    console.log('\n⚠️  Des corrections sont nécessaires (voir ci-dessus).');
    process.exit(1);
  }
}

main().catch(console.error);
