// ══════════════════════════════════════════════════════════════════════════════
// DICTIONNAIRE D'INGRÉDIENTS — normalisation stable des articles de courses.
//
// 1. Nettoyage déterministe : on retire du nom tout ce qui n'est pas un article
//    d'achat (préparation, contenant, parenthèses, articles).
//      "courgettes râpées" → "Courgettes"    "ail hachées" → "Ail"
// 2. Résolution via la base Notion « Ingrédients » (nom canonique + alias +
//    catégorie + garde-manger). Ce qui n'y est pas est marqué « nouveau » et
//    s'apprend en un tap depuis la modale de courses.
//
// Lookup en 3 temps, du plus précis au plus large, pour que le dictionnaire
// puisse toujours l'emporter sur le nettoyage (« tomates pelées » ≠ « tomate ») :
//   (1) clé légère du nom   ∈ index léger (noms + alias tels quels)
//   (2) clé nettoyée du nom ∈ index léger
//   (3) clé nettoyée du nom ∈ index nettoyé
// ══════════════════════════════════════════════════════════════════════════════

export const deaccent=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/œ/g,"oe").replace(/æ/g,"ae");
// Singulier mot à mot (pluriels simples en -s, -aux/-eux/-oux en -x).
const singular=w=>w.length>3?w.replace(/(au|eu|ou)x$/,"$1").replace(/s$/,""):w;

// Mots de préparation / qualificatifs retirés (forme normalisée : sans accents, singulier).
const PREP=new Set(("rape rapee emince emincee hache hachee cisele ciselee coupe coupee tranche tranchee "+
  "pele pelee epepine epepinee ecrase ecrasee concasse concassee egoutte egouttee rince rincee cuit cuite "+
  "cru crue decortique decortiquee denoyaute denoyautee battu battue fondu fondue ramolli ramollie frai "+
  "fraiche fin fine moulu moulue finement grossierement environ bio entier entiere mur mure bien tiede "+
  "froid froide facultatif optionnel emiette emiettee presse pressee lave lavee epluche epluchee "+
  "detaille detaillee hachure taille taillee essore essoree reduit reduite").split(" "));
// Expressions retirées n'importe où (forme normalisée, tokens séparés).
const PHRASES=["en de","en rondelle","en lamelle","en morceau","en cube","en julienne","en tranche",
  "en quartier","en brunoise","en fine lamelle","du moulin","au gout","selon gout","a temperature ambiante",
  "pour la cuisson","pour servir","pour la decoration","pour le service","pour la friture","pour le moule",
  "de bonne qualite","de saison","a votre gout","plus ou moins","a peu pre"].map(p=>p.split(" "));
// Tailles : retirées de la clé mais conservées à l'affichage → "Poireaux (gros)".
const SIZES=new Set(["gro","grosse","petit","petite","moyen","moyenne","beau","belle","grand","grande","mini","enorme"]);
const LEADING=new Set(["le","la","les","l'","un","une","du","de","des","d'","quelque","peu"]);
const TRAILING=new Set(["de","d'","du","des","en","a","au","aux","pour","et","ou","l'","le","la","les"]);

