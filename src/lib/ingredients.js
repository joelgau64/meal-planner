
// ── Ingredient parsing ────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
// MODULE INGRÉDIENTS PARTAGÉ — un seul parser + normalisation, utilisé partout.
// Évite la divergence entre le parser de la fiche recette et celui des courses.
// ══════════════════════════════════════════════════════════════════════════════

// Familles d'unités pour la conversion (on ne convertit JAMAIS entre familles).
// Valeur = facteur vers l'unité de base de la famille.
export const UNIT_FAMILIES={
  masse:{base:"g",units:{mg:0.001,g:1,kg:1000}},
  volume:{base:"ml",units:{ml:1,cl:10,dl:100,l:1000}},
  cuillere:{base:"càc",units:{"càc":1,"c.à.c":1,"c.à.c.":1,"càs":3,"c.à.s":3,"c.à.s.":3}}, // 1 càs = 3 càc
};
// Normalise une unité écrite en sa forme canonique (ou "" si inconnue/comptage).
export function canonUnit(u){
  if(!u)return"";
  const x=u.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\./g,"").replace(/\s/g,"");
  const map={g:"g",kg:"kg",mg:"mg",ml:"ml",cl:"cl",dl:"dl",l:"l",
    cas:"càs",cac:"càc",casoupe:"càs",cacafe:"càc",
    cuillere:"càs",cuilleres:"càs",
    tbsp:"càs",tsp:"càc",cup:"tasse",tasse:"tasse",tasses:"tasse",
    cm:"cm",mm:"mm",oz:"oz",lb:"lb",pincee:"pincée",pincees:"pincée",piece:"pièces",pieces:"pièces",
    // Contenants / unités de comptage : traités comme unités pour ne plus polluer le nom.
    boite:"boîte",boites:"boîte",bouquet:"bouquet",bouquets:"bouquet",botte:"botte",bottes:"botte",
    sachet:"sachet",sachets:"sachet",pot:"pot",pots:"pot",brique:"brique",briques:"brique",
    barquette:"barquette",barquettes:"barquette",paquet:"paquet",paquets:"paquet",
    tete:"tête",tetes:"tête",brin:"brin",brins:"brin",branche:"branche",branches:"branche",
    poignee:"poignée",poignees:"poignée",feuille:"feuille",feuilles:"feuille",
    gousse:"gousse",gousses:"gousse",tranche:"tranche",tranches:"tranche",
    bocal:"bocal",bocaux:"bocal",conserve:"boîte",conserves:"boîte",verre:"verre",verres:"verre"};
  return map[x]||u;
}
export function unitFamily(canon){
  for(const[fam,def]of Object.entries(UNIT_FAMILIES)){
    if(canon in def.units)return fam;
  }
  return null;
}

// ── Nombres ──────────────────────────────────────────────────────────────────
const UNI_FRAC={"½":0.5,"¼":0.25,"¾":0.75,"⅓":1/3,"⅔":2/3};
export function normalizeFractions(s){
  return String(s||"")
    .replace(/(\d+)?\s*([½¼¾⅓⅔])/g,(m,d,f)=>String((Number(d)||0)+UNI_FRAC[f]))
    .replace(/(\d+)\s+(\d+)\/(\d+)/g,(m,a,b,c)=>String(Number(a)+Number(b)/Number(c)));
}
/** "1,5" → 1.5 ; "1/2" → 0.5 ; sinon NaN. */
export function parseNum(str){
  const x=String(str||"").trim().replace(",",".");
  const f=x.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if(f)return Number(f[1])/Number(f[2]);
  return /^\d+(\.\d+)?$|^\.\d+$/.test(x)?Number(x):NaN;
}

