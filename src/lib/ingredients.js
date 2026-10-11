
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
  const x=u.toLowerCase().replace(/\./g,"").replace(/\s/g,"");
  const map={g:"g",kg:"kg",mg:"mg",ml:"ml",cl:"cl",dl:"dl",l:"l",
    cas:"càs","càs":"càs",cac:"càc","càc":"càc","càsoupe":"càs","càcafé":"càc",
    cuillere:"càs",cuilleres:"càs","cuillère":"càs","cuillères":"càs",
    tbsp:"càs",tsp:"càc",cup:"tasse",tasse:"tasse",
    cm:"cm",mm:"mm",oz:"oz",lb:"lb",pincee:"pincée","pincée":"pincée",pincees:"pincée","pincées":"pincée",pieces:"pièces","pièces":"pièces","pièce":"pièces"};
  return map[x]||u;
}
export function unitFamily(canon){
  for(const[fam,def]of Object.entries(UNIT_FAMILIES)){
    if(canon in def.units)return fam;
  }
  return null;
}

// Parser canonique unique. Retourne {original, qty(number|null), unit(canon), name, scalable}.
// Gère deux ordres : "200g de quinoa" (quantité d'abord, cas standard) ET
// "quinoa 100 g" / "aubergine 1 (grosse)" (nom d'abord, cas produit par certaines
// extractions IA) — sinon ces lignes ne scalent jamais quand on change les portions.
export function parseOneIngredient(line){
  const trimmed=(line||"").replace(/^[-•*]+\s*/,"").trim();
  if(!trimmed)return{original:line,qty:null,unit:"",name:trimmed,scalable:false};
  const UNIT_ALT="kg|mg|ml|cl|dl|l|cm|mm|c\\.?\\s*à\\.?\\s*s\\.?|c\\.?\\s*à\\.?\\s*c\\.?|c\\.?\\s*à\\.?\\s*(?:soupe|café)|càs|càc|tasse|cuillères?|tbsp|tsp|cup|oz|lb|pincées?|pièces?|feuilles?|gousses?|tranches?|g";
  // Cas 1 : quantité au début de la ligne.
  const m=trimmed.match(new RegExp(`^([\\d.,/]+)\\s*(${UNIT_ALT})?(?=[\\s,]|$)\\s*(?:de |d'|du |des )?(.+)`,"i"));
  if(m){
    const qty=parseFloat(m[1].replace(",","."));
    const name=(m[3]||trimmed).trim().replace(/^(de |d'|du |des )(?=[a-zA-ZÀ-ÿ])/i,"").trim();
    return{original:trimmed,qty:isNaN(qty)?null:qty,unit:canonUnit(m[2]||""),name,scalable:!isNaN(qty)};
  }
  // Cas 2 : quantité à la fin de la ligne, ex. "quinoa 100 g", "aubergine 1 (grosse)".
  const m2=trimmed.match(new RegExp(`^(.+?)\\s+([\\d.,/]+)\\s*(${UNIT_ALT})?\\s*(\\([^)]*\\))?$`,"i"));
  if(m2){
    const qty=parseFloat(m2[2].replace(",","."));
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

export function guessCategory(name){
  const n=name.toLowerCase();
  if(/poulet|boeuf|porc|veau|agneau|saumon|thon|cabillaud|crevette|merlu|bar|truite|canard|jambon|bacon|lardons|viande|poisson/.test(n))return"Viandes & Poissons";
  if(/lait|crème|beurre|fromage|yaourt|parmesan|mozzarella|feta|ricotta|gruyère/.test(n))return"Produits laitiers";
  if(/tomate|carotte|oignon|ail|courgette|aubergine|poivron|épinard|salade|brocoli|poireau|champignon|pomme de terre|patate|fenouil|céleri|haricot|pois|lentille|quinoa|avocat|concombre|citron|orange/.test(n))return"Fruits & Légumes";
  if(/eau|vin|bière|jus|bouillon|lait de coco/.test(n))return"Boissons";
  if(/surgelé|congelé/.test(n))return"Surgelés";
  return"Épicerie";
}
