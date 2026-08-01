// scripts/audit-fix-truncated-ingredients.js
//
// Objectif : la regex d'extraction du nom d'ingrédient (parseIngredients / buildIngredients)
// avait un bug qui pouvait bouffer le début d'un nom d'ingrédient quand celui-ci commençait
// par la même lettre qu'une unité (ex: "gousse" -> "ousse" car "g" était pris pour l'unité
// grammes, "laitue" -> "aitue" car "l" pris pour litre, "gingembre" -> "ingembre").
// Ce bug a été corrigé dans src/App.jsx (ajout d'une garde \b après le groupe unité).
//
// Ce script audite la base Notion "Courses" (DB_COURSES) pour retrouver les entrées
// "Article" qui ont été créées AVANT le fix et qui sont donc tronquées, en les recoupant
// avec les ingrédients de la recette source (champ "Recette" -> DB_RECETTES.Ingrédients).
//
// Usage :
//   node scripts/audit-fix-truncated-ingredients.js            # dry-run, affiche le rapport
//   node scripts/audit-fix-truncated-ingredients.js --apply    # applique les corrections dans Notion
//
// Nécessite la variable d'environnement NOTION_TOKEN, ex:
//   NOTION_TOKEN=ntn_xxx node scripts/audit-fix-truncated-ingredients.js

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_RECETTES = "39c7b0f8-bf02-4893-bc05-6d82b8c38617";
const DB_COURSES = "35f5b3b5-095f-4998-a014-9a112807e711";
const APPLY = process.argv.includes("--apply");

if (!NOTION_TOKEN) {
  console.error("Erreur: variable d'environnement NOTION_TOKEN manquante.");
  console.error("Usage: NOTION_TOKEN=ntn_xxx node scripts/audit-fix-truncated-ingredients.js [--apply]");
  process.exit(1);
}

const HEADERS = {
  "Authorization": `Bearer ${NOTION_TOKEN}`,
  "Content-Type": "application/json",
  "Notion-Version": "2022-06-28",
};

// ── Portage EXACT de la regex corrigée dans src/App.jsx (parseIngredients) ──────
function parseIngredients(text) {
  if (!text) return [];
  return text.split(/\n|,(?=\s*\d|\s*[A-ZÀ-Ö])/g)
    .map(s => s.trim()).filter(Boolean)
    .map(line => {
      const match = line.match(/^([\d.,\/]+)\s*(?:(g|kg|ml|cl|l|dl|c\.?à\.?s\.?|c\.?à\.?c\.?|tasse|cuillère[s]?|tbsp|tsp|cup|oz|lb|pincée[s]?)(?=\s|,|$))?\s*(.+)/i);
      if (match) {
        const qty = parseFloat(match[1].replace(",", "."));
        return { original: line, qty, unit: match[2] || "", name: match[3].trim(), scalable: !isNaN(qty) };
      }
      return { original: line, qty: null, unit: "", name: line, scalable: false };
    });
}

function normalize(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

async function queryAll(dbId) {
  let results = [];
  let cursor = undefined;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Notion query failed: ${JSON.stringify(data)}`);
    results = results.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

function getTitle(prop) {
  return (prop?.title || []).map(t => t.plain_text).join("").trim();
}
function getText(prop) {
  return (prop?.rich_text || []).map(t => t.plain_text).join("").trim();
}

// Préfixes typiques de troncature (unité happée en tête de mot)
const RISKY_PREFIXES = ["g", "l", "kg", "ml", "cl", "dl", "oz", "lb"];

async function main() {
  console.log(APPLY ? "MODE: APPLY (écriture dans Notion)" : "MODE: DRY-RUN (aucune écriture, rapport seulement)");
  console.log("Chargement DB Recettes...");
  const recettesPages = await queryAll(DB_RECETTES);
  const recettesByNom = new Map();
  for (const page of recettesPages) {
    const p = page.properties;
    const nom = getTitle(p["Nom"]);
    const ingredients = getText(p["Ingrédients"]);
    if (nom) recettesByNom.set(normalize(nom), ingredients);
  }
  console.log(`${recettesByNom.size} recettes chargées.`);

  console.log("Chargement DB Courses...");
  const coursesPages = await queryAll(DB_COURSES);
  console.log(`${coursesPages.length} articles courses chargés.`);

  const suspects = [];

  for (const page of coursesPages) {
    const p = page.properties;
    const article = getTitle(p["Article"]);
    const recetteField = getText(p["Recette"]);
    if (!article || !recetteField) continue;

    // Une entrée Courses peut référencer plusieurs recettes ("Recette A, Recette B")
    const recetteNoms = recetteField.split(",").map(s => s.trim()).filter(Boolean);
    let bestMatch = null;

    for (const recetteNom of recetteNoms) {
      const ingredientsText = recettesByNom.get(normalize(recetteNom));
      if (!ingredientsText) continue;
      const parsed = parseIngredients(ingredientsText);
      for (const ing of parsed) {
        const correctNorm = normalize(ing.name);
        const articleNorm = normalize(article);
        if (correctNorm === articleNorm) { bestMatch = null; break; } // déjà correct, rien à faire
        // Le nom stocké est-il un suffixe du "bon" nom, avec un préfixe manquant plausible ?
        if (correctNorm.endsWith(articleNorm) && correctNorm.length > articleNorm.length) {
          const missingPrefix = correctNorm.slice(0, correctNorm.length - articleNorm.length);
          if (RISKY_PREFIXES.includes(missingPrefix)) {
            bestMatch = { correctName: ing.name, recette: recetteNom, missingPrefix };
          }
        }
      }
      if (bestMatch === null && recetteNoms.length === 1) break; // nom confirmé correct
    }

    if (bestMatch) {
      suspects.push({ pageId: page.id, article, ...bestMatch });
    }
  }

  console.log(`\n${suspects.length} article(s) suspect(s) (probablement tronqués) :\n`);
  for (const s of suspects) {
    console.log(`  "${s.article}"  ->  "${s.correctName}"   (préfixe manquant: "${s.missingPrefix}", recette: ${s.recette})`);
  }

  if (!suspects.length) {
    console.log("Rien à corriger. ✓");
    return;
  }

  if (!APPLY) {
    console.log("\nRelance avec --apply pour appliquer ces corrections dans Notion.");
    return;
  }

  console.log("\nApplication des corrections...");
  let fixed = 0;
  for (const s of suspects) {
    try {
      const res = await fetch(`https://api.notion.com/v1/pages/${s.pageId}`, {
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({
          properties: {
            "Article": { title: [{ text: { content: s.correctName } }] },
          },
        }),
      });
      if (!res.ok) {
        console.error(`  ✗ Échec pour "${s.article}":`, await res.text());
      } else {
        fixed++;
        console.log(`  ✓ "${s.article}" -> "${s.correctName}"`);
      }
    } catch (e) {
      console.error(`  ✗ Erreur pour "${s.article}":`, e.message);
    }
  }
  console.log(`\n${fixed}/${suspects.length} article(s) corrigé(s).`);
}

main().catch(e => { console.error(e); process.exit(1); });