// Parser canonique unique. Retourne {original, qty(number|null), unit(canon), name, scalable}.
// Gère deux ordres : "200g de quinoa" (quantité d'abord, cas standard) ET
// "quinoa 100 g" / "aubergine 1 (grosse)" (nom d'abord, cas produit par certaines
// extractions IA) — sinon ces lignes ne scalent jamais quand on change les portions.
export function parseOneIngredient(line){
  let trimmed=(line||"").replace(/^[-•*]+\s*/,"").replace(/[’`]/g,"'").trim();
  // "Le jus d'un citron" / "zeste de 2 citrons" → on achète des citrons.
  trimmed=trimmed.replace(/^(?:le |la |les |du )?(?:jus|zestes?)\s+(?:d'(un|une)\s+|de\s+|du\s+|d')/i,(m,un)=>un?"1 ":"");
  // Fractions : "½" → "0.5", "1½" → "1.5", "1 1/2" → "1.5" (avant : "1/2 oignon" était lu 1)
  trimmed=normalizeFractions(trimmed);
  // "un oignon" → "1 oignon" (sinon la quantité est perdue)
  trimmed=trimmed.replace(/^(un|une)\s+/i,"1 ");
  if(!trimmed)return{original:line,qty:null,unit:"",name:trimmed,scalable:false};
  const UNIT_ALT="kg|mg|ml|cl|dl|l|cm|mm|c\\.?\\s*à\\.?\\s*s\\.?|c\\.?\\s*à\\.?\\s*c\\.?|c\\.?\\s*à\\.?\\s*(?:soupe|café)|càs|càc|tasse|cuillères?|tbsp|tsp|cup|oz|lb|pincées?|pièces?|feuilles?|gousses?|tranches?|bo[iî]tes?|bouquets?|bottes?|sachets?|pots?|briques?|barquettes?|paquets?|t[eê]tes?|brins?|branches?|poignées?|bocal|bocaux|conserves?|verres?|g";
  // Cas 1 : quantité au début de la ligne.
  const m=trimmed.match(new RegExp(`^([\\d.,/]+)\\s*(${UNIT_ALT})?(?=[\\s,]|$)\\s*(?:de |d'|du |des )?(.+)`,"i"));
  if(m){
    const qty=parseNum(m[1]);
    const name=(m[3]||trimmed).trim().replace(/^(de |d'|du |des )(?=[a-zA-ZÀ-ÿ])/i,"").trim();
    return{original:trimmed,qty:isNaN(qty)?null:qty,unit:canonUnit(m[2]||""),name,scalable:!isNaN(qty)};
  }
  // Cas 2 : quantité à la fin de la ligne, ex. "quinoa 100 g", "aubergine 1 (grosse)".
  const m2=trimmed.match(new RegExp(`^(.+?)\\s+([\\d.,/]+)\\s*(${UNIT_ALT})?\\s*(\\([^)]*\\))?$`,"i"));
  if(m2){
    const qty=parseNum(m2[2]);
    if(!isNaN(qty)){
      const name=(m2[1].trim()+(m2[4]?" "+m2[4]:"")).trim();
      return{original:trimmed,qty,unit:canonUnit(m2[3]||""),name,scalable:true};
    }
  }
  return{original:trimmed,qty:null,unit:"",name:trimmed,scalable:false};
}

// Découpe un texte d'ingrédients en lignes (gère lignes ET blocs virgulés).
export function splitIngredientLines(text){
  if(!text)return[];
  let lines=text.split("\n").map(l=>l.trim()).filter(Boolean);
  if(lines.length<=1&&(text.match(/,/g)||[]).length>=2){
    lines=text.split(/,(?![^(]*\))/).map(l=>l.trim()).filter(Boolean);
  }
  return lines;
}

// Clé de normalisation pour DÉCIDER des fusions (jamais pour réécrire l'affichage).
// Conservateur : minuscule + sans accents + singulier simple. Ne fusionne PAS les synonymes.
export function normalizeKey(name){
  return(name||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g," ").trim().replace(/s\b/g,""); // pluriels simples
}

// Combine deux quantités {qty,unit}. Convertit dans la même famille, sinon garde en summands.
// Retourne une string d'affichage.
export function combineQuantities(a,b){
  // a,b = {qty:number|null, unit:canon, raw:string}
  const fa=a.unit?unitFamily(a.unit):null, fb=b.unit?unitFamily(b.unit):null;
  if(a.qty!=null&&b.qty!=null&&fa&&fb&&fa===fb){
    const def=UNIT_FAMILIES[fa];
    const total=a.qty*def.units[a.unit]+b.qty*def.units[b.unit]; // en unité de base
    // choisir une unité lisible : si >= 1000 base pour masse/volume, monter d'un cran
    let unit=def.base, val=total;
    if(fa==="masse"&&total>=1000){unit="kg";val=total/1000;}
    else if(fa==="volume"&&total>=1000){unit="l";val=total/1000;}
    else if(fa==="volume"&&total>=100&&total%100===0){unit="cl";val=total/10;}
    else if(fa==="cuillere"){ // exprimer en càs si multiple de 3, sinon càc
      if(total%3===0){unit="càs";val=total/3;} else {unit="càc";val=total;}
    }
    val=Math.round(val*100)/100;
    return `${val} ${unit}`;
  }
  // même unité exacte sans famille (ex: "pièces", "gousses" comptées via nom) → somme si les deux ont qty et même unit
  if(a.qty!=null&&b.qty!=null&&a.unit===b.unit){
    const val=Math.round((a.qty+b.qty)*100)/100;
    return a.unit?`${val} ${a.unit}`:`${val}`;
  }
  // sinon : garder en summands lisibles
  const sa=(a.raw||"").trim(), sb=(b.raw||"").trim();
  if(sa&&sb&&sa!==sb)return `${sa} + ${sb}`;
  return sa||sb||"";
}

// ── Sacs de quantités ────────────────────────────────────────────────────────
// Remplace la concaténation de textes ("4 + 2 + 1/2 oignon émincé + …") par une
// somme par unité : les comptages s'additionnent, les unités d'une même famille
// se convertissent, les unités différentes restent séparées : "4,5 · 7 gousses".
const PLURAL={"boîte":"boîtes","bouquet":"bouquets","botte":"bottes","sachet":"sachets","pot":"pots","brique":"briques",
  "barquette":"barquettes","paquet":"paquets","tête":"têtes","brin":"brins","branche":"branches","poignée":"poignées",
  "feuille":"feuilles","gousse":"gousses","tranche":"tranches","bocal":"bocaux","verre":"verres","pincée":"pincées","tasse":"tasses"};
const bagKey=unit=>{const fam=unit?unitFamily(unit):null;return fam?UNIT_FAMILIES[fam].base:(unit||"");};
/** Ajoute une quantité {qty,unit} au sac (objet clé→total). Ignore ce qui n'a pas de nombre. */
export function addToBag(bag,qty,unit){
  if(qty==null||isNaN(qty))return bag;
  const u=canonUnit(unit||"");
  const fam=u?unitFamily(u):null;
  const k=bagKey(u);
  bag[k]=(bag[k]||0)+(fam?qty*UNIT_FAMILIES[fam].units[u]:qty);
  return bag;
}
/** Texte de quantité existant ("2", "200 g", "1 gousse d'ail + 2 gousses", "1/2 oignon émincé") → sac. */
export function parseQtyText(str,bag={}){
  for(const part of normalizeFractions(str).split("+")){
    const m=part.trim().match(/^([\d.,/]+)\s*([^\d\s]+(?:\s*à\s*\S+)?)?/i);
    if(!m)continue;
    const q=parseNum(m[1]);if(isNaN(q))continue;
    // l'unité n'est retenue que si elle est connue ("oignon" n'est pas une unité)
    const raw=(m[2]||"").replace(/[,;.]$/,"");
    const cu=canonUnit(raw);
    const known=cu&&(unitFamily(cu)||Object.prototype.hasOwnProperty.call(PLURAL,cu)||cu==="pièces");
    addToBag(bag,q,known?cu:"");
  }
  return bag;
}
const fmtNum=v=>{
  const r=Math.round(v*100)/100, i=Math.floor(r), d=Math.round((r-i)*100)/100;
  const fr={0.5:"½",0.25:"¼",0.75:"¾"}[d];
  if(fr)return (i?String(i):"")+fr;
  return String(r).replace(".",",");
};
export function formatBag(bag){
  const parts=[];
  for(const [k,total] of Object.entries(bag||{})){
    if(!total)continue;
    let val=total,unit=k;
    if(k==="g"&&total>=1000){val=total/1000;unit="kg";}
    else if(k==="ml"){if(total>=1000){val=total/1000;unit="l";}else if(total%10===0){val=total/10;unit="cl";}}
    else if(k==="càc"&&total%3===0){val=total/3;unit="càs";}
    if(PLURAL[unit]&&val>1)unit=PLURAL[unit];
    parts.push({k,txt:unit?`${fmtNum(val)} ${unit}`:fmtNum(val)});
  }
  // comptage simple d'abord, puis le reste
  parts.sort((a,b)=>(a.k===""?0:1)-(b.k===""?0:1));
  return parts.map(p=>p.txt).join(" · ");
}

export function parseIngredients(text){
  // Wrapper léger sur le module partagé (un seul parser dans toute l'app).
  return splitIngredientLines(text).map(parseOneIngredient);
}

export function scaleIngredients(ingredients,basePortion,newPortion){
  if(!basePortion||basePortion===newPortion)return ingredients;
  const ratio=newPortion/basePortion;
  return ingredients.map(ing=>{
    if(!ing.scalable)return ing;
    const newQty=ing.qty*ratio;
    const rounded=Math.round(newQty*10)/10;
    const qtyStr=rounded%1===0?String(rounded):String(rounded);
    return{...ing,displayQty:qtyStr};
  });
}

// Catégorie par défaut : implémentation dans le module dictionnaire (frontières de mots).
export { guessCategory } from "./dictionnaire";