function tokenize(s){
  const t=String(s||"").replace(/[’`]/g,"'")
    .replace(/\(\s*(gros|grosses?|petite?s?|moyen(ne)?s?|grande?s?|belles?|beaux?)\s*\)/gi," $1 ") // "(grosse)" → taille
    .replace(/\([^)]*\)/g," ").replace(/[;:!?.,/]/g," ")
    .replace(/\b([dlDL])'\s*/g,"$1' ");
  return t.split(/\s+/).filter(Boolean).map(o=>({o,n:singular(deaccent(o.toLowerCase()))}));
}
function stripPhrases(toks){
  let out=toks;
  for(const ph of PHRASES){
    const res=[];
    for(let i=0;i<out.length;){
      if(ph.every((w,j)=>out[i+j]?.n===w)){i+=ph.length;continue;}
      res.push(out[i]);i++;
    }
    out=res;
  }
  return out;
}
function cleanTokens(toks,sizes=[]){
  let out=stripPhrases(toks).filter(t=>!PREP.has(t.n));
  out=out.filter(t=>{if(SIZES.has(t.n)){sizes.push(t.o.toLowerCase());return false;}return true;});
  while(out.length&&LEADING.has(out[0].n))out=out.slice(1);
  while(out.length&&TRAILING.has(out[out.length-1].n))out=out.slice(0,-1);
  return out;
}
const keyOf=toks=>toks.map(t=>t.n).join(" ");
const displayOf=toks=>{
  const s=toks.map(t=>t.o).join(" ").replace(/\b([dlDL]') /g,"$1").trim();
  return s?s.charAt(0).toUpperCase()+s.slice(1):"";
};

/** Clé légère : minuscules, sans accents ni parenthèses, singulier. Rien d'autre. */
export const lightKey=name=>keyOf(tokenize(name));
/** Nettoyage complet. Renvoie {display, key, qualif} ; key vide = rien d'achetable (ex. "émincé"). */
export function cleanName(name){
  const sizes=[];
  const toks=cleanTokens(tokenize(name),sizes);
  return{display:displayOf(toks),key:keyOf(toks),qualif:[...new Set(sizes)].join(", ")};
}
/** Nom affiché = nom de base + qualificatif de taille éventuel. */
export const withQualif=(base,qualif)=>qualif?`${base} (${qualif})`:base;

/**
 * Éclate une ligne d'ingrédient composée en plusieurs lignes.
 * Sans quantité en tête : "Sel et poivre", "Sel, poivre" → ["Sel","poivre"].
 * Avec quantité : on ne découpe pas, on coupe juste une précision après virgule
 * ("1 oignon, émincé" → "1 oignon").
 */
export function expandCompound(line){
  const l=String(line||"").replace(/^[-•*]+\s*/,"").trim();
  if(!l)return[];
  // Découpe hors parenthèses
  const outsideParens=re=>{const parts=[];let depth=0,cur="";
    for(let i=0;i<l.length;i++){const c=l[i];if(c==="(")depth++;if(c===")")depth=Math.max(0,depth-1);
      if(depth===0){const m=l.slice(i).match(re);if(m&&m.index===0){parts.push(cur);cur="";i+=m[0].length-1;continue;}}
      cur+=c;}
    parts.push(cur);return parts.map(p=>p.trim()).filter(Boolean);};
  if(/^[\d½¼¾]/.test(l))return[outsideParens(/^\s*,\s*/)[0]];
  return outsideParens(/^(\s*,\s*|\s+et\s+|\s*&\s*|\s+\+\s+)/);
}

// ── Base Notion « Ingrédients » ───────────────────────────────────────────────
/** Les alias sont stockés lisibles, séparés par « | » ; on les normalise au chargement. */
export const splitAliases=s=>String(s||"").split("|").map(a=>a.trim()).filter(Boolean);

export function buildIndex(dict){
  const light=new Map(),full=new Map();
  for(const e of dict||[]){
    for(const v of [e.nom,...splitAliases(e.alias)]){
      const lk=lightKey(v);if(lk&&!light.has(lk))light.set(lk,e);
    }
  }
  for(const e of dict||[]){
    for(const v of [e.nom,...splitAliases(e.alias)]){
      const fk=cleanName(v).key;if(fk&&!full.has(fk))full.set(fk,e);
    }
  }
  return{light,full};
}

/**
 * Résout un nom brut issu du parseur.
 * → {key, nom, categorie, gardeManger, isNew, entry, raw} ou null si rien d'achetable.
 */
export function resolveIngredient(rawName,index){
  const lk=lightKey(rawName);
  const {display,key,qualif}=cleanName(rawName);
  if(!key)return null;
  // Correspondance exacte (ex. alias "gros sel", "petits pois") : la taille fait partie du nom.
  const exact=index?.light.get(lk);
  if(exact)return{key:"id:"+exact.id,nomBase:exact.nom,qualif:"",nom:exact.nom,categorie:exact.categorie||guessCategory(key),gardeManger:!!exact.gardeManger,isNew:false,entry:exact,raw:rawName};
  const entry=index?.light.get(key)||index?.full.get(key)||null;
  if(entry)return{key:"id:"+entry.id,nomBase:entry.nom,qualif,nom:withQualif(entry.nom,qualif),categorie:entry.categorie||guessCategory(key),gardeManger:!!entry.gardeManger,isNew:false,entry,raw:rawName};
  return{key:"k:"+key,nomBase:display,qualif,nom:withQualif(display,qualif),categorie:guessCategory(key),gardeManger:false,isNew:true,entry:null,raw:rawName};
}

// ── Catégorie par défaut (pour les articles inconnus du dictionnaire) ────────
// Travaille sur une forme normalisée et des frontières de mots (plus de « volaille » → ail).
export function guessCategory(name){
  const n=" "+deaccent(String(name||"").toLowerCase())+" ";
  const has=re=>re.test(n);
  if(has(/\blait de coco\b|\bcreme de coco\b|\bvinaigre\b|\bbouillon\b/))return"Épicerie";
  if(has(/\bsurgele|\bcongele/))return"Surgelés";
  if(has(/\b(poulet|boeuf|porc|veau|agneau|canard|dinde|volaille|saumon|thon|cabillaud|crevettes?|merlu|bar|truite|lieu|colin|maquereau|sardines?|moules?|jambon|bacon|lardons?|viande|poisson|chorizo|saucisses?|steak|escalopes?|filets? de (poulet|poisson|saumon|cabillaud))\b/))return"Viandes & Poissons";
  if(has(/\b(lait|creme|beurre|fromage|yaourts?|parmesan|mozzarella|feta|ricotta|gruyere|emmental|comte|chevre|mascarpone|oeufs?|skyr|faisselle)\b/))return"Produits laitiers";
  if(has(/\b(tomates?|carottes?|oignons?|echalotes?|ail|courgettes?|aubergines?|poivrons?|epinards?|salade|laitue|roquette|brocolis?|poireaux?|champignons?|pommes? de terre|patates?|fenouil|celeri|haricots? verts?|concombres?|avocats?|citrons?|citrons? verts?|oranges?|pommes?|poires?|bananes?|fraises?|framboises?|courges?|potirons?|butternut|chou|choux|navets?|radis|betteraves?|persil|coriandre|basilic|ciboulette|menthe|aneth|estragon frais|gingembre frais|citronnelle|mangues?|ananas|raisins?|peches?|abricots?|kiwis?|melons?|pasteques?|petits? pois|edamame|patates? douces?)\b/))return"Fruits & Légumes";
  if(has(/\b(eau|vin|biere|jus|cidre|soda)\b/))return"Boissons";
  return"Épicerie";
}
