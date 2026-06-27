// Script: détecte et supprime les doublons dans DB Recettes
// Usage: node scripts/dedup-recettes.js [--dry-run]
// --dry-run : affiche les doublons sans supprimer

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';
const DRY_RUN = process.argv.includes('--dry-run');

async function getAllRecettes() {
  const all = [];
  let cursor;
  do {
    const body = { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) };
    const res = await fetch(`https://api.notion.com/v1/databases/${DB_RECETTES}/query`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    all.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return all;
}

async function archivePage(id) {
  await fetch(`https://api.notion.com/v1/pages/${id}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${NOTION_TOKEN}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    body: JSON.stringify({ archived: true })
  });
}

async function main() {
  if (!NOTION_TOKEN) { console.error('NOTION_TOKEN manquant'); process.exit(1); }

  console.log('🔍 Chargement de toutes les recettes...');
  const recettes = await getAllRecettes();
  console.log(`📋 ${recettes.length} recettes trouvées\n`);

  // Grouper par nom normalisé (minuscules, sans accents, sans espaces multiples)
  const normalize = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

  const groups = {};
  for (const page of recettes) {
    const nom = page.properties?.['Nom']?.title?.[0]?.plain_text || '';
    if (!nom) continue;
    const key = normalize(nom);
    if (!groups[key]) groups[key] = [];
    groups[key].push({ id: page.id, nom, created: page.created_time });
  }

  // Trouver les groupes avec doublons
  const duplicates = Object.entries(groups).filter(([, pages]) => pages.length > 1);
  
  if (duplicates.length === 0) {
    console.log('✅ Aucun doublon trouvé !');
    return;
  }

  console.log(`⚠️  ${duplicates.length} groupe(s) de doublons trouvés :\n`);
  let totalDeleted = 0;

  for (const [key, pages] of duplicates) {
    // Garder le plus ancien (premier créé)
    const sorted = pages.sort((a, b) => new Date(a.created) - new Date(b.created));
    const toKeep = sorted[0];
    const toDelete = sorted.slice(1);

    console.log(`📌 "${toKeep.nom}" — ${pages.length} exemplaires`);
    console.log(`   ✓ Garder : ${toKeep.id} (${toKeep.created.substring(0, 10)})`);
    
    for (const dup of toDelete) {
      console.log(`   🗑  Supprimer : ${dup.id} (${dup.created.substring(0, 10)})`);
      if (!DRY_RUN) {
        await archivePage(dup.id);
        await new Promise(r => setTimeout(r, 300));
        totalDeleted++;
      }
    }
    console.log('');
  }

  if (DRY_RUN) {
    console.log(`\n🔍 Mode dry-run — rien n'a été supprimé.`);
    console.log(`   Relance sans --dry-run pour supprimer les doublons.`);
  } else {
    console.log(`\n✅ ${totalDeleted} doublon(s) supprimé(s) !`);
  }
}

main().catch(console.error);
