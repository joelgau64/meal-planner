import { useState, useEffect, useCallback, useRef, useMemo } from "react";

const DB_RECETTES = "39c7b0f8-bf02-4893-bc05-6d82b8c38617";
const DB_PLANNING = "dc70bd98-0691-41b9-abfc-5bde68630995";
const DB_COURSES = "35f5b3b5-095f-4998-a014-9a112807e711";
const DB_FRIGO = "3ba7bf2a-8f76-81bd-a878-dbf3ae8be0be";

const DAYS = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const MOMENTS = ["Petit-déjeuner","Déjeuner","Dîner"];
const MOMENT_COLORS = {"Déjeuner":"#C2622D","Dîner":"#475569"};
const CAT_COLORS = {"Fruits & Légumes":"#16A34A","Viandes & Poissons":"#DC2626","Produits laitiers":"#2563EB","Épicerie":"#EA580C","Surgelés":"#7C3AED","Boissons":"#0891B2","Autre":"#6B7280"};
const EMPTY_FORM = {nom:"",categorie:"Dîner",temps:"",portions:4,ingredients:"",instructions:"",tags:[],note:"***",photoUrl:"",sourceUrl:""};
const DEFAULT_PORTIONS = Number(localStorage.getItem("household_portions"))||4;
function setHouseholdPortions(n){localStorage.setItem("household_portions",String(n));}

// ── Cache ─────────────────────────────────────────────────────────────────────
const cache = {recettes:null,planning:null,courses:null};

// ── Error logging ─────────────────────────────────────────────────────────────
const errorLog = [];
function logError(context, error, details=null){
  const entry = {time:new Date().toLocaleTimeString('fr-FR'), context, message: error?.message||String(error), details};
  errorLog.push(entry);
  if(errorLog.length>50) errorLog.shift();
  console.error(`[${context}]`, error, details||'');
}
const cacheTime = {recettes:0,planning:0,courses:0};
const CACHE_TTL = 5*60*1000;
function getCached(k){return cache[k]&&Date.now()-cacheTime[k]<CACHE_TTL?cache[k]:null;}
function setCache(k,d){cache[k]=d;cacheTime[k]=Date.now();}

// ── Notion API ────────────────────────────────────────────────────────────────
async function notionQuery(dbId,filter,sorts){
  const all=[];
  let cursor=undefined;
  try{
    do{
      const body={page_size:100};
      if(filter)body.filter=filter;
      if(sorts)body.sorts=sorts;
      if(cursor)body.start_cursor=cursor;
      const res=await fetch(`/api/notion?path=/v1/databases/${dbId}/query`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const data=await res.json();
      if(data.object==="error") throw new Error(data.message);
      all.push(...(data.results||[]));
      cursor=data.has_more?data.next_cursor:undefined;
    }while(cursor);
  }catch(e){
    logError("notionQuery",e,{dbId});
    throw e;
  }
  return {results:all};
}
async function notionCreate(dbId,properties){
  // Déduplication : vérifier si un enregistrement avec le même titre existe déjà
  const titleProp=Object.values(properties).find(p=>p.title);
  const titleValue=titleProp?.title?.[0]?.text?.content;
  if(titleValue&&dbId===DB_RECETTES){
    const existing=await notionQuery(dbId,{property:"Nom",title:{equals:titleValue}});
    if(existing.results?.length>0){
      console.warn("[notionCreate] Doublon détecté, skip:", titleValue);
      return {object:"skip",existing:existing.results[0]};
    }
  }
  const res=await fetch(`/api/notion?path=/v1/pages`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({parent:{database_id:dbId},properties})});
  const data=await res.json();
  if(data.object==="error") logError("notionCreate",new Error(data.message),{dbId});
  return data;
}
async function notionUpdate(pageId,properties){
  const res=await fetch(`/api/notion?path=/v1/pages/${pageId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({properties})});
  const data=await res.json();
  if(data.object==="error") logError("notionUpdate",new Error(data.message),{pageId,props:Object.keys(properties)});
  return data;
}

// ── Notion helpers ────────────────────────────────────────────────────────────
const nText=s=>({rich_text:[{text:{content:String(s||"").slice(0,2000)}}]});
const nTitle=s=>({title:[{text:{content:String(s||"")}}]});
const nNum=n=>({number:Number(n)||0});
const nSel=s=>{
  if(!s)return{select:null};
  // Notion interdit les virgules dans les options de select.
  // Une virgule = souvent une description parasite renvoyée par la Vision :
  // on garde ce qui précède la 1re virgule, nettoyé et borné à 100 caractères.
  let v=String(s).split(",")[0].trim().slice(0,100);
  return v?{select:{name:v}}:{select:null};
};
const nDate=d=>d?{date:{start:d}}:{date:null};
const nCheck=b=>({checkbox:!!b});
const nUrl=u=>u?{url:u}:{url:null};

function getTitle(page){const t=page.properties;for(const k of Object.keys(t)){if(t[k].type==="title"&&t[k].title?.[0]?.plain_text)return t[k].title[0].plain_text;}return"";}
function getText(p){return p?.rich_text?.[0]?.plain_text||"";}
function getSelect(p){return p?.select?.name||"";}
function getNum(p){return p?.number||0;}
function getCheck(p){return p?.checkbox||false;}
function getDate(p){return p?.date?.start||null;}
function getUrl(p){return p?.url||null;}

function parseRecette(page){
  const p=page.properties;
  return{id:page.id,nom:getTitle(page),categorie:getSelect(p["Catégorie"]),temps:getNum(p["Temps de préparation"]),portions:getNum(p["Portions"])||DEFAULT_PORTIONS,ingredients:getText(p["Ingrédients"]),instructions:getText(p["Instructions"]),note:getSelect(p["Note"]),likes:getNum(p["Likes"]),dislikes:getNum(p["Dislikes"]),fois_cuisinee:getNum(p["Fois cuisinée"]),derniere_cuisson:getDate(p["Dernière cuisson"]),photo:getUrl(p["Photo"]),sourceUrl:getUrl(p["Source"])||getText(p["Source URL"])||"",commentaires:getText(p["Commentaires"])||""};
}
function parsePlanning(page){
  const p=page.properties;
  return{id:page.id,repas:getTitle(page),date:getDate(p["Date"]),moment:getSelect(p["Moment"]),recette:getText(p["Recette"]),recette_id:getText(p["Recette ID"]),portions:getNum(p["Portions"])||DEFAULT_PORTIONS,notes:getText(p["Notes"]),fait:getCheck(p["Cuisiné"]),queue:getCheck(p["File d'attente"])};
}
function parseCourse(page){
  const p=page.properties;
  return{id:page.id,article:getTitle(page),categorie:getSelect(p["Catégorie"]),quantite:getText(p["Quantité"]),achete:getCheck(p["Acheté"]),semaine:getText(p["Semaine"]),recette:getText(p["Recette"])};
}

// ── Ingredient parsing ────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
// MODULE INGRÉDIENTS PARTAGÉ — un seul parser + normalisation, utilisé partout.
// Évite la divergence entre le parser de la fiche recette et celui des courses.
// ══════════════════════════════════════════════════════════════════════════════

// Familles d'unités pour la conversion (on ne convertit JAMAIS entre familles).
// Valeur = facteur vers l'unité de base de la famille.
const UNIT_FAMILIES={
  masse:{base:"g",units:{mg:0.001,g:1,kg:1000}},
  volume:{base:"ml",units:{ml:1,cl:10,dl:100,l:1000}},
  cuillere:{base:"càc",units:{"càc":1,"c.à.c":1,"c.à.c.":1,"càs":3,"c.à.s":3,"c.à.s.":3}}, // 1 càs = 3 càc
};
// Normalise une unité écrite en sa forme canonique (ou "" si inconnue/comptage).
function canonUnit(u){
  if(!u)return"";
  const x=u.toLowerCase().replace(/\./g,"").replace(/\s/g,"");
  const map={g:"g",kg:"kg",mg:"mg",ml:"ml",cl:"cl",dl:"dl",l:"l",
    cas:"càs","càs":"càs",cac:"càc","càc":"càc",
    cuillere:"càs",cuilleres:"càs","cuillère":"càs","cuillères":"càs",
    tbsp:"càs",tsp:"càc",cup:"tasse",tasse:"tasse",
    cm:"cm",mm:"mm",oz:"oz",lb:"lb",pincee:"pincée","pincée":"pincée",pincees:"pincée","pincées":"pincée",pieces:"pièces","pièces":"pièces","pièce":"pièces"};
  return map[x]||u;
}
function unitFamily(canon){
  for(const[fam,def]of Object.entries(UNIT_FAMILIES)){
    if(canon in def.units)return fam;
  }
  return null;
}

// Parser canonique unique. Retourne {original, qty(number|null), unit(canon), name, scalable}.
function parseOneIngredient(line){
  const trimmed=(line||"").replace(/^[-•*]+\s*/,"").trim();
  if(!trimmed)return{original:line,qty:null,unit:"",name:trimmed,scalable:false};
  const m=trimmed.match(/^([\d.,/]+)\s*(kg|mg|ml|cl|dl|l|cm|mm|c\.?à\.?s\.?|c\.?à\.?c\.?|càs|càc|tasse|cuillères?|tbsp|tsp|cup|oz|lb|pincées?|pièces?|g)?(?=[\s,]|$)\s*(?:de |d'|du |des )?(.+)/i);
  if(m){
    const qty=parseFloat(m[1].replace(",","."));
    const name=(m[3]||trimmed).trim().replace(/^(de |d'|du |des )(?=[a-zA-ZÀ-ÿ])/i,"").trim();
    return{original:trimmed,qty:isNaN(qty)?null:qty,unit:canonUnit(m[2]||""),name,scalable:!isNaN(qty)};
  }
  return{original:trimmed,qty:null,unit:"",name:trimmed,scalable:false};
}

// Découpe un texte d'ingrédients en lignes (gère lignes ET blocs virgulés).
function splitIngredientLines(text){
  if(!text)return[];
  let lines=text.split("\n").map(l=>l.trim()).filter(Boolean);
  if(lines.length<=1&&(text.match(/,/g)||[]).length>=2){
    lines=text.split(/,(?![^(]*\))/).map(l=>l.trim()).filter(Boolean);
  }
  return lines;
}

// Clé de normalisation pour DÉCIDER des fusions (jamais pour réécrire l'affichage).
// Conservateur : minuscule + sans accents + singulier simple. Ne fusionne PAS les synonymes.
function normalizeKey(name){
  return(name||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g," ").trim().replace(/s\b/g,""); // pluriels simples
}

// Combine deux quantités {qty,unit}. Convertit dans la même famille, sinon garde en summands.
// Retourne une string d'affichage.
function combineQuantities(a,b){
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

function parseIngredients(text){
  // Wrapper léger sur le module partagé (un seul parser dans toute l'app).
  return splitIngredientLines(text).map(parseOneIngredient);
}

function scaleIngredients(ingredients,basePortion,newPortion){
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

function guessCategory(name){
  const n=name.toLowerCase();
  if(/poulet|boeuf|porc|veau|agneau|saumon|thon|cabillaud|crevette|merlu|bar|truite|canard|jambon|bacon|lardons|viande|poisson/.test(n))return"Viandes & Poissons";
  if(/lait|crème|beurre|fromage|yaourt|parmesan|mozzarella|feta|ricotta|gruyère/.test(n))return"Produits laitiers";
  if(/tomate|carotte|oignon|ail|courgette|aubergine|poivron|épinard|salade|brocoli|poireau|champignon|pomme de terre|patate|fenouil|céleri|haricot|pois|lentille|quinoa|avocat|concombre|citron|orange/.test(n))return"Fruits & Légumes";
  if(/eau|vin|bière|jus|bouillon|lait de coco/.test(n))return"Boissons";
  if(/surgelé|congelé/.test(n))return"Surgelés";
  return"Épicerie";
}

// ── Claude API ────────────────────────────────────────────────────────────────
async function claudeJSON(system,user,withSearch=false){
  const body={model:"claude-sonnet-4-5",max_tokens:1500,system,messages:[{role:"user",content:user}]};
  if(withSearch)body.tools=[{type:"web_search_20250305",name:"web_search"}];
  try{
    const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const data=await res.json();
    if(!res.ok){console.error("claudeJSON error:",data);return null;}
    return parseJSON((data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join(""));
  }catch(err){
    console.error("claudeJSON fetch/parse failed:",err);
    return null;
  }
}
async function claudeVision(prompt,base64,mediaType){
  const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:1500,system:"Tu es un chef cuisinier expert. Retourne UNIQUEMENT un JSON valide, sans backticks.",messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:mediaType,data:base64}},{type:"text",text:prompt}]}]})});
  const data=await res.json();
  return parseJSON((data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join(""));
}
function parseJSON(text){
  try{
    const cleaned=text.replace(/```json\n?|```\n?/g,"").trim();
    const start=cleaned.indexOf("{");
    const end=cleaned.lastIndexOf("}");
    if(start===-1||end===-1||end<start)return null;
    return JSON.parse(cleaned.slice(start,end+1));
  }catch{return null;}
}

const FRIGO_JSON_PROMPT=`Tu regardes la photo d'un emballage de produit frais (viande, poisson ou volaille). Retourne EXACTEMENT ce JSON sans backticks, sans virgule dans les valeurs:
{"article":"nom court du produit ex: Poulet ou Saumon","proteine":"Viande|Poisson|Volaille|Autre","forme":"Filet|Cuisses|Pavé|Steak|Entier|Haché|Tranches|Autre","date_peremption":"AAAA-MM-JJ (la date limite de consommation lisible sur l'emballage)","quantite":"ex: 500g ou 4 pièces si visible sinon vide"}
Si la date n'est pas lisible, mets null pour date_peremption. Ne mets JAMAIS de virgule dans une valeur.
IMPORTANT: nous sommes en 2026. Une date limite de consommation est TOUJOURS dans le futur proche (quelques jours à quelques semaines). Si tu lis une année passée comme 2023 ou 2024, tu as mal lu le chiffre — relis attentivement, l'année est 2026 (ou 2027 en fin d'année).`;

const RECIPE_JSON_PROMPT=`Retourne exactement ce JSON sans backticks:
{"nom":"nom du plat en français","categorie":"Déjeuner","temps":30,"portions":4,"ingredients":"liste avec quantités en g/ml, UN ingrédient par ligne","instructions":"étapes numérotées","tags":[],"note":"","sourceUrl":""}`;

// ── Extraction de recette depuis une URL ────────────────────────────────────
// 1) Récupère le contenu texte réel de la page côté serveur (fiable)
// 2) Fait extraire la recette par Claude à partir de ce texte
// 3) Si le fetch direct échoue (page protégée, JS-only...), on retombe sur web_search
async function fetchUrlContent(url){
  try{
    const r=await fetch("/api/fetch-url?url="+encodeURIComponent(url));
    const d=await r.json();
    return {text:d?.text||null,image:d?.image||null};
  }catch{return {text:null,image:null};}
}
function withTimeout(promise,ms,label){
  return Promise.race([
    promise,
    new Promise((_,rej)=>setTimeout(()=>rej(new Error(label||"Timeout")),ms)),
  ]);
}
async function extractRecipe(url,fallbackPrompt){
  const SYS="Tu es un expert en recettes. Retourne UNIQUEMENT un JSON valide, sans backticks.";
  if(url&&url.startsWith("http")){
    const {text:pageText,image:pageImage}=await fetchUrlContent(url);
    if(pageText){
      const result=await claudeJSON(SYS,`Voici le contenu texte d'une page web contenant une recette de cuisine. Extrais la recette complète en français avec mesures métriques, ingrédients un par ligne. Ignore le texte hors-sujet (menus, pubs, commentaires).\n\nContenu de la page:\n${pageText}\n\n${RECIPE_JSON_PROMPT}`);
      if(result?.nom)return {...result,image:pageImage||null};
    }
    // Fallback : le fetch direct a échoué, on tente via web_search (moins fiable)
    const viaSearch=await claudeJSON(SYS,`Visite cette URL et extrais la recette complète en français avec mesures métriques, ingrédients un par ligne: ${url}\n\n${RECIPE_JSON_PROMPT}`,true);
    if(viaSearch?.nom)return {...viaSearch,image:pageImage||null};
  }
  if(fallbackPrompt)return claudeJSON(SYS,fallbackPrompt);
  return null;
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const Icon=({name,size=18})=>{
  const icons={
    book:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>,
    calendar:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    cart:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 001.99 1.61H19a2 2 0 001.99-1.82l1-9.58H6"/></svg>,
    plus:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    check:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>,
    camera:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>,
    link:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>,
    sparkle:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M5 3l.75 2.25L8 6l-2.25.75L5 9l-.75-2.25L2 6l2.25-.75z"/></svg>,
    edit:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    close:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    loader:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>,
    arrow:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>,
    thumb_up:<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"/><path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" fill="none" stroke="currentColor" strokeWidth="2"/></svg>,
    thumb_down:<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17" fill="none" stroke="currentColor" strokeWidth="2"/></svg>,
    chef:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 13.87A4 4 0 017.41 6a5.11 5.11 0 0111.18 0A4 4 0 0118 13.87V21H6z"/><line x1="6" y1="17" x2="18" y2="17"/></svg>,
    refresh:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>,
    import:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
    queue:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
    external:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
    drag:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="5" r="1" fill="currentColor"/><circle cx="15" cy="5" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="19" r="1" fill="currentColor"/><circle cx="15" cy="19" r="1" fill="currentColor"/></svg>,
    people:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
  };
  return icons[name]||null;
};

// ── UI Primitives ─────────────────────────────────────────────────────────────
function Spinner({label="Chargement..."}){
  return(<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12,padding:40,color:"#64748B"}}><div style={{animation:"spin 1s linear infinite"}}><Icon name="loader" size={28}/></div><span style={{fontSize:13}}>{label}</span></div>);
}
function Toast({message,onClose}){
  useEffect(()=>{const t=setTimeout(onClose,3000);return()=>clearTimeout(t);},[onClose]);
  return(<div style={{position:"fixed",bottom:"calc(70px + env(safe-area-inset-bottom))",left:"50%",transform:"translateX(-50%)",background:"#0F172A",color:"#FFFFFF",padding:"12px 20px",borderRadius:12,fontSize:13,fontWeight:500,zIndex:1000,boxShadow:"0 8px 32px rgba(0,0,0,0.25)",display:"flex",alignItems:"center",gap:10,whiteSpace:"nowrap",maxWidth:"90vw"}}><span style={{color:"#4ADE80"}}><Icon name="check" size={16}/></span>{message}</div>);
}
function Modal({title,onClose,children,wide,full}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.5)",zIndex:500,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <style>{`@media(min-width:641px){.modal-inner{align-self:center!important;border-radius:16px!important;max-height:90vh!important;}}`}</style>
      <div className="modal-inner" onClick={e=>e.stopPropagation()}
        style={{background:"#FFFFFF",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:full?900:wide?680:560,maxHeight:"92vh",overflow:"auto",paddingBottom:"env(safe-area-inset-bottom)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 20px",borderBottom:"1px solid #F1F5F9",position:"sticky",top:0,background:"#FFFFFF",zIndex:10}}>
          <div style={{width:40,height:4,borderRadius:2,background:"#E2E8F0",margin:"0 auto 0 auto",position:"absolute",left:"50%",transform:"translateX(-50%)",top:8}}/>
          <h3 style={{margin:0,fontSize:15,fontWeight:700,color:"#0F172A",fontFamily:"'Playfair Display', serif"}}>{title}</h3>
          <button onClick={onClose} style={{background:"#F1F5F9",border:"none",color:"#64748B",cursor:"pointer",padding:6,borderRadius:8,display:"flex"}}><Icon name="close" size={16}/></button>
        </div>
        <div style={{padding:"16px 20px"}}>{children}</div>
      </div>
    </div>
  );
}
function Field({label,children}){
  return(<div style={{marginBottom:16}}><label style={{display:"block",fontSize:11,fontWeight:600,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{label}</label>{children}</div>);
}
const inputStyle={width:"100%",background:"#F1F5F9",border:"1px solid #334155",borderRadius:8,color:"#0F172A",padding:"10px 12px",fontSize:14,boxSizing:"border-box",outline:"none",fontFamily:"inherit"};
const btnPrimary={padding:"12px",background:"#C2622D",border:"none",borderRadius:8,color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer",width:"100%",marginTop:8};
const btnDisabled={...btnPrimary,background:"#F1F5F9",color:"#64748B",cursor:"default"};

function ScoreBadge({score}){
  if(score===null||score===undefined)return null;
  const color=score>0?"#4ADE80":score<0?"#F87171":"#64748B";
  return <span style={{fontSize:11,fontWeight:700,color,background:`${color}22`,padding:"2px 7px",borderRadius:10}}>{score>0?`+${score}`:score}</span>;
}
function DaysSince({date}){
  if(!date)return <span style={{fontSize:11,color:"#64748B"}}>jamais cuisiné</span>;
  const days=Math.floor((new Date()-new Date(date))/86400000);
  const color=days>30?"#F59E0B":days>14?"#94A3B8":"#4ADE80";
  return <span style={{fontSize:11,color}}>il y a {days}j</span>;
}

// ── Recipe Detail Modal ───────────────────────────────────────────────────────
// Détecte les durées dans une étape
function detectTimer(text){
  const t=text.toLowerCase();
  let seconds=0;
  const h=t.match(/(\d+)\s*h(?:eure)?/);
  const m=t.match(/(\d+)\s*min/);
  const s=t.match(/(\d+)\s*sec/);
  if(h)seconds+=parseInt(h[1])*3600;
  if(m)seconds+=parseInt(m[1])*60;
  if(s)seconds+=parseInt(s[1]);
  return seconds>0?seconds:null;
}

function playAlarm(){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    [0,0.3,0.6].forEach(t=>{
      const o=ctx.createOscillator();const g=ctx.createGain();
      o.connect(g);g.connect(ctx.destination);
      o.frequency.value=880;o.type="sine";
      g.gain.setValueAtTime(0.4,ctx.currentTime+t);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+t+0.4);
      o.start(ctx.currentTime+t);o.stop(ctx.currentTime+t+0.5);
    });
  }catch(e){}
}

function StepTimer({seconds,stepIdx}){
  const [remaining,setRemaining]=useState(seconds);
  const [running,setRunning]=useState(false);
  const [done,setDone]=useState(false);
  const intervalRef=useRef(null);
  const endTimeRef=useRef(null);   // timestamp (ms) de fin — source de vérité
  const doneRef=useRef(false);

  // Recalcule le restant depuis l'horloge réelle (résiste à l'écran éteint)
  const tick=()=>{
    if(endTimeRef.current==null)return;
    const left=Math.max(0,Math.round((endTimeRef.current-Date.now())/1000));
    setRemaining(left);
    if(left<=0&&!doneRef.current){
      doneRef.current=true;
      clearInterval(intervalRef.current);
      setRunning(false);setDone(true);playAlarm();
    }
  };

  useEffect(()=>{
    if(running){
      // (re)poser l'échéance si pas déjà fixée
      if(endTimeRef.current==null) endTimeRef.current=Date.now()+remaining*1000;
      intervalRef.current=setInterval(tick,1000);
      tick();
    }
    return()=>clearInterval(intervalRef.current);
  },[running]);

  // Au retour d'écran/onglet : recalcul immédiat (rattrape le temps écoulé hors-ligne)
  useEffect(()=>{
    const onVis=()=>{ if(document.visibilityState==="visible"&&running) tick(); };
    document.addEventListener("visibilitychange",onVis);
    return()=>document.removeEventListener("visibilitychange",onVis);
  },[running]);

  const toggle=()=>{
    setRunning(r=>{
      const next=!r;
      if(next){ endTimeRef.current=Date.now()+remaining*1000; }
      else { endTimeRef.current=null; clearInterval(intervalRef.current); } // pause: fige le restant
      return next;
    });
  };

  const reset=()=>{endTimeRef.current=null;doneRef.current=false;setRemaining(seconds);setRunning(false);setDone(false);clearInterval(intervalRef.current);};
  const fmt=(s)=>{const h=Math.floor(s/3600);const m=Math.floor((s%3600)/60);const sec=s%60;return h>0?`${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`:`${m}:${String(sec).padStart(2,"0")}`;};
  const pct=((seconds-remaining)/seconds)*100;
  return(
    <div style={{marginTop:10,padding:"10px 14px",background:done?"#D1FAE5":running?"#FEF3C7":"#F1F5F9",borderRadius:10,border:`1px solid ${done?"#6EE7B7":running?"#FCD34D":"#E2E8F0"}`}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:20}}>{done?"✅":running?"⏱️":"⏱"}</span>
        <span style={{fontSize:20,fontWeight:700,fontFamily:"monospace",color:done?"#065F46":running?"#92400E":"#475569",flex:1}}>{fmt(remaining)}</span>
        {!done&&<button onClick={toggle} style={{padding:"4px 12px",background:running?"#FCD34D":"#C2622D",border:"none",borderRadius:6,color:running?"#92400E":"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>{running?"Pause":"Démarrer"}</button>}
        <button onClick={reset} style={{padding:"4px 8px",background:"none",border:"1px solid #E2E8F0",borderRadius:6,color:"#94A3B8",fontSize:11,cursor:"pointer"}}>↺</button>
      </div>
      <div style={{marginTop:8,height:4,background:"#E2E8F0",borderRadius:2,overflow:"hidden"}}>
        <div style={{height:"100%",width:pct+"%",background:done?"#34D399":running?"#F59E0B":"#C2622D",transition:"width 1s linear",borderRadius:2}}/>
      </div>
      {done&&<div style={{fontSize:12,color:"#065F46",fontWeight:600,marginTop:6}}>⏰ Temps écoulé !</div>}
    </div>
  );
}

function CookingMode({recette,onClose,planningEntry,onCookComplete,toast}){
  const instructions=recette.instructions
    ?recette.instructions.split("\n").filter(s=>s.trim()).map(s=>s.replace(/^\d+\.\s*/,"").trim()).filter(Boolean)
    :[];
  const ingredients=splitIngredientLines(recette.ingredients);
  const [completing,setCompleting]=useState(false);
  const [fridgeConfirm,setFridgeConfirm]=useState(null); // items frigo à confirmer

  // Cherche dans le frigo (cache) les protéines mentionnées par la recette.
  const findFridgeMatches=()=>{
    const frigo=getCached("frigo")||[];
    const norm=s=>(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const hay=norm(recette.nom)+" "+norm(recette.ingredients);
    return frigo.filter(item=>{
      const kw=norm(item.article).split(" ")[0];
      return kw&&hay.includes(kw);
    });
  };

  const handleComplete=async()=>{
    if(completing)return;
    setCompleting(true);
    // Diagnostic visible : d'où vient l'appel, planningEntry présent ?
    if(!planningEntry?.id){
      toast&&toast("⚠️ Pas d'entrée planning (id manquant) — ouvre la recette depuis le planning");
      setCompleting(false);
      return;
    }
    // Marquer le planning comme Cuisiné + incrémenter Fois cuisinée
    try{
      const r1=await notionUpdate(planningEntry.id,{"Cuisiné":nCheck(true)});
      if(r1?.object==="error") throw new Error(r1.message||"Échec Cuisiné");
      if(recette.id){
        const r2=await notionUpdate(recette.id,{"Fois cuisinée":nNum((recette.fois_cuisinee||0)+1),"Dernière cuisson":nDate(new Date().toISOString().split("T")[0])});
        if(r2?.object==="error") throw new Error(r2.message||"Échec Fois cuisinée");
      }
      toast&&toast("✓ Marqué cuisiné");
    }catch(e){logError("cookComplete",e,{recette:recette.nom});toast&&toast("Erreur : "+e.message);setCompleting(false);return;}
    // Proposer de retirer les protéines du frigo concernées
    const matches=findFridgeMatches();
    if(matches.length>0){ setFridgeConfirm(matches); setCompleting(false); }
    else { onCookComplete&&onCookComplete(); onClose(); }
  };

  const confirmFridgeRemoval=async(remove)=>{
    if(remove&&fridgeConfirm){
      const frigo=getCached("frigo")||[];
      const ids=new Set(fridgeConfirm.map(m=>m.id));
      setCache("frigo",frigo.filter(f=>!ids.has(f.id)));
      for(const item of fridgeConfirm){
        try{await notionUpdate(item.id,{"Consommé":nCheck(true)});}catch(e){logError("cookFridge",e,{item:item.article});}
      }
    }
    setFridgeConfirm(null);
    onCookComplete&&onCookComplete();
    onClose();
  };
  const total=instructions.length;

  return(
    <div style={{position:"fixed",inset:0,zIndex:2000,background:"#FFFFFF",display:"flex",flexDirection:"column"}}>
      {/* Header fixe */}
      <div style={{padding:"14px 20px",borderBottom:"1px solid #E2E8F0",display:"flex",alignItems:"center",gap:12,background:"#FFFFFF",flexShrink:0,position:"sticky",top:0,zIndex:10}}>
        <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"#64748B",padding:4}}><Icon name="close" size={20}/></button>
        <div style={{flex:1}}>
          <div style={{fontSize:10,color:"#94A3B8",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em"}}>Mode cuisine</div>
          <div style={{fontSize:14,fontWeight:700,color:"#0F172A",fontFamily:"'Playfair Display',serif"}}>{recette.nom}</div>
        </div>
        <span style={{fontSize:12,color:"#94A3B8"}}>{recette.temps} min · {recette.portions||4} pers.</span>
      </div>

      {/* Scroll unique */}
      <div style={{flex:1,overflow:"auto",padding:"0 0 40px"}}>

        {/* Photo */}
        {recette.photo&&<img src={recette.photo} alt={recette.nom} style={{width:"100%",height:180,objectFit:"cover",display:"block"}} onError={e=>e.target.style.display="none"}/>}

        {/* Ingrédients */}
        <div style={{padding:"16px 20px 0"}}>
          <div style={{fontSize:11,fontWeight:700,color:"#C2622D",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:10}}>🧂 Ingrédients</div>
          <div style={{background:"#FFF7ED",border:"1px solid #FDBA74",borderRadius:12,padding:"12px 14px",marginBottom:24}}>
            {ingredients.map((ing,i)=>(
              <div key={i} style={{fontSize:13,color:"#0F172A",padding:"4px 0",borderBottom:i<ingredients.length-1?"1px solid #FED7AA":"none",lineHeight:1.5}}>{ing}</div>
            ))}
          </div>

          {/* Étapes */}
          <div style={{fontSize:11,fontWeight:700,color:"#C2622D",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:12}}>📋 Étapes</div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {instructions.map((step,i)=>{
              const timerSec=detectTimer(step);
              return(
                <div key={i} style={{background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:12,overflow:"hidden"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"#F8FAFC",borderBottom:"1px solid #F1F5F9"}}>
                    <div style={{width:22,height:22,borderRadius:"50%",background:"#C2622D",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <span style={{fontSize:11,fontWeight:700,color:"#fff"}}>{i+1}</span>
                    </div>
                    <span style={{fontSize:11,fontWeight:600,color:"#475569"}}>Étape {i+1} / {total}</span>
                  </div>
                  <div style={{padding:"12px 14px"}}>
                    <p style={{fontSize:15,color:"#0F172A",lineHeight:1.7,margin:0,fontWeight:500}}>{step}</p>
                    {timerSec&&<StepTimer key={i} seconds={timerSec} stepIdx={i}/>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Fin */}
          {planningEntry?(
            <button onClick={handleComplete} disabled={completing} style={{width:"100%",marginTop:24,padding:"20px",background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:12,textAlign:"center",cursor:"pointer"}}>
              <div style={{fontSize:28,marginBottom:6}}>🎉</div>
              <div style={{fontSize:15,fontWeight:700,color:"#065F46"}}>{completing?"Enregistrement…":"Bon appétit ! · Marquer comme cuisiné"}</div>
              <div style={{fontSize:11,color:"#16A34A",marginTop:4}}>Valide le repas et met à jour le frigo</div>
            </button>
          ):(
            <div style={{marginTop:24,padding:"20px",background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:12,textAlign:"center"}}>
              <div style={{fontSize:28,marginBottom:6}}>🎉</div>
              <div style={{fontSize:15,fontWeight:700,color:"#065F46"}}>Bon appétit !</div>
            </div>
          )}
          {fridgeConfirm&&(
            <div style={{position:"fixed",inset:0,zIndex:3000,background:"rgba(15,23,42,0.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
              <div style={{background:"#FFFFFF",borderRadius:16,maxWidth:440,width:"100%",padding:20}}>
                <h3 style={{margin:"0 0 8px",fontSize:16,fontWeight:700,fontFamily:"'Playfair Display',serif"}}>Mettre à jour le frigo ?</h3>
                <p style={{fontSize:13,color:"#64748B",margin:"0 0 12px"}}>Tu as cuisiné cette recette. Retirer {fridgeConfirm.length>1?"ces produits":"ce produit"} du frigo ?</p>
                <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
                  {fridgeConfirm.map(m=>(
                    <div key={m.id} style={{padding:"8px 12px",background:"#F8FAFC",borderRadius:8,fontSize:14,fontWeight:600,color:"#0F172A"}}>{m.article}{m.forme&&m.forme!=="Autre"?` · ${m.forme}`:""}</div>
                  ))}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>confirmFridgeRemoval(false)} style={{flex:1,padding:"12px",background:"#F1F5F9",border:"none",borderRadius:10,color:"#475569",fontWeight:600,fontSize:14,cursor:"pointer"}}>Garder</button>
                  <button onClick={()=>confirmFridgeRemoval(true)} style={{flex:1,padding:"12px",background:"#16A34A",border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>Retirer du frigo</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function RecipeDetailModal({recette,onClose,toast,onAddToCourses,onAddToPlanning,onDelete,onUpdate,planningEntry,onCancelPlanning,onRequeuePlanning,onCookComplete:onCookCompleteParent}){
  const [confirmDelete,setConfirmDelete]=useState(false);
  const [deleting,setDeleting]=useState(false);
  const [photoCandidates,setPhotoCandidates]=useState(null); // null=fermé, []=recherche vide
  const [photoSearching,setPhotoSearching]=useState(false);
  const [localPhoto,setLocalPhoto]=useState(recette.photo||"");
  const [photoBroken,setPhotoBroken]=useState(false);
  const basePortion=recette.portions||DEFAULT_PORTIONS;
  const [portions,setPortions]=useState(basePortion);
  const [selectedIngredients,setSelectedIngredients]=useState(null);
  const [cookingMode,setCookingMode]=useState(false);
  const [currentNote,setCurrentNote]=useState(recette.note||"");
  const [savingNote,setSavingNote]=useState(false);
  const [commentaires,setCommentaires]=useState(recette.commentaires||"");
  const [savingComment,setSavingComment]=useState(false);
  const [commentTimer,setCommentTimer]=useState(null);
  const [editing,setEditing]=useState(false);
  const [editForm,setEditForm]=useState(null);
  const [savingEdit,setSavingEdit]=useState(false);
  const score=(recette.likes||0)-(recette.dislikes||0);

  const startEdit=()=>{
    setEditForm({
      nom:recette.nom||"",categorie:recette.categorie||"Dîner",temps:recette.temps||"",
      portions:recette.portions||DEFAULT_PORTIONS,ingredients:recette.ingredients||"",
      instructions:recette.instructions||"",note:recette.note||"***",
      photoUrl:recette.photo||"",sourceUrl:recette.sourceUrl||"",
    });
    setEditing(true);
  };

  const saveEdit=async()=>{
    if(!editForm?.nom)return;
    setSavingEdit(true);
    const r=await notionUpdate(recette.id,{
      "Nom":nTitle(editForm.nom),"Catégorie":nSel(editForm.categorie),"Temps de préparation":nNum(editForm.temps),
      "Portions":nNum(editForm.portions||DEFAULT_PORTIONS),"Ingrédients":nText(editForm.ingredients),
      "Instructions":nText(editForm.instructions),"Note":nSel(editForm.note),
      "Photo":nUrl(editForm.photoUrl||""),"Source":nUrl(editForm.sourceUrl||""),
    });
    setSavingEdit(false);
    if(!r||r.object==="error"){
      logError("RecipeDetailModal.saveEdit",new Error(r?.message||"Échec de la mise à jour Notion"),{id:recette.id});
      toast("Erreur : modifications non enregistrées ✕");
      return;
    }
    setCache("recettes",null);
    const updated={...recette,nom:editForm.nom,categorie:editForm.categorie,temps:Number(editForm.temps)||0,
      portions:Number(editForm.portions)||DEFAULT_PORTIONS,ingredients:editForm.ingredients,instructions:editForm.instructions,
      note:editForm.note,photo:editForm.photoUrl||null,sourceUrl:editForm.sourceUrl||""};
    onUpdate?.(updated);
    setEditing(false);
    toast("Recette modifiée ✓");
  };

  const parsedIngredients=parseIngredients(recette.ingredients);
  const scaled=scaleIngredients(parsedIngredients,basePortion,portions);

  const instructions=recette.instructions
    ?recette.instructions.split(/\n|(?=\d+\.)\s*/).filter(s=>s.trim())
    :[];

  const handleAddToCourses=()=>{
    const selected=scaled.map((ing,i)=>({...ing,selected:true,idx:i}));
    setSelectedIngredients(selected);
  };

  if(cookingMode) return <CookingMode recette={recette} onClose={()=>setCookingMode(false)} planningEntry={planningEntry} toast={toast} onCookComplete={()=>{onCookCompleteParent&&onCookCompleteParent();onClose&&onClose();}}/>;

  if(editing){
    return(
      <Modal title={"Modifier : "+recette.nom} onClose={()=>setEditing(false)} wide>
        <RecipeForm form={editForm} setForm={setEditForm} saving={savingEdit} onSave={saveEdit} analyzing={false}/>
        <button onClick={()=>setEditing(false)} disabled={savingEdit} style={{width:"100%",marginTop:8,padding:"10px",background:"transparent",border:"1px solid #E2E8F0",borderRadius:10,color:"#64748B",cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Annuler</button>
      </Modal>
    );
  }

  if(selectedIngredients){
    return(
      <Modal title="Ajouter aux courses" onClose={()=>setSelectedIngredients(null)} wide>
        <p style={{color:"#64748B",fontSize:13,margin:"0 0 16px"}}>Déselectionne les ingrédients déjà disponibles :</p>
        <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:20}}>
          {selectedIngredients.map((ing,i)=>(
            <div key={i} onClick={()=>setSelectedIngredients(prev=>prev.map((x,j)=>j===i?{...x,selected:!x.selected}:x))}
              style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:8,cursor:"pointer",opacity:ing.selected?1:0.4}}>
              <div style={{width:20,height:20,borderRadius:5,border:`2px solid ${ing.selected?"#C2622D":"#334155"}`,background:ing.selected?"#C2622D":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {ing.selected&&<Icon name="check" size={12}/>}
              </div>
              <span style={{flex:1,fontSize:14,color:"#0F172A"}}>{ing.name}</span>
              <span style={{fontSize:12,color:"#64748B"}}>{ing.displayQty||ing.qty||""} {ing.unit}</span>
            </div>
          ))}
        </div>
        <button onClick={async()=>{
          const toAdd=selectedIngredients.filter(i=>i.selected);
          const semaine=new Date().toLocaleDateString("fr-FR",{day:"numeric",month:"short"});
          for(const ing of toAdd){
            const qty=`${ing.displayQty||ing.qty||""} ${ing.unit}`.trim();
            await notionCreate(DB_COURSES,{"Article":nTitle(ing.name),"Catégorie":nSel(guessCategory(ing.name)),"Quantité":nText(qty),"Semaine":nText(`Sem. du ${semaine}`),"Recette":nText(recette.nom)});
          }
          setCache("courses",null);
          toast(`${toAdd.length} ingrédients ajoutés aux courses ✓`);
          setSelectedIngredients(null);
          onClose();
        }} style={btnPrimary}>Ajouter {selectedIngredients.filter(i=>i.selected).length} ingrédients aux courses</button>
      </Modal>
    );
  }

  const searchPhoto=async()=>{
    setPhotoSearching(true);setPhotoCandidates(null);
    try{
      const r=await fetch("/api/recipe-image?q="+encodeURIComponent(recette.nom));
      const d=await r.json();
      setPhotoCandidates(d.candidates||[]);
    }catch(e){logError("searchPhoto",e,{recette:recette.nom});setPhotoCandidates([]);}
    setPhotoSearching(false);
  };
  const approvePhoto=async(url)=>{
    setLocalPhoto(url);setPhotoCandidates(null);
    try{
      await notionUpdate(recette.id,{"Photo":nUrl(url)});
      toast("Photo ajoutée ✓");
      onUpdate&&onUpdate({...recette,photo:url});
    }catch(e){logError("approvePhoto",e,{recette:recette.nom});toast("Erreur enregistrement photo");}
  };

  return(
    <Modal title={recette.nom} onClose={onClose} full>
      {(localPhoto&&!photoBroken)
        ?<div style={{position:"relative",marginBottom:16}}>
           <img src={localPhoto} alt={recette.nom} style={{width:"100%",height:220,objectFit:"cover",borderRadius:10,display:"block"}} onError={()=>setPhotoBroken(true)}/>
           <button onClick={searchPhoto} disabled={photoSearching} title="Changer la photo" style={{position:"absolute",bottom:8,right:8,background:"rgba(15,23,42,0.75)",color:"#fff",border:"none",borderRadius:20,padding:"6px 12px",fontSize:11,fontWeight:600,cursor:"pointer"}}>{photoSearching?"🔍…":"✨ Changer"}</button>
         </div>
        :<button onClick={searchPhoto} disabled={photoSearching} style={{width:"100%",padding:"14px",marginBottom:16,background:"#FFF7ED",border:"1px dashed #FDBA74",borderRadius:10,color:"#C2622D",fontWeight:600,fontSize:13,cursor:"pointer"}}>{photoSearching?"🔍 Recherche d'images…":(localPhoto&&photoBroken)?"⚠️ Photo cassée — en trouver une autre":"✨ Trouver une photo pour cette recette"}</button>
      }

      {photoCandidates!==null&&(
        <div style={{position:"fixed",inset:0,zIndex:2700,background:"rgba(15,23,42,0.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setPhotoCandidates(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#FFFFFF",borderRadius:16,maxWidth:560,width:"100%",maxHeight:"85vh",overflow:"auto",padding:18}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <h3 style={{margin:0,fontSize:16,fontWeight:700,fontFamily:"'Playfair Display',serif"}}>Choisis une photo</h3>
              <button onClick={()=>setPhotoCandidates(null)} style={{background:"none",border:"none",cursor:"pointer",color:"#94A3B8",fontSize:18}}>✕</button>
            </div>
            <p style={{fontSize:12,color:"#64748B",margin:"0 0 12px"}}>Résultats web pour « {recette.nom} ». Tape une image pour l'utiliser.</p>
            {photoCandidates.length===0?(
              <div style={{textAlign:"center",padding:"24px",color:"#94A3B8",fontSize:13}}>Aucune image trouvée. Réessaie ou ajoute une photo manuellement via ✏️ Modifier.</div>
            ):(
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:8}}>
                {photoCandidates.map((c,i)=>(
                  <button key={i} onClick={()=>approvePhoto(c.url)} style={{padding:0,border:"1px solid #E2E8F0",borderRadius:10,overflow:"hidden",cursor:"pointer",background:"#F8FAFC",aspectRatio:"4/3"}}>
                    <img src={c.thumb} alt={c.title} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}} onError={e=>{e.target.parentElement.style.display="none";}}/>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Header info */}
      <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        {recette.categorie&&<span style={{fontSize:12,padding:"4px 10px",borderRadius:6,background:"#F1F5F9",color:"#64748B"}}>{recette.categorie}</span>}
        {recette.temps>0&&<span style={{fontSize:12,padding:"4px 10px",borderRadius:6,background:"#F1F5F9",color:"#64748B"}}>⏱ {recette.temps} min</span>}
        <ScoreBadge score={score}/>
        {recette.fois_cuisinee>0&&<span style={{fontSize:12,color:"#64748B"}}>🍳 {recette.fois_cuisinee}x</span>}
        <DaysSince date={recette.derniere_cuisson}/>
        {recette.sourceUrl&&<a href={recette.sourceUrl} target="_blank" rel="noreferrer" style={{display:"flex",alignItems:"center",gap:4,fontSize:12,color:"#C2622D",textDecoration:"none"}}><Icon name="external" size={12}/> Recette originale</a>}
      </div>

      {/* Statut planification (si ouvert depuis le planning) */}
      {planningEntry&&(
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:16,padding:"10px 14px",background:"#FFF7ED",border:"1px solid #FDBA74",borderRadius:10}}>
          <span style={{fontSize:13,color:"#C2622D",fontWeight:600,flex:1,minWidth:180}}>
            {planningEntry.queue||!planningEntry.date
              ?"⏳ En file d'attente"
              :`📅 Planifié le ${new Date(planningEntry.date+"T00:00").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}${planningEntry.moment?" · "+planningEntry.moment:""}`}
          </span>
          <div style={{display:"flex",gap:8}}>
            {!planningEntry.queue&&planningEntry.date&&onRequeuePlanning&&(
              <button onClick={()=>onRequeuePlanning(planningEntry)} style={{padding:"6px 12px",background:"#FFFFFF",border:"1px solid #FDBA74",borderRadius:8,color:"#C2622D",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                ↩ File d'attente
              </button>
            )}
            {onCancelPlanning&&(
              <button onClick={()=>onCancelPlanning(planningEntry)} style={{padding:"6px 12px",background:"#FFFFFF",border:"1px solid #FECACA",borderRadius:8,color:"#DC2626",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                ✕ {planningEntry.queue?"Retirer de la file":"Annuler"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Notation étoiles */}
      <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:16}}>
        {[1,2,3,4,5].map(n=>{
          const filled=(currentNote||"").length>=n;
          return(
            <button key={n} onClick={async()=>{
              if(savingNote)return;
              const newNote="*".repeat(n);
              setCurrentNote(newNote);setSavingNote(true);
              await notionUpdate(recette.id,{"Note":nSel(newNote)});
              setSavingNote(false);toast("Note mise à jour ✓");
            }}
            style={{background:"none",border:"none",cursor:"pointer",fontSize:20,padding:"0 1px",lineHeight:1,color:filled?"#F59E0B":"#E2E8F0",transition:"color 0.1s"}}>
              ★
            </button>
          );
        })}
        <span style={{fontSize:11,color:"#94A3B8",marginLeft:4}}>{savingNote?"...":(currentNote||"").length+"/5"}</span>
      </div>

      {/* Portions adjuster */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20,padding:"12px 16px",background:"#F1F5F9",borderRadius:10}}>
        <Icon name="people" size={16}/>
        <span style={{fontSize:13,color:"#64748B",flex:1}}>Portions</span>
        <button onClick={()=>setPortions(p=>Math.max(1,p-1))} style={{width:28,height:28,borderRadius:"50%",background:"#E2E8F0",border:"none",color:"#0F172A",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
        <span style={{fontSize:16,fontWeight:700,color:"#0F172A",minWidth:24,textAlign:"center"}}>{portions}</span>
        <button onClick={()=>setPortions(p=>p+1)} style={{width:28,height:28,borderRadius:"50%",background:"#E2E8F0",border:"none",color:"#0F172A",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
      </div>

      <div className="recipe-detail-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24}}>
        {/* Ingredients */}
        <div>
          <h5 style={{color:"#C2622D",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:12,marginTop:0}}>Ingrédients</h5>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {scaled.map((ing,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #E2E8F0"}}>
                <span style={{fontSize:13,color:"#0F172A"}}>{ing.name}</span>
                <span style={{fontSize:13,color:"#64748B",marginLeft:8,whiteSpace:"nowrap"}}>{ing.scalable?(ing.displayQty||ing.qty):""} {ing.unit}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Instructions */}
        <div>
          <h5 style={{color:"#C2622D",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:12,marginTop:0}}>Instructions</h5>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {instructions.length===0&&(
              <div style={{fontSize:13,color:"#94A3B8",fontStyle:"italic",padding:"8px 0"}}>
                Aucune instruction enregistrée. Utilise ✏️ Modifier pour en ajouter.
              </div>
            )}
            {instructions.map((step,i)=>(
              <div key={i} style={{display:"flex",gap:10}}>
                <span style={{fontSize:11,fontWeight:700,color:"#C2622D",minWidth:20,marginTop:2}}>{i+1}.</span>
                <span style={{fontSize:13,color:"#475569",lineHeight:1.6}}>{step.replace(/^\d+\.\s*/,"")}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Zone de notes personnelles */}
      <div style={{marginTop:24,borderTop:"1px solid #E2E8F0",paddingTop:16}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <span style={{fontSize:11,fontWeight:700,color:"#C2622D",textTransform:"uppercase",letterSpacing:"0.1em"}}>📝 Notes personnelles</span>
          {savingComment&&<span style={{fontSize:11,color:"#94A3B8"}}>Sauvegarde...</span>}
          {!savingComment&&commentaires&&<span style={{fontSize:11,color:"#16A34A"}}>✓ Sauvegardé</span>}
        </div>
        <textarea
          value={commentaires}
          onChange={e=>{
            const val=e.target.value;
            setCommentaires(val);
            // Autosave avec debounce 1.5s
            if(commentTimer) clearTimeout(commentTimer);
            const t=setTimeout(async()=>{
              setSavingComment(true);
              await notionUpdate(recette.id,{"Commentaires":nText(val)});
              setSavingComment(false);
            },1500);
            setCommentTimer(t);
          }}
          placeholder="Ajoute tes astuces, variantes, retours d'expérience…"
          rows={3}
          style={{width:"100%",padding:"10px 12px",background:"#F8FAFC",border:"1px solid #E2E8F0",borderRadius:10,fontSize:13,color:"#0F172A",fontFamily:"inherit",resize:"vertical",lineHeight:1.6,outline:"none"}}
        />
      </div>

      {/* Actions */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:16}}>
        <button onClick={()=>setCookingMode(true)} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px",background:"#C2622D",border:"none",borderRadius:8,color:"#fff",cursor:"pointer",fontWeight:700,fontSize:13}}>
          🍳 Cuisiner
        </button>
        <button onClick={handleAddToCourses} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:8,color:"#64748B",cursor:"pointer",fontWeight:600,fontSize:13}}>
          <Icon name="cart" size={15}/> Courses
        </button>
        <button onClick={()=>onAddToPlanning(recette,portions,"queue")} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px",background:"#FFFFFF",border:"1px solid #C2622D",borderRadius:8,color:"#C2622D",cursor:"pointer",fontWeight:600,fontSize:13}}>
          <Icon name="queue" size={15}/> File d'attente
        </button>
        <button onClick={()=>onAddToPlanning(recette,portions,"date")} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px",background:"#C2622D",border:"none",borderRadius:8,color:"#fff",cursor:"pointer",fontWeight:600,fontSize:13}}>
          <Icon name="calendar" size={15}/> Planifier
        </button>
        <button onClick={startEdit} style={{gridColumn:"1 / -1",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:8,color:"#64748B",cursor:"pointer",fontWeight:600,fontSize:13}}>
          <Icon name="edit" size={15}/> Modifier la recette
        </button>
      </div>

      {/* Suppression (utile pour doublons) */}
      {onDelete&&(
        <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid #F1F5F9"}}>
          {!confirmDelete?(
            <button onClick={()=>setConfirmDelete(true)} style={{width:"100%",padding:"8px",background:"transparent",border:"1px solid #FECACA",borderRadius:8,color:"#DC2626",fontSize:12,fontWeight:600,cursor:"pointer"}}>
              🗑 Supprimer cette recette
            </button>
          ):(
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <span style={{fontSize:12,color:"#64748B",flex:1}}>Supprimer définitivement ?</span>
              <button onClick={()=>setConfirmDelete(false)} style={{padding:"8px 14px",background:"#F1F5F9",border:"none",borderRadius:8,color:"#475569",fontSize:12,fontWeight:600,cursor:"pointer"}}>Annuler</button>
              <button disabled={deleting} onClick={async()=>{
                setDeleting(true);
                try{
                  await fetch(`/api/notion?path=/v1/pages/${recette.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({archived:true})});
                  toast("Recette supprimée ✓");
                  onDelete(recette.id);
                  onClose();
                }catch(e){logError("deleteRecette",e,{id:recette.id});toast("Erreur suppression");}
                setDeleting(false);
              }} style={{padding:"8px 14px",background:"#DC2626",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",opacity:deleting?0.5:1}}>
                {deleting?"...":"Supprimer"}
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Add to Planning Modal ─────────────────────────────────────────────────────
function AddToPlanningModal({recette,portions,mode,onClose,toast}){
  const [date,setDate]=useState(new Date().toISOString().split("T")[0]);
  const [moment,setMoment]=useState("Dîner");
  const [saving,setSaving]=useState(false);

  const save=async()=>{
    setSaving(true);
    const isQueue=mode==="queue";
    // For queue: use next monday
    let targetDate=date;
    if(isQueue){
      const now=new Date();
      const day=now.getDay();
      const nextMonday=new Date(now);
      nextMonday.setDate(now.getDate()+(day===0?1:8-day));
      targetDate=nextMonday.toISOString().split("T")[0];
    }
    await notionCreate(DB_PLANNING,{
      "Repas":nTitle(recette.nom),
      "Date":nDate(targetDate),
      "Moment":nSel(moment),
      "Recette":nText(recette.nom),
      "Recette ID":nText(recette.id),
      "Portions":nNum(portions),
      "File d'attente":nCheck(isQueue),
    });
    setCache("planning",null);
    toast(isQueue?`"${recette.nom}" ajouté à la file d'attente ✓`:`"${recette.nom}" planifié ✓`);
    setSaving(false);
    onClose();
  };

  return(
    <Modal title={mode==="queue"?"File d'attente":"Planifier"} onClose={onClose}>
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:"#F1F5F9",borderRadius:10,marginBottom:16}}>
        {recette.photo?(<img src={recette.photo} alt="" style={{width:"100%",height:120,objectFit:"cover",borderRadius:"10px 10px 0 0",display:"block",marginBottom:0}} onError={e=>{e.target.style.display="none";}}/>):(<div style={{width:"100%",height:80,borderRadius:"10px 10px 0 0",background:"#F1F5F9",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32}}>{recette.categorie==="Dessert"?"🍰":recette.categorie==="Petit-déjeuner"?"🥐":recette.categorie==="Soupe"?"🍲":"🍽️"}</div>)}
        <div>
          <div style={{fontSize:14,fontWeight:700,color:"#0F172A"}}>{recette.nom}</div>
          <div style={{fontSize:12,color:"#64748B"}}>{portions} portions</div>
        </div>
      </div>
      {mode==="date"&&(
        <Field label="Date">
          <input style={inputStyle} type="date" value={date} onChange={e=>setDate(e.target.value)}/>
        </Field>
      )}
      {mode==="queue"&&(
        <p style={{color:"#64748B",fontSize:13,margin:"0 0 16px"}}>Cette recette sera ajoutée à la file d'attente de la semaine prochaine.</p>
      )}
      <Field label="Moment">
        <select style={inputStyle} value={moment} onChange={e=>setMoment(e.target.value)}>
          {MOMENTS.map(m=><option key={m}>{m}</option>)}
        </select>
      </Field>
      <button onClick={save} disabled={saving} style={btnPrimary}>{saving?"Enregistrement...":mode==="queue"?"Ajouter à la file":"Planifier"}</button>
    </Modal>
  );
}

// ── Recipe Form ───────────────────────────────────────────────────────────────
function RecipeForm({form,setForm,saving,onSave,analyzing}){
  const isReady=form.nom&&!analyzing&&!saving;
  return(
    <>
      <Field label="Nom"><input style={inputStyle} value={form.nom} onChange={e=>setForm(f=>({...f,nom:e.target.value}))} placeholder="Ex: Poulet rôti aux herbes"/></Field>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Field label="Catégorie">
          <select style={inputStyle} value={form.categorie} onChange={e=>setForm(f=>({...f,categorie:e.target.value}))}>
            {["Déjeuner","Dîner","Dessert","Sauce & Marinade"].map(c=><option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Note">
          <select style={inputStyle} value={form.note} onChange={e=>setForm(f=>({...f,note:e.target.value}))}>
            {["*","**","***","****","*****"].map(n=><option key={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Temps (min)"><input style={inputStyle} type="number" value={form.temps} onChange={e=>setForm(f=>({...f,temps:e.target.value}))} placeholder="30"/></Field>
        <Field label="Portions"><input style={inputStyle} type="number" value={form.portions} onChange={e=>setForm(f=>({...f,portions:e.target.value}))}/></Field>
      </div>
      <Field label="URL source (optionnel)"><input style={inputStyle} value={form.sourceUrl||""} onChange={e=>setForm(f=>({...f,sourceUrl:e.target.value}))} placeholder="https://marmiton.org/..."/></Field>
      <Field label="URL photo (optionnel)"><input style={inputStyle} value={form.photoUrl||""} onChange={e=>setForm(f=>({...f,photoUrl:e.target.value}))} placeholder="https://..."/></Field>
      <Field label="Ingrédients (un par ligne)"><textarea style={{...inputStyle,minHeight:100,resize:"vertical"}} value={form.ingredients} onChange={e=>setForm(f=>({...f,ingredients:e.target.value}))} placeholder={"200g poulet\n2 gousses d'ail\n1 citron"}/></Field>
      <Field label="Instructions"><textarea style={{...inputStyle,minHeight:100,resize:"vertical"}} value={form.instructions} onChange={e=>setForm(f=>({...f,instructions:e.target.value}))} placeholder="1. Préchauffer le four..."/></Field>
      <button onClick={onSave} disabled={!isReady} style={isReady?btnPrimary:btnDisabled}>{saving?"Enregistrement...":analyzing?"Analyse...":"Sauvegarder"}</button>
    </>
  );
}

// ── Add Recipe Modal ──────────────────────────────────────────────────────────
const METHODS=[
  {id:"manual",label:"Saisie manuelle",icon:"edit",color:"#C2622D"},
  {id:"photo",label:"Photo",icon:"camera",color:"#F59E0B"},
  {id:"url",label:"URL",icon:"link",color:"#10B981"},
  {id:"ai",label:"Générer avec l'IA",icon:"sparkle",color:"#EC4899"},
  {id:"ingredients",label:"Par ingrédients",icon:"chef",color:"#14B8A6"},
];

function AddRecipeModal({onClose,onSaved}){
  const [method,setMethod]=useState(null);
  const [form,setForm]=useState({...EMPTY_FORM});
  const [saving,setSaving]=useState(false);
  const [analyzing,setAnalyzing]=useState(false);
  const [photoPreview,setPhotoPreview]=useState(null);
  const [url,setUrl]=useState("");
  const [prompt,setPrompt]=useState("");
  const fileInputRef=useRef(null);
  const cameraInputRef=useRef(null);
  const [photoQueue,setPhotoQueue]=useState([]); // files en attente de review
  const [queueTotal,setQueueTotal]=useState(0);
  const [queueDone,setQueueDone]=useState(0);

  const extractOneFile=async(file)=>{
    if(!file||!file.type.startsWith("image/"))return;
    setForm({...EMPTY_FORM});
    setPhotoPreview(URL.createObjectURL(file));
    setAnalyzing(true);
    const reader=new FileReader();
    reader.onload=async(e)=>{
      const base64=e.target.result.split(",")[1];
      const result=await claudeVision(RECIPE_JSON_PROMPT,base64,file.type);
      if(result)setForm(f=>({...f,...result,tags:Array.isArray(result.tags)?result.tags:f.tags,photoUrl:f.photoUrl}));
      setAnalyzing(false);
    };
    reader.readAsDataURL(file);
  };

  // Reçoit 1..N fichiers. Traite le premier, met les autres en file d'attente.
  const handlePhotoFiles=async(files)=>{
    const imgs=Array.from(files||[]).filter(f=>f.type.startsWith("image/"));
    if(imgs.length===0)return;
    setQueueTotal(imgs.length);
    setQueueDone(0);
    setPhotoQueue(imgs.slice(1));
    await extractOneFile(imgs[0]);
  };

  // Compat : ancien nom utilisé ailleurs (caméra, drop simple)
  const handlePhotoFile=(file)=>handlePhotoFiles(file?[file]:[]);

  // Passe à la photo suivante de la file (après save ou skip)
  const advanceQueue=async()=>{
    setQueueDone(d=>d+1);
    if(photoQueue.length>0){
      const [next,...rest]=photoQueue;
      setPhotoQueue(rest);
      setForm({...EMPTY_FORM});
      setPhotoPreview(null);
      await extractOneFile(next);
    } else {
      // Fin de la file
      setPhotoPreview(null);
      setForm({...EMPTY_FORM});
      setQueueTotal(0);setQueueDone(0);
      onSaved("Lot terminé ✓");
      onClose();
    }
  };

  const fetchFromUrl=async()=>{
    if(!url)return;
    setAnalyzing(true);
    const result=await extractRecipe(url);
    if(result){
      setForm(f=>({...f,...result,tags:Array.isArray(result.tags)?result.tags:f.tags,sourceUrl:url,photoUrl:result.image||f.photoUrl}));
    }else{
      alert("Impossible d'extraire la recette depuis cette URL (timeout ou erreur). Réessaie, ou utilise la saisie manuelle.");
    }
    setAnalyzing(false);
  };

  const generateFromPrompt=async()=>{
    if(!prompt)return;
    setAnalyzing(true);
    const isIng=method==="ingredients";
    const result=await claudeJSON("Tu es un chef cuisinier créatif français. Retourne UNIQUEMENT un JSON valide, sans backticks.",isIng?`L'utilisateur a ces ingrédients: "${prompt}". Propose une recette créative.\n\n${RECIPE_JSON_PROMPT}`:`Génère une recette pour: "${prompt}"\n\n${RECIPE_JSON_PROMPT}`);
    if(result)setForm(f=>({...f,...result,tags:Array.isArray(result.tags)?result.tags:f.tags}));
    setAnalyzing(false);
  };

  const save=async()=>{
    setSaving(true);
    const r=await notionCreate(DB_RECETTES,{
      "Nom":nTitle(form.nom),"Catégorie":nSel(form.categorie),"Temps de préparation":nNum(form.temps),
      "Portions":nNum(form.portions||DEFAULT_PORTIONS),"Ingrédients":nText(form.ingredients),
      "Instructions":nText(form.instructions),"Note":nSel(form.note),
      "Likes":nNum(0),"Dislikes":nNum(0),"Fois cuisinée":nNum(0),
      ...(form.photoUrl?{"Photo":nUrl(form.photoUrl)}:{}),
      ...(form.sourceUrl?{"Source":nUrl(form.sourceUrl)}:{}),
    });
    setSaving(false);
    if(!r||r.object==="error"){
      logError("AddRecipeModal.save",new Error(r?.message||"Échec de l'enregistrement Notion"),{nom:form.nom});
      alert("Échec de l'enregistrement dans Notion : "+(r?.message||"erreur inconnue")+". Réessaie.");
      return;
    }
    if(r.object==="skip"){
      alert("\""+form.nom+"\" existe déjà dans tes recettes — pas de doublon créé.");
      onClose();
      return;
    }
    setCache("recettes",null);
    if(queueTotal>1){
      // Mode lot : passer à la photo suivante au lieu de fermer
      await advanceQueue();
      return;
    }
    onSaved("Recette ajoutée ✓");
    onClose();
  };

  if(!method){
    return(<Modal title="Nouvelle recette" onClose={onClose}><p style={{color:"#64748B",fontSize:13,marginBottom:20,marginTop:0}}>Comment veux-tu ajouter cette recette ?</p><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>{METHODS.map(m=>(<button key={m.id} onClick={()=>setMethod(m.id)} style={{padding:"18px 12px",background:"#F1F5F9",border:"1px solid #E2E8F0",borderRadius:12,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:8}} onMouseEnter={e=>{e.currentTarget.style.borderColor=m.color;e.currentTarget.style.background=`${m.color}11`;}} onMouseLeave={e=>{e.currentTarget.style.borderColor="#E2E8F0";e.currentTarget.style.background="#F1F5F9";}}><div style={{width:40,height:40,borderRadius:"50%",background:`${m.color}22`,display:"flex",alignItems:"center",justifyContent:"center",color:m.color}}><Icon name={m.icon} size={18}/></div><span style={{fontSize:12,fontWeight:600,color:"#0F172A",textAlign:"center"}}>{m.label}</span></button>))}</div></Modal>);
  }

  const backBtn=<button onClick={()=>setMethod(null)} style={{background:"none",border:"none",color:"#C2622D",fontSize:12,cursor:"pointer",marginBottom:16,padding:0}}>← Changer de méthode</button>;

  if(method==="photo"){
    return(<Modal title="Recette depuis une photo" onClose={onClose} wide><input ref={fileInputRef} type="file" accept="image/*" multiple style={{display:"none"}} onChange={e=>handlePhotoFiles(e.target.files)}/><input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handlePhotoFile(e.target.files[0])}/>{backBtn}{queueTotal>1&&<div style={{marginBottom:12,padding:"10px 14px",background:"#FFF7ED",border:"1px solid #FDBA74",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}><span style={{fontSize:13,fontWeight:700,color:"#C2622D"}}>📚 Lot : recette {queueDone+1} sur {queueTotal}</span><span style={{fontSize:11,color:"#9A6A4A"}}>{photoQueue.length} en attente</span></div>}<div onClick={()=>fileInputRef.current?.click()} onDrop={e=>{e.preventDefault();handlePhotoFile(e.dataTransfer.files[0]);}} onDragOver={e=>e.preventDefault()} style={{marginBottom:20,borderRadius:12,overflow:"hidden",cursor:"pointer",border:`2px dashed ${photoPreview?"#F59E0B":"#E2E8F0"}`,background:"#F1F5F9"}}>{photoPreview?(<div style={{position:"relative"}}><img src={photoPreview} alt="preview" style={{width:"100%",height:180,objectFit:"cover",display:"block"}}/>{analyzing&&<div style={{position:"absolute",inset:0,background:"rgba(2,6,23,0.8)",display:"flex",alignItems:"center",justifyContent:"center",gap:12}}><div style={{animation:"spin 1s linear infinite",color:"#F59E0B"}}><Icon name="loader" size={24}/></div><span style={{color:"#FDE68A",fontSize:13,fontWeight:600}}>Analyse...</span></div>}{!analyzing&&<div style={{position:"absolute",bottom:8,left:8,background:"#4ADE80",borderRadius:20,padding:"4px 12px",fontSize:11,fontWeight:700,color:"#022c22"}}>✓ Recette reconnue</div>}</div>):(<div style={{padding:32,display:"flex",flexDirection:"column",alignItems:"center",gap:8,textAlign:"center"}}><div style={{width:48,height:48,borderRadius:"50%",background:"#F1F5F9",display:"flex",alignItems:"center",justifyContent:"center",color:"#F59E0B"}}><Icon name="camera" size={22}/></div><div style={{fontSize:13,fontWeight:600,color:"#64748B"}}>Photo du plat ou livre de recette</div></div>)}</div><div style={{display:"flex",gap:8,marginBottom:20}}><button onClick={e=>{e.stopPropagation();cameraInputRef.current?.click();}} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"12px",background:"#C2622D",border:"none",borderRadius:10,color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer"}}><Icon name="camera" size={16}/> Prendre une photo</button><button onClick={e=>{e.stopPropagation();fileInputRef.current?.click();}} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"12px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:10,color:"#475569",fontWeight:600,fontSize:13,cursor:"pointer"}}>🖼️ Choisir des fichiers</button></div>{(photoPreview&&!analyzing)&&<RecipeForm form={form} setForm={setForm} saving={saving} onSave={save} analyzing={analyzing}/>}{queueTotal>1&&!analyzing&&photoPreview&&<button onClick={advanceQueue} style={{width:"100%",marginTop:8,padding:"10px",background:"transparent",border:"1px solid #E2E8F0",borderRadius:10,color:"#64748B",fontSize:13,fontWeight:600,cursor:"pointer"}}>⏭ Ignorer cette photo</button>}</Modal>);
  }
  if(method==="url"){
    return(<Modal title="Recette depuis une URL" onClose={onClose} wide>{backBtn}<Field label="URL de la recette"><div style={{display:"flex",gap:8}}><input style={{...inputStyle,flex:1}} value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://www.marmiton.org/..."/><button onClick={fetchFromUrl} disabled={!url||analyzing} style={{padding:"10px 16px",background:url&&!analyzing?"#10B981":"#E2E8F0",border:"none",borderRadius:8,color:url&&!analyzing?"#fff":"#475569",fontWeight:600,fontSize:13,cursor:url&&!analyzing?"pointer":"default",whiteSpace:"nowrap"}}>{analyzing?<span style={{animation:"spin 1s linear infinite",display:"inline-block"}}><Icon name="loader" size={14}/></span>:"Extraire"}</button></div></Field>{form.nom&&<RecipeForm form={form} setForm={setForm} saving={saving} onSave={save} analyzing={analyzing}/>}</Modal>);
  }
  if(method==="ai"||method==="ingredients"){
    const color=method==="ai"?"#EC4899":"#14B8A6";
    return(<Modal title={method==="ai"?"Générer avec l'IA":"Recherche par ingrédients"} onClose={onClose} wide>{backBtn}<Field label={method==="ai"?"Décris la recette":"Quels ingrédients as-tu ?"}><div style={{display:"flex",flexDirection:"column",gap:8}}><textarea style={{...inputStyle,minHeight:80,resize:"vertical"}} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={method==="ai"?"Ex: pasta crémeuse au saumon fumé...":"Ex: j'ai des courgettes, du parmesan..."}/><button onClick={generateFromPrompt} disabled={!prompt||analyzing} style={{padding:"11px 16px",background:prompt&&!analyzing?color:"#E2E8F0",border:"none",borderRadius:8,color:prompt&&!analyzing?"#fff":"#475569",fontWeight:600,fontSize:13,cursor:prompt&&!analyzing?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>{analyzing?<><span style={{animation:"spin 1s linear infinite",display:"inline-block"}}><Icon name="loader" size={14}/></span>Génération...</>:<><Icon name="sparkle" size={14}/>Générer</>}</button></div></Field>{form.nom&&<RecipeForm form={form} setForm={setForm} saving={saving} onSave={save} analyzing={analyzing}/>}</Modal>);
  }
  return(<Modal title="Saisie manuelle" onClose={onClose} wide>{backBtn}<RecipeForm form={form} setForm={setForm} saving={saving} onSave={save} analyzing={false}/></Modal>);
}

// ── Recettes Tab ──────────────────────────────────────────────────────────────
function RecettesTab({toast}){
  const [recettes,setRecettes]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showAdd,setShowAdd]=useState(false);
  const [selected,setSelected]=useState(null);
  const [planningTarget,setPlanningTarget]=useState(null); // {recette, portions, mode}
  const [filter,setFilter]=useState("Toutes");
  const [sortBy,setSortBy]=useState("score");
  const [voting,setVoting]=useState(null);
  const [searchQuery,setSearchQuery]=useState("");

  const load=useCallback(async(force=false)=>{
    const cached=getCached("recettes");
    if(cached&&!force){setRecettes(cached);setLoading(false);return;}
    setLoading(true);
    try{const data=await notionQuery(DB_RECETTES);const parsed=(data.results||[]).map(parseRecette);setRecettes(parsed);setCache("recettes",parsed);}catch(e){console.error(e);}
    setLoading(false);
  },[]);

  useEffect(()=>{load();},[load]);

  const vote=async(r,type)=>{
    setVoting(r.id+type);
    const field=type==="up"?"Likes":"Dislikes";
    const current=type==="up"?(r.likes||0):(r.dislikes||0);
    const updated=recettes.map(x=>x.id===r.id?{...x,[type==="up"?"likes":"dislikes"]:current+1}:x);
    setRecettes(updated);setCache("recettes",updated);
    if(selected?.id===r.id)setSelected(prev=>({...prev,[type==="up"?"likes":"dislikes"]:current+1}));
    notionUpdate(r.id,{[field]:nNum(current+1)});
    setVoting(null);
  };

  const score=r=>(r.likes||0)-(r.dislikes||0);
  const cats=["Toutes","Déjeuner","Dîner","Dessert","Sauce & Marinade"];
  const q=searchQuery.toLowerCase().trim();
  const sorted=[...recettes].filter(r=>(filter==="Toutes"||r.categorie===filter)&&(!q||r.nom?.toLowerCase().includes(q)||r.ingredients?.toLowerCase().includes(q))).sort((a,b)=>{
    if(sortBy==="score")return score(b)-score(a);
    if(sortBy==="cuisinee")return(b.fois_cuisinee||0)-(a.fois_cuisinee||0);
    if(sortBy==="recent"){if(!a.derniere_cuisson)return 1;if(!b.derniere_cuisson)return -1;return new Date(a.derniere_cuisson)-new Date(b.derniere_cuisson);}
    return 0;
  });

  return(
    <div>
      {/* Barre de recherche */}
      <div style={{marginBottom:12}}>
        <div style={{position:"relative"}}>
          <input
            value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}
            placeholder="Rechercher une recette ou un ingrédient..."
            style={{width:"100%",padding:"10px 14px 10px 36px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:10,fontSize:13,color:"#0F172A",outline:"none",fontFamily:"inherit"}}
          />
          <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#94A3B8",fontSize:14}}>🔍</span>
          {searchQuery&&<button onClick={()=>setSearchQuery("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#94A3B8",cursor:"pointer",fontSize:16,lineHeight:1}}>✕</button>}
        </div>
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,gap:12,flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {cats.map(c=>(<button key={c} onClick={()=>setFilter(c)} style={{padding:"6px 14px",borderRadius:20,fontSize:12,fontWeight:600,cursor:"pointer",border:"1px solid",borderColor:filter===c?"#C2622D":"#E2E8F0",background:filter===c?"#C2622D":"transparent",color:filter===c?"#fff":"#94A3B8"}}>{c}</button>))}
        </div>
        <div style={{display:"flex",gap:8}}>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{...inputStyle,width:"auto",fontSize:12,padding:"6px 10px"}}><option value="score">Score</option><option value="cuisinee">Plus cuisinée</option><option value="recent">À refaire</option></select>
          <button onClick={()=>load(true)} style={{padding:"8px 10px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:8,color:"#64748B",cursor:"pointer"}}><Icon name="refresh" size={14}/></button>
          <button onClick={async()=>{toast("Récupération des photos...");const res=await fetch('/api/sync-photos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});const data=await res.json();toast(`Photos: ${data.updated} mises à jour ✓`);load(true);}} title="Récupérer les photos" style={{padding:"8px 10px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:8,color:"#F59E0B",cursor:"pointer",fontSize:11,fontWeight:600}}>📷</button>
          <button onClick={()=>setShowAdd(true)} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 16px",background:"#C2622D",border:"none",borderRadius:8,color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer"}}><Icon name="plus" size={16}/>Nouvelle</button>
        </div>
      </div>

      {loading?<Spinner label="Chargement des recettes..."/>:(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))",gap:14}}>
          {sorted.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",padding:48,color:"#64748B"}}><div style={{fontSize:40,marginBottom:12}}>📖</div><div style={{fontSize:14}}>Aucune recette.</div></div>}
          {sorted.map((r,i)=>(
            <div key={i} style={{background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:12,overflow:"hidden",cursor:"pointer",transition:"border-color 0.15s,transform 0.15s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor="#C2622D";e.currentTarget.style.transform="translateY(-2px)";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="#E2E8F0";e.currentTarget.style.transform="translateY(0)";}}>
              {r.photo&&<img src={r.photo} alt={r.nom} style={{width:"100%",height:120,objectFit:"cover",display:"block"}} onError={e=>e.target.style.display="none"} onClick={()=>setSelected(r)}/>}
              <div style={{padding:14}} onClick={()=>setSelected(r)}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                  <h4 style={{margin:0,fontSize:13,fontWeight:700,color:"#0F172A",fontFamily:"'Playfair Display', serif",lineHeight:1.3,flex:1,marginRight:8}}>{r.nom||"Sans titre"}</h4>
                  <ScoreBadge score={score(r)}/>
                </div>
                {r.categorie&&<span style={{fontSize:11,fontWeight:600,padding:"3px 8px",borderRadius:4,background:"#F1F5F9",color:"#64748B"}}>{r.categorie}</span>}
                <div style={{marginTop:8,display:"flex",gap:10,fontSize:11,color:"#64748B",flexWrap:"wrap"}}>
                  {r.temps>0&&<span>⏱ {r.temps}min</span>}
                  {r.fois_cuisinee>0&&<span>🍳 {r.fois_cuisinee}x</span>}
                </div>
              </div>
              <div style={{display:"flex",gap:0,borderTop:"1px solid #E2E8F0"}} onClick={e=>e.stopPropagation()}>
                <button onClick={()=>vote(r,"up")} disabled={voting===r.id+"up"} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"8px",background:"transparent",border:"none",borderRight:"1px solid #E2E8F0",color:"#4ADE80",cursor:"pointer",fontSize:12,fontWeight:600}}><Icon name="thumb_up" size={12}/>{r.likes||0}</button>
                <button onClick={()=>vote(r,"down")} disabled={voting===r.id+"down"} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"8px",background:"transparent",border:"none",color:"#F87171",cursor:"pointer",fontSize:12,fontWeight:600}}><Icon name="thumb_down" size={12}/>{r.dislikes||0}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd&&<AddRecipeModal onClose={()=>setShowAdd(false)} onSaved={(msg)=>{toast(msg);load(true);}}/>}

      {selected&&!planningTarget&&(
        <RecipeDetailModal
          recette={selected}
          onClose={()=>setSelected(null)}
          toast={toast}
          onAddToCourses={()=>{}}
          onAddToPlanning={(r,p,mode)=>setPlanningTarget({recette:r,portions:p,mode})}
          onDelete={(id)=>{const upd=recettes.filter(x=>x.id!==id);setRecettes(upd);setCache("recettes",upd);setSelected(null);}}
          onUpdate={(updated)=>{const upd=recettes.map(x=>x.id===updated.id?updated:x);setRecettes(upd);setCache("recettes",upd);setSelected(updated);}}
        />
      )}

      {planningTarget&&(
        <AddToPlanningModal
          recette={planningTarget.recette}
          portions={planningTarget.portions}
          mode={planningTarget.mode}
          onClose={()=>{setPlanningTarget(null);setSelected(null);}}
          toast={toast}
        />
      )}
    </div>
  );
}

// ── Planning Tab ──────────────────────────────────────────────────────────────
function CoursesModal({onClose,coursesSelection,setCoursesSelection,recettes,groupMode,setGroupMode,toast}){
  const [generatingCourses,setGeneratingCourses]=useState(false);
  const btnSmall={padding:"3px 10px",fontSize:11,fontWeight:600,border:"1px solid #E2E8F0",borderRadius:6,background:"#FFFFFF",color:"#475569",cursor:"pointer"};

  const semaine=new Date().toLocaleDateString("fr-FR",{day:"numeric",month:"short"});

  // Construire liste aplatie d'ingrédients
  const buildIngredients=(selection)=>{
    const list=[];
    for(const meal of selection){
      const recetteNom=meal.recette||meal.repas;
      const recetteData=recettes.find(r=>r.id===meal.recette_id||r.nom===recetteNom);
      if(!recetteData?.ingredients)continue;
      // Parser partagé : découpe (lignes ou bloc virgulé) + extraction canonique.
      for(const parsed of splitIngredientLines(recetteData.ingredients).map(parseOneIngredient)){
        if(!parsed.name)continue;
        list.push({
          nom:parsed.name,
          qty:parsed.qty,          // number|null
          unit:parsed.unit,        // unité canonique
          raw:parsed.original,     // texte d'origine (pour summands lisibles)
          recette:recetteNom,
          categorie:guessCategory(parsed.name),
          semaine:`Sem. du ${semaine}`,
        });
      }
    }
    // Agrégation : clé normalisée conservatrice, quantités combinées par famille d'unités.
    const merged={};
    for(const item of list){
      const key=normalizeKey(item.nom);
      if(!merged[key]){
        merged[key]={...item,recettes:[item.recette]};
      } else {
        const m=merged[key];
        if(!m.recettes.includes(item.recette))m.recettes.push(item.recette);
        m.qtyDisplay=combineQuantities(
          {qty:m.qty??null,unit:m.unit||"",raw:m.qtyDisplay||m.raw||(m.qty!=null?`${m.qty} ${m.unit}`.trim():"")},
          {qty:item.qty??null,unit:item.unit||"",raw:item.raw||(item.qty!=null?`${item.qty} ${item.unit}`.trim():"")}
        );
        // après une fusion, on ne garde plus une qty numérique unique fiable
        m.qty=null;m.unit="";
      }
    }
    return Object.values(merged).map(m=>({
      ...m,
      // quantité d'affichage : soit le résultat combiné, soit la forme simple d'origine
      qty:m.qtyDisplay||(m.qty!=null?`${m.qty} ${m.unit}`.trim():(m.raw&&m.raw!==m.nom?m.raw.replace(m.nom,"").trim():"")),
      recette:m.recettes.join(", "),
    }));
  };

  // Déduplication recettes par nom
  const [addedRecettes]=useState(()=>new Set());
  const [ingsList,setIngsList]=useState(()=>buildIngredients(coursesSelection.filter(m=>m.selected)).map(i=>({...i,selected:true})));

  // Reconstruire quand la sélection recettes change
  const selRecettes=coursesSelection.filter(m=>m.selected);
  const allIngs=ingsList;
  const totalSel=ingsList.filter(i=>i.selected).length;

  // Grouper
  const grouped={};
  ingsList.forEach((ing,idx)=>{
    const key=groupMode==="recette"?ing.recette:ing.categorie;
    if(!grouped[key])grouped[key]=[];
    grouped[key].push({...ing,_idx:idx});
  });
  const groups=Object.entries(grouped);

  const toggleRecette=(i)=>{
    const recNom=coursesSelection[i].recette||coursesSelection[i].repas;
    const newSel=coursesSelection.map((x,j)=>j===i?{...x,selected:!x.selected}:x);
    setCoursesSelection(newSel);
    const newSelRecettes=newSel.filter(m=>m.selected);
    setIngsList(buildIngredients(newSelRecettes).map(ing=>({...ing,selected:true})));
  };

  const toggleIng=(idx)=>setIngsList(l=>l.map((x,i)=>i===idx?{...x,selected:!x.selected}:x));
  const toggleGroup=(idxs,val)=>setIngsList(l=>l.map((x,i)=>idxs.has(i)?{...x,selected:val}:x));
  const toggleAllIngs=(val)=>setIngsList(l=>l.map(x=>({...x,selected:val})));
  const toggleAllRecettes=(val)=>{
    const newSel=coursesSelection.map(x=>({...x,selected:val}));
    setCoursesSelection(newSel);
    setIngsList(buildIngredients(newSel.filter(m=>m.selected)).map(i=>({...i,selected:true})));
  };

  const doImport=async()=>{
    setGeneratingCourses(true);
    const toImport=ingsList.filter(i=>i.selected);
    // Fermer immédiatement la modale
    onClose();
    let ok=0;
    const newItems=[];
    for(const ing of toImport){
      try{
        const created=await notionCreate(DB_COURSES,{
          "Article":nTitle(ing.nom),"Catégorie":nSel(ing.categorie),
          "Quantité":nText(ing.qty),
          "Semaine":nText(ing.semaine),"Recette":nText(ing.recette),
        });
        if(created&&created.object!=="skip"){
          newItems.push({
            id:created.id,nom:ing.nom,categorie:ing.categorie,
            quantite:ing.qty,achete:false,semaine:ing.semaine,recette:ing.recette
          });
          ok++;
        }
      }catch(e){console.error(e);}
    }
    setGeneratingCourses(false);
    // Mettre à jour le cache courses directement sans recharger
    const existing=getCached("courses")||[];
    setCache("courses",[...existing,...newItems]);
    toast(ok+" article"+(ok>1?"s":"")+" ajouté"+(ok>1?"s":"")+" à la liste de courses ✓");
  };

  return(
    <Modal title="🛒 Générer la liste de courses" onClose={onClose} wide>
      <p style={{fontSize:13,color:"#64748B",marginBottom:16}}>File d'attente + repas planifiés sur 2 semaines. Décoche ce que tu as déjà.</p>

      {/* Toggle mode + actions globales */}
      <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:12,color:"#64748B"}}>Regrouper par :</span>
        <button onClick={()=>setGroupMode("recette")} style={{...btnSmall,background:groupMode==="recette"?"#C2622D":"#FFFFFF",color:groupMode==="recette"?"#fff":"#475569",borderColor:groupMode==="recette"?"#C2622D":"#E2E8F0"}}>🍽️ Recette</button>
        <button onClick={()=>setGroupMode("categorie")} style={{...btnSmall,background:groupMode==="categorie"?"#C2622D":"#FFFFFF",color:groupMode==="categorie"?"#fff":"#475569",borderColor:groupMode==="categorie"?"#C2622D":"#E2E8F0"}}>🏪 Catégorie</button>
        <div style={{marginLeft:"auto",display:"flex",gap:6}}>
          <button style={btnSmall} onClick={()=>toggleAllIngs(true)}>Tout cocher</button>
          <button style={btnSmall} onClick={()=>toggleAllIngs(false)}>Tout décocher</button>
        </div>
      </div>

      {/* Chips recettes */}
      <div style={{background:"#F8FAFC",border:"1px solid #E2E8F0",borderRadius:10,padding:12,marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <span style={{fontSize:12,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.06em"}}>Recettes incluses</span>
          <div style={{display:"flex",gap:6}}>
            <button style={btnSmall} onClick={()=>toggleAllRecettes(true)}>Tout cocher</button>
            <button style={btnSmall} onClick={()=>toggleAllRecettes(false)}>Tout décocher</button>
          </div>
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {coursesSelection.map((m,i)=>(
            <div key={i} onClick={()=>toggleRecette(i)}
              style={{display:"flex",alignItems:"center",gap:5,padding:"5px 10px",borderRadius:20,
                border:`1px solid ${m.selected?"#C2622D":"#E2E8F0"}`,
                background:m.selected?"rgba(194,98,45,0.08)":"#FFFFFF",
                cursor:"pointer",fontSize:12,fontWeight:500,color:m.selected?"#C2622D":"#64748B"}}>
              {m.selected&&<Icon name="check" size={10}/>}{m.recette||m.repas}
            </div>
          ))}
        </div>
      </div>

      {/* Ingrédients groupés */}
      {ingsList.length===0&&<p style={{fontSize:13,color:"#64748B",textAlign:"center",padding:"16px 0"}}>Aucun ingrédient trouvé — les recettes ont-elles des ingrédients renseignés ?</p>}
      {groups.map(([groupKey,items])=>(
        <div key={groupKey} style={{marginBottom:10,background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:10,overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 14px",background:"#F8FAFC",borderBottom:"1px solid #E2E8F0"}}>
            <span style={{fontSize:12,fontWeight:700,color:"#0F172A"}}>{groupKey}</span>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontSize:11,color:"#94A3B8"}}>{items.filter(i=>ingsList[i._idx]?.selected).length}/{items.length}</span>
              <button style={btnSmall} onClick={()=>toggleGroup(new Set(items.map(i=>i._idx)),true)}>Tout cocher</button>
              <button style={btnSmall} onClick={()=>toggleGroup(new Set(items.map(i=>i._idx)),false)}>Tout décocher</button>
            </div>
          </div>
          {items.map((ing,j)=>{
            const isSel=ingsList[ing._idx]?.selected!==false;
            return(
            <div key={j} onClick={()=>toggleIng(ing._idx)}
              style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px",
                borderBottom:j<items.length-1?"1px solid #F1F5F9":"none",cursor:"pointer",
                background:isSel?"#FFFFFF":"#FAFAFA",opacity:isSel?1:0.5}}>
              <div style={{width:16,height:16,borderRadius:3,border:`1.5px solid ${isSel?"#C2622D":"#CBD5E1"}`,
                background:isSel?"#C2622D":"#FFFFFF",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {isSel&&<Icon name="check" size={10}/>}
              </div>
              <span style={{flex:1,fontSize:13,color:"#0F172A",textDecoration:isSel?"none":"line-through"}}>{ing.nom}</span>
              {ing.qty&&<span style={{fontSize:12,color:"#94A3B8",marginRight:4}}>{ing.qty}</span>}
              {groupMode==="categorie"&&<span style={{fontSize:11,color:"#CBD5E1",fontStyle:"italic"}}>{ing.recette}</span>}
            </div>
            );
          })}
        </div>
      ))}

      <button disabled={generatingCourses||totalSel===0} onClick={doImport}
        style={totalSel>0&&!generatingCourses?{...btnPrimary,marginTop:8,width:"100%"}:{...btnDisabled,marginTop:8,width:"100%"}}>
        {generatingCourses?"Ajout en cours...":"Ajouter "+totalSel+" article"+(totalSel>1?"s":"")+" à la liste de courses"}
      </button>
    </Modal>
  );
}

// ── Assistant Planifier ma semaine ────────────────────────────────────────────
// Semaine type : 7 dîners + 2 déjeuners (samedi, dimanche)
function WeekPlannerWizard({recettes,planning,onClose,onConfirm,toast}){
  const [saving,setSaving]=useState(false);
  const [discoveryPool,setDiscoveryPool]=useState([]);
  const [discoveryLoading,setDiscoveryLoading]=useState(true);

  // Charger ~6 recettes découverte (Spoonacular) pour injection à ~25%
  useEffect(()=>{
    const month=new Date().getMonth()+1;
    const saison=month>=3&&month<=5?"printemps":month>=6&&month<=8?"été":month>=9&&month<=11?"automne":"hiver";
    fetch("/api/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:`plat familial ${saison} facile`})})
      .then(r=>r.json())
      .then(d=>{
        const pool=(d.results||[]).filter(r=>r.spoonacularId).slice(0,6)
          .map(r=>({...r,isDiscovery:true,nom:r.titre}));
        setDiscoveryPool(pool);
      })
      .catch(()=>{})
      .finally(()=>setDiscoveryLoading(false));
  },[]);

  // Slots de la semaine prochaine (lundi → dimanche)
  const buildSlots=()=>{
    const now=new Date();const day=now.getDay();
    const monday=new Date(now);monday.setDate(now.getDate()-(day===0?6:day-1)+7); // semaine prochaine
    const slots=[];
    for(let i=0;i<7;i++){
      const d=new Date(monday);d.setDate(monday.getDate()+i);
      const dateStr=d.toISOString().split("T")[0];
      slots.push({date:dateStr,moment:"Dîner",label:d.toLocaleDateString("fr-FR",{weekday:"short",day:"numeric"})});
      if(i===5||i===6){ // samedi, dimanche → déjeuner aussi
        slots.push({date:dateStr,moment:"Déjeuner",label:d.toLocaleDateString("fr-FR",{weekday:"short",day:"numeric"})});
      }
    }
    return slots.sort((a,b)=>a.date.localeCompare(b.date)||( a.moment==="Déjeuner"?-1:1));
  };

  // Détection poisson / pâtes par mots-clés (nom + ingrédients)
  const FISH_KW=/saumon|cabillaud|lieu|poisson|thon|crevette|truite|dorade|daurade|bar\b|colin|merlu|sole|maquereau|sardine|moule|fruits de mer|gambas|encornet|calamar/i;
  const PASTA_KW=/p[âa]tes|spaghetti|penne|tagliatelle|lasagne|rigatoni|macaroni|linguine|fusilli|gnocchi|nouilles|orzo|coquillette|farfalle|ravioli|cannelloni/i;
  const isFish=r=>FISH_KW.test((r.nom||"")+" "+(r.ingredients||""));
  const isPasta=r=>PASTA_KW.test((r.nom||"")+" "+(r.ingredients||""));

  // Scorer + sélection sous contraintes :
  // - jamais 2x la même recette (garanti par le pool)
  // - max 3 plats de pâtes / semaine
  // - ≥1 poisson si aucun poisson cuisiné dans les 7 derniers jours
  const suggestRecettes=(count)=>{
    const scored=[...recettes]
      .filter(r=>!["Dessert","Sauce & Marinade"].includes(r.categorie))
      .map(r=>{
        let score=0;
        if(!r.derniere_cuisson)score+=100;
        else score+=Math.min((Date.now()-new Date(r.derniere_cuisson).getTime())/(1000*3600*24),90);
        score+=((r.note||"").length)*5;
        score+=(r.likes||0)*3-(r.dislikes||0)*5;
        score+=Math.random()*15;
        return {r,score};
      }).sort((a,b)=>b.score-a.score);

    // Sélection greedy avec cap pâtes
    const picked=[];
    let pastaCount=0;
    for(const {r} of scored){
      if(picked.length>=count)break;
      if(isPasta(r)){
        if(pastaCount>=3)continue;
        pastaCount++;
      }
      picked.push(r);
    }

    // Règle poisson : si aucun poisson dans la sélection ET aucun cuisiné ces 7 derniers jours
    const hasFishPicked=picked.some(isFish);
    if(!hasFishPicked){
      const weekAgo=new Date(Date.now()-7*24*3600*1000).toISOString().split("T")[0];
      const fishRecently=planning.some(p=>p.fait&&p.date&&p.date>=weekAgo&&(()=>{
        const r=recettes.find(x=>x.id===p.recette_id||x.nom===(p.recette||p.repas));
        return r&&isFish(r);
      })());
      if(!fishRecently){
        const bestFish=scored.find(({r})=>isFish(r)&&!picked.includes(r));
        if(bestFish){
          // Remplacer la moins bien scorée non-poisson
          for(let i=picked.length-1;i>=0;i--){
            if(!isFish(picked[i])){picked[i]=bestFish.r;break;}
          }
        }
      }
    }
    return picked;
  };

  const slots=useRef(buildSlots()).current;
  const [assignments,setAssignments]=useState(()=>{
    const sugg=suggestRecettes(slots.length);
    return slots.map((slot,i)=>({...slot,recette:sugg[i]||null,accepted:true}));
  });

  // Quand le pool découverte arrive : remplacer ~25% des slots (jamais 2 consécutifs)
  useEffect(()=>{
    if(discoveryPool.length===0)return;
    setAssignments(prev=>{
      const count=Math.max(1,Math.round(prev.length*0.25));
      const next=[...prev];
      let placed=0;
      for(let i=1;i<next.length&&placed<count&&placed<discoveryPool.length;i+=3){
        next[i]={...next[i],recette:discoveryPool[placed]};
        placed++;
      }
      return next;
    });
  },[discoveryPool]);

  const swapRecette=(idx)=>{
    const used=new Set(assignments.filter(a=>a.recette).map(a=>a.recette.id||a.recette.spoonacularId));
    const localPool=recettes.filter(r=>!used.has(r.id)&&!["Dessert","Sauce & Marinade"].includes(r.categorie));
    const discPool=discoveryPool.filter(r=>!used.has(r.spoonacularId));
    // 25% de chance de proposer une découverte si dispo
    const useDiscovery=discPool.length>0&&Math.random()<0.25;
    const pool=useDiscovery?discPool:localPool.length>0?localPool:discPool;
    if(pool.length===0){toast("Plus de recettes disponibles");return;}
    const next=pool[Math.floor(Math.random()*pool.length)];
    setAssignments(a=>a.map((x,i)=>i===idx?{...x,recette:next}:x));
  };

  const toggleSlot=(idx)=>{
    setAssignments(a=>a.map((x,i)=>i===idx?{...x,accepted:!x.accepted}:x));
  };

  const confirm=async()=>{
    setSaving(true);
    const toCreate=assignments.filter(a=>a.accepted&&a.recette);
    let ok=0;
    for(const a of toCreate){
      try{
        let recetteId=a.recette.id;
        let recetteNom=a.recette.nom;
        // Recette découverte → import Spoonacular dans Notion d'abord (0 crédit Claude)
        if(a.recette.isDiscovery&&a.recette.spoonacularId){
          const full=await fetch("/api/spoonacular-recipe?id="+a.recette.spoonacularId).then(r=>r.json());
          if(full?.nom){
            const created=await notionCreate(DB_RECETTES,{
              "Nom":nTitle(full.nom),"Catégorie":nSel(full.categorie||"Dîner"),
              "Temps de préparation":nNum(full.temps),"Portions":nNum(full.portions||DEFAULT_PORTIONS),
              "Ingrédients":nText(full.ingredients||""),"Instructions":nText(full.instructions||""),
              "Likes":nNum(0),"Dislikes":nNum(0),"Fois cuisinée":nNum(0),
              ...(full.source?{"Source":nUrl(full.source)}:{}),
              ...(full.photo?{"Photo":nUrl(full.photo)}:{}),
            });
            recetteId=created?.object==="skip"?created.existing.id:created.id;
            recetteNom=full.nom;
          }
        }
        await notionCreate(DB_PLANNING,{
          "Repas":nTitle(recetteNom),
          "Date":nDate(a.date),
          "Moment":nSel(a.moment),
          "Recette":nText(recetteNom),
          "Recette ID":nText(recetteId||""),
          "Portions":nNum(a.recette.portions||DEFAULT_PORTIONS),
          "File d'attente":nCheck(false),
        });
        ok++;
      }catch(e){logError("weekPlanner",e,{recette:a.recette.nom});}
    }
    setSaving(false);
    toast(ok+" repas planifiés pour la semaine prochaine ✓");
    onConfirm();
  };

  return(
    <div style={{position:"fixed",inset:0,zIndex:2500,background:"rgba(15,23,42,0.6)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div className="modal-inner" style={{background:"#FFFFFF",borderRadius:16,maxWidth:520,width:"100%",maxHeight:"85vh",overflow:"auto",padding:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
          <h3 style={{margin:0,fontSize:17,fontWeight:700,color:"#0F172A",fontFamily:"'Playfair Display',serif"}}>🗓️ Planifier ma semaine</h3>
          <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"#94A3B8",fontSize:18}}>✕</button>
        </div>
        <p style={{fontSize:12,color:"#64748B",marginTop:0,marginBottom:14}}>Semaine prochaine · 7 dîners + week-end déjeuners. Les recettes les moins cuisinées récemment sont proposées en premier. ↻ pour changer, décocher pour sauter.</p>

        {assignments.map((a,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 10px",background:a.accepted?"#FFFFFF":"#F8FAFC",border:"1px solid #E2E8F0",borderRadius:10,marginBottom:6,opacity:a.accepted?1:0.5}}>
            <input type="checkbox" checked={a.accepted} onChange={()=>toggleSlot(i)} style={{width:18,height:18,accentColor:"#C2622D",flexShrink:0}}/>
            <div style={{width:64,flexShrink:0}}>
              <div style={{fontSize:11,fontWeight:700,color:"#C2622D",textTransform:"capitalize"}}>{a.label}</div>
              <div style={{fontSize:10,color:"#94A3B8"}}>{a.moment}</div>
            </div>
            <span style={{flex:1,fontSize:13,color:"#0F172A",fontWeight:500,lineHeight:1.3}}>
              {a.recette?a.recette.nom:"—"}
              {a.recette?.isDiscovery&&<span style={{fontSize:10,color:"#7C3AED",marginLeft:6,background:"#F5F3FF",padding:"1px 6px",borderRadius:8}}>✨ Découverte</span>}
              {a.recette&&!a.recette.isDiscovery&&!a.recette.derniere_cuisson&&<span style={{fontSize:10,color:"#16A34A",marginLeft:6}}>jamais cuisinée</span>}
            </span>
            <button onClick={()=>swapRecette(i)} title="Changer" style={{background:"none",border:"1px solid #E2E8F0",borderRadius:6,padding:"4px 8px",cursor:"pointer",color:"#64748B",fontSize:13,flexShrink:0}}>↻</button>
          </div>
        ))}

        <button onClick={confirm} disabled={saving||assignments.filter(a=>a.accepted&&a.recette).length===0}
          style={{width:"100%",padding:"12px",background:saving?"#E2E8F0":"#C2622D",border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:14,cursor:saving?"wait":"pointer",marginTop:8}}>
          {saving?"Planification en cours…":"✓ Planifier "+assignments.filter(a=>a.accepted&&a.recette).length+" repas"}
        </button>
      </div>
    </div>
  );
}

// Date par défaut pour la planification : aujourd'hui, ou demain s'il est 18:00 passé.
// (Le soir, on planifie généralement pour le lendemain.)
function defaultPlanningDate(){
  const now=new Date();
  const d=new Date(now);
  if(now.getHours()>=18) d.setDate(d.getDate()+1);
  return d.toISOString().split("T")[0];
}

function PlanningTab({toast}){
  const [planning,setPlanning]=useState([]);
  const [recettes,setRecettes]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showForm,setShowForm]=useState(false);
  const [weekOffset,setWeekOffset]=useState(0);
  const [dragItem,setDragItem]=useState(null);
  const [dragOver,setDragOver]=useState(null);
  const touchDragRef=useRef(null); // {item, ghost, startX, startY}

  // Cleanup global si touch annulé ou changement de page
  useEffect(()=>{
    const cleanup=()=>{
      if(touchDragRef.current?.ghost){
        try{touchDragRef.current.ghost.remove();}catch(e){}
        touchDragRef.current=null;
      }
      setDragItem(null);setDragOver(null);
    };
    window.addEventListener("touchcancel",cleanup);
    return()=>{
      window.removeEventListener("touchcancel",cleanup);
      cleanup(); // nettoyage au unmount du composant
    };
  },[]);
  const [confirming,setConfirming]=useState(null);
  const [form,setForm]=useState({recetteQuery:"",recetteId:"",moment:"Dîner",portions:DEFAULT_PORTIONS,notes:"",date:"",queue:false});
  const [suggestions,setSuggestions]=useState([]);
  const [saving,setSaving]=useState(false);
  const [showCoursesModal,setShowCoursesModal]=useState(false);
  const [coursesSelection,setCoursesSelection]=useState([]);
  const [groupMode,setGroupMode]=useState("recette");
  const [selectedMealRecette,setSelectedMealRecette]=useState(null);
  const [selectedMealPlanning,setSelectedMealPlanning]=useState(null);
  const [planningTargetFromDetail,setPlanningTargetFromDetail]=useState(null);
  const [overdueMeals,setOverdueMeals]=useState(null);
  const [overdueProcessing,setOverdueProcessing]=useState({});
  const [showWeekWizard,setShowWeekWizard]=useState(false);

  const getWeekDates=(offset=0)=>{
    const now=new Date();const day=now.getDay();
    const monday=new Date(now);monday.setDate(now.getDate()-(day===0?6:day-1)+offset*7);
    return Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setDate(monday.getDate()+i);return d;});
  };
  const weekDates=getWeekDates(weekOffset);

  const load=useCallback(async(force=false)=>{
    const cachedP=getCached("planning");
    const cachedR=getCached("recettes");
    if(cachedP&&!force)setPlanning(cachedP);
    else{
      setLoading(true);
      try{const data=await notionQuery(DB_PLANNING);const parsed=(data.results||[]).map(parsePlanning);setPlanning(parsed);setCache("planning",parsed);}catch(e){console.error(e);}
    }
    if(cachedR&&!force)setRecettes(cachedR);
    else{
      try{const data=await notionQuery(DB_RECETTES);const parsed=(data.results||[]).map(parseRecette);setRecettes(parsed);setCache("recettes",parsed);}catch(e){console.error(e);}
    }
    setLoading(false);
  },[weekOffset]);

  useEffect(()=>{load();},[load]);

  // Détection des repas planifiés dans le passé non cuisinés (1x par session)
  useEffect(()=>{
    if(overdueMeals!==null||planning.length===0)return;
    const snooze=localStorage.getItem("overdueSnoozeUntil");
    if(snooze&&new Date().toISOString().split("T")[0]<snooze)return;
    if(sessionStorage.getItem("overdueChecked"))return;
    const todayStr=new Date().toISOString().split("T")[0];
    const overdue=planning.filter(p=>!p.queue&&!p.fait&&p.date&&p.date<todayStr);
    if(overdue.length>0){
      setOverdueMeals(overdue);
    } else {
      setOverdueMeals([]);
    }
    sessionStorage.setItem("overdueChecked","1");
  },[planning,overdueMeals]);

  // Actions sur les repas en retard
  const handleOverdueAction=async(meal,action)=>{
    setOverdueProcessing(s=>({...s,[meal.id]:true}));
    try{
      if(action==="cancel"){
        // Archiver l'entrée planning
        await fetch(`/api/notion?path=/v1/pages/${meal.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({archived:true})});
        const updated=planning.filter(p=>p.id!==meal.id);
        setPlanning(updated);setCache("planning",updated);
      } else if(action==="done"){
        // Marquer cuisiné + incrémenter compteur recette
        await notionUpdate(meal.id,{"Cuisiné":nCheck(true)});
        const recetteData=recettes.find(r=>r.id===meal.recette_id||r.nom===(meal.recette||meal.repas));
        if(recetteData){
          await notionUpdate(recetteData.id,{
            "Fois cuisinée":nNum((recetteData.fois_cuisinee||0)+1),
            "Dernière cuisson":nDate(meal.date),
          });
        }
        const updated=planning.map(p=>p.id===meal.id?{...p,fait:true}:p);
        setPlanning(updated);setCache("planning",updated);
      } else if(action==="requeue"){
        // Remettre en file d'attente sans date
        await notionUpdate(meal.id,{"File d'attente":nCheck(true),"Date":nDate(null)});
        const updated=planning.map(p=>p.id===meal.id?{...p,queue:true,date:null}:p);
        setPlanning(updated);setCache("planning",updated);
      }
      // Retirer de la liste overdue
      setOverdueMeals(m=>m.filter(x=>x.id!==meal.id));
    }catch(e){
      logError("handleOverdueAction",e,{meal:meal.repas,action});
    }
    setOverdueProcessing(s=>({...s,[meal.id]:false}));
  };

  // Partage du menu de la semaine (WhatsApp / clipboard)
  const shareWeekMenu=()=>{
    const weekStart=weekDates[0].toISOString().split("T")[0];
    const weekEnd=weekDates[6].toISOString().split("T")[0];
    const meals=planning
      .filter(p=>!p.queue&&p.date&&p.date>=weekStart&&p.date<=weekEnd)
      .sort((a,b)=>a.date.localeCompare(b.date)||(a.moment==="Déjeuner"?-1:1));
    if(meals.length===0){toast("Aucun repas planifié cette semaine");return;}
    const lines=["🍽️ Menu de la semaine\n"];
    let lastDate="";
    for(const m of meals){
      if(m.date!==lastDate){
        lines.push("\n📅 "+new Date(m.date+"T00:00").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"}));
        lastDate=m.date;
      }
      lines.push(`  ${m.moment==="Déjeuner"?"☀️":"🌙"} ${m.recette||m.repas}${m.fait?" ✓":""}`);
    }
    lines.push("\n👨‍🍳 Recettes : https://meal-planner-psi-seven.vercel.app");
    const text=lines.join("\n");
    if(navigator.share){
      navigator.share({text}).catch(()=>{});
    } else {
      navigator.clipboard.writeText(text);
      toast("Menu copié — colle-le dans WhatsApp ✓");
    }
  };

  // Autocomplete
  useEffect(()=>{
    if(!form.recetteQuery||form.recetteQuery.length<2){setSuggestions([]);return;}
    const q=form.recetteQuery.toLowerCase();
    setSuggestions(recettes.filter(r=>r.nom.toLowerCase().includes(q)).slice(0,6));
  },[form.recetteQuery,recettes]);

  const save=async()=>{
    setSaving(true);
    const targetDate=form.queue?(()=>{const now=new Date();const day=now.getDay();const nextMonday=new Date(now);nextMonday.setDate(now.getDate()+(day===0?1:8-day));return nextMonday.toISOString().split("T")[0];})():form.date;
    await notionCreate(DB_PLANNING,{
      "Repas":nTitle(form.recetteQuery),"Date":nDate(targetDate),"Moment":nSel(form.moment),
      "Recette":nText(form.recetteQuery),"Recette ID":nText(form.recetteId),
      "Portions":nNum(form.portions),"Notes":nText(form.notes),"File d'attente":nCheck(form.queue),
    });
    toast("Repas ajouté ✓");setSaving(false);setShowForm(false);
    setForm({recetteQuery:"",recetteId:"",moment:"Dîner",portions:DEFAULT_PORTIONS,notes:"",date:"",queue:false});
    setCache("planning",null);load(true);
  };

  const confirmCuisine=async(meal)=>{
    setConfirming(meal.id);
    const updated=planning.map(p=>p.id===meal.id?{...p,fait:true}:p);
    setPlanning(updated);setCache("planning",updated);
    // Marquer comme fait dans Planning
    const updateRes=await notionUpdate(meal.id,{"Cuisiné":nCheck(true)});
    if(updateRes?.object==="error") console.error("confirmCuisine error:",updateRes.message);
    // Mettre à jour Fois cuisinée + Dernière cuisson dans DB Recettes
    const recetteData=recettes.find(r=>r.id===meal.recette_id||r.nom===(meal.recette||meal.repas));
    if(recetteData){
      const newCount=(recetteData.fois_cuisinee||0)+1;
      await notionUpdate(recetteData.id,{
        "Fois cuisinée":nNum(newCount),
        "Dernière cuisson":nDate(new Date().toISOString().split("T")[0]),
      });
    }
    toast(`"${meal.recette}" cuisiné ✓`);setConfirming(null);
  };

  // Annule une entrée de planning (archivage définitif)
  const cancelPlanningEntry=async(meal)=>{
    try{
      await fetch(`/api/notion?path=/v1/pages/${meal.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({archived:true})});
      const updated=planning.filter(p=>p.id!==meal.id);
      setPlanning(updated);setCache("planning",updated);
      toast(`"${meal.recette||meal.repas}" retiré du planning ✓`);
    }catch(e){logError("cancelPlanningEntry",e,{id:meal.id});toast("Erreur lors de l'annulation");}
    setSelectedMealRecette(null);setSelectedMealPlanning(null);
  };

  // Remet une entrée de planning en file d'attente (sans date)
  const requeuePlanningEntry=async(meal)=>{
    const updated=planning.map(p=>p.id===meal.id?{...p,queue:true,date:null}:p);
    setPlanning(updated);setCache("planning",updated);
    await notionUpdate(meal.id,{"File d'attente":nCheck(true),"Date":nDate(null)});
    toast(`"${meal.recette||meal.repas}" remis en file d'attente ✓`);
    setSelectedMealRecette(null);setSelectedMealPlanning(null);
  };

  // Drag and drop
  const handleDrop=async(targetDate,targetMoment)=>{
    if(!dragItem)return;
    const updated=planning.map(p=>p.id===dragItem.id?{...p,date:targetDate,moment:targetMoment,queue:false}:p);
    setPlanning(updated);setCache("planning",updated);
    notionUpdate(dragItem.id,{"Date":nDate(targetDate),"Moment":nSel(targetMoment),"File d'attente":nCheck(false)});
    toast(`"${dragItem.recette}" déplacé ✓`);
    setDragItem(null);setDragOver(null);
  };

  const isToday=d=>d.toDateString()===new Date().toDateString();
  const isPast=d=>d<new Date()&&!isToday(d);
  const getMeals=date=>planning.filter(p=>p.date===date.toISOString().split("T")[0]&&!p.queue);
  const getQueue=()=>planning.filter(p=>p.queue||(p.date&&p.date>=weekDates[0].toISOString().split("T")[0]&&p.date<=weekDates[6].toISOString().split("T")[0]&&!planning.find(x=>x.id===p.id&&!p.queue)));
  const queueItems=planning.filter(p=>p.queue);
  const [clearingQueue,setClearingQueue]=useState(false);
  const [confirmClearQueue,setConfirmClearQueue]=useState(false);

  // Retirer un item de la file : archive l'entrée planning (la recette reste dans Recettes)
  const removeFromQueue=async(item)=>{
    const updated=planning.filter(p=>p.id!==item.id);
    setPlanning(updated);setCache("planning",updated);
    try{
      await fetch(`/api/notion?path=/v1/pages/${item.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({archived:true})});
    }catch(e){logError("removeFromQueue",e,{item:item.recette||item.repas});}
  };

  // Vider toute la file d'attente
  const clearQueue=async()=>{
    setClearingQueue(true);
    const items=[...queueItems];
    const remaining=planning.filter(p=>!p.queue);
    setPlanning(remaining);setCache("planning",remaining);
    for(const item of items){
      try{
        await fetch(`/api/notion?path=/v1/pages/${item.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({archived:true})});
      }catch(e){logError("clearQueue",e,{item:item.recette||item.repas});}
    }
    setClearingQueue(false);setConfirmClearQueue(false);
    toast(items.length+" repas retirés de la file");
  };
  const weekLabel=()=>({0:"Cette semaine",1:"Semaine prochaine","-1":"Semaine dernière"}[weekOffset]||`Sem. ${weekOffset>0?"+":""}${weekOffset}`);

  const MealChip=({meal,onViewRecette,onMoveToQueue})=>{
    const longPressTimer=useRef(null);
    const isDragging=useRef(false);

    const touchStartPos=useRef(null);

    const handleTouchStart=(e)=>{
      isDragging.current=false;
      const touch=e.touches[0];
      touchStartPos.current={x:touch.clientX,y:touch.clientY};
      longPressTimer.current=setTimeout(()=>{
        isDragging.current=true;
        const ghost=e.currentTarget.cloneNode(true);
        ghost.style.cssText=`position:fixed;top:${touch.clientY-30}px;left:${touch.clientX-80}px;width:160px;opacity:0.85;z-index:9999;pointer-events:none;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.2);`;
        document.body.appendChild(ghost);
        touchDragRef.current={item:meal,ghost,startX:touch.clientX,startY:touch.clientY};
        setDragItem(meal);
      },400); // 400ms = long press plus sûr
    };

    const handleTouchMove=(e)=>{
      const touch=e.touches[0];
      if(!isDragging.current){
        // Annuler si mouvement trop important avant long press
        if(touchStartPos.current){
          const dx=Math.abs(touch.clientX-touchStartPos.current.x);
          const dy=Math.abs(touch.clientY-touchStartPos.current.y);
          if(dx>8||dy>8) clearTimeout(longPressTimer.current);
        }
        return;
      }
      if(!touchDragRef.current)return;
      e.preventDefault(); // Bloque scroll ET pull-to-refresh pendant le drag
      touchDragRef.current.ghost.style.top=touch.clientY-30+"px";
      touchDragRef.current.ghost.style.left=touch.clientX-80+"px";
      const el=document.elementFromPoint(touch.clientX,touch.clientY);
      const zone=el?.closest("[data-dropzone]");
      setDragOver(zone?.dataset.dropzone||null);
    };

    const handleTouchEnd=(e)=>{
      clearTimeout(longPressTimer.current);
      if(!isDragging.current){setDragItem(null);return;}
      if(!touchDragRef.current)return;
      const touch=e.changedTouches[0];
      const el=document.elementFromPoint(touch.clientX,touch.clientY);
      const zone=el?.closest("[data-dropzone]");
      if(zone){
        const key=zone.dataset.dropzone;
        if(key==="queue"){
          const updated=planning.map(p=>p.id===dragItem.id?{...p,queue:true}:p);
          setPlanning(updated);
          notionUpdate(dragItem.id,{"File d'attente":nCheck(true)});
          toast(`"${dragItem.recette}" remis en file d'attente ✓`);
        } else { handleDrop(key,"Dîner"); }
      }
      try{touchDragRef.current.ghost.remove();}catch(e){}
      touchDragRef.current=null;
      setDragItem(null);setDragOver(null);
      isDragging.current=false;
    };

    return(
    <div draggable onDragStart={()=>setDragItem(meal)} onDragEnd={()=>setDragItem(null)}
      onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
      style={{borderRadius:6,overflow:"hidden",marginBottom:4,opacity:dragItem?.id===meal.id?0.4:1,cursor:"grab"}}>
      <div style={{padding:"4px 7px",fontSize:11,fontWeight:600,background:`${MOMENT_COLORS[meal.moment]||"#64748B"}22`,color:MOMENT_COLORS[meal.moment]||"#94A3B8",lineHeight:1.3,textDecoration:meal.fait?"line-through":"none",opacity:meal.fait?0.5:1,display:"flex",alignItems:"center",gap:4}}>
        <Icon name="drag" size={8}/>
        <span style={{flex:1,cursor:"pointer"}} onClick={(e)=>{e.stopPropagation();onViewRecette&&onViewRecette(meal);}}>{meal.recette||meal.repas}</span>
      </div>
      <div style={{display:"flex",gap:2}}>
        <button onClick={(e)=>{e.stopPropagation();const updated=setPlanning?setPlanning:null;/* handled via prop */onMoveToQueue&&onMoveToQueue(meal);}} style={{flex:1,padding:"2px",background:"#F1F5F9",border:"none",color:"#94A3B8",fontSize:9,fontWeight:600,cursor:"pointer"}}>↩ File</button>
        {!meal.fait&&<button onClick={()=>confirmCuisine(meal)} disabled={confirming===meal.id} style={{flex:1,padding:"2px",background:"#F1F5F9",border:"none",color:"#94A3B8",fontSize:9,fontWeight:700,cursor:"pointer"}}>✓ Cuisiné</button>}
        {meal.fait&&<div style={{flex:1,padding:"2px 7px",background:"#D1FAE5",fontSize:9,color:"#065F46",fontWeight:700,textAlign:"center"}}>✓ fait</div>}
      </div>
    </div>
    );
  };

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <button onClick={()=>setWeekOffset(w=>w-1)} style={{background:"#F1F5F9",border:"none",borderRadius:6,color:"#64748B",cursor:"pointer",padding:"6px 10px",transform:"rotate(180deg)"}}><Icon name="arrow" size={16}/></button>
          <span style={{fontSize:14,fontWeight:700,color:"#0F172A"}}>{weekLabel()}</span>
          <button onClick={()=>setWeekOffset(w=>w+1)} style={{background:"#F1F5F9",border:"none",borderRadius:6,color:"#64748B",cursor:"pointer",padding:"6px 10px"}}><Icon name="arrow" size={16}/></button>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          <button onClick={()=>load(true)} style={{padding:"8px 10px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:8,color:"#64748B",cursor:"pointer"}}><Icon name="refresh" size={14}/></button>
          <button onClick={()=>{
            const today=new Date();today.setHours(0,0,0,0);
            const twoWeeksLater=new Date(today);twoWeeksLater.setDate(today.getDate()+14);
            const todayStr=today.toISOString().split("T")[0];
            const limitStr=twoWeeksLater.toISOString().split("T")[0];
            const planned=planning.filter(p=>!p.queue&&!p.fait&&p.date&&p.date>=todayStr&&p.date<=limitStr);
            const meals=[...queueItems.filter(m=>!m.fait),...planned];
            const unique=[];const seen=new Set();
            meals.forEach(m=>{const k=m.recette||m.repas;if(k&&!seen.has(k)){seen.add(k);unique.push(m);}});
            setCoursesSelection(unique.map(m=>({...m,selected:true})));
            setShowCoursesModal(true);
          }} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 12px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:8,color:"#64748B",cursor:"pointer",fontSize:13,fontWeight:600}}>
            <Icon name="cart" size={15}/><span className="btn-label">Courses</span>
          </button>
          <button onClick={shareWeekMenu} title="Partager le menu de la semaine" style={{display:"flex",alignItems:"center",gap:6,padding:"8px 12px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:8,color:"#64748B",cursor:"pointer",fontSize:13,fontWeight:600}}>
            📤
          </button>
          <button onClick={()=>setShowWeekWizard(true)} title="Planifier ma semaine" style={{display:"flex",alignItems:"center",gap:6,padding:"8px 12px",background:"#FFF7ED",border:"1px solid #FDBA74",borderRadius:8,color:"#C2622D",cursor:"pointer",fontSize:13,fontWeight:600}}>
            🗓️<span className="btn-label"> Semaine</span>
          </button>
          <button onClick={()=>{setForm(f=>({...f,date:defaultPlanningDate(),queue:false,recetteQuery:"",recetteId:""}));setShowForm(true);}} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 16px",background:"#C2622D",border:"none",borderRadius:8,color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer"}}><Icon name="plus" size={16}/><span className="btn-label">Ajouter</span></button>
        </div>
      </div>

      {loading?<Spinner label="Chargement..."/>:(
        <div>
          {/* Week grid */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6,marginBottom:16}} className="planning-grid">
            {weekDates.map((date,i)=>{
              const meals=getMeals(date);const today=isToday(date);const past=isPast(date);
              const dropKey=date.toISOString().split("T")[0];
              return(
                <div key={i}
                  onDragOver={e=>{e.preventDefault();setDragOver(dropKey);}}
                  onDragLeave={()=>setDragOver(null)}
                  onDrop={()=>handleDrop(dropKey,"Dîner")}
                  data-dropzone={dropKey}
                  style={{background:dragOver===dropKey?"#FEF3C7":today?"#FFF7ED":"#FFFFFF",border:`1px solid ${dragOver===dropKey?"#C2622D":today?"#C2622D":"#E2E8F0"}`,borderRadius:10,padding:8,minHeight:120,opacity:past?0.75:1,transition:"all 0.15s"}}>
                  <div className="day-header" style={{marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div>
                      <div style={{fontSize:10,fontWeight:600,color:today?"#C2622D":"#64748B",textTransform:"uppercase"}}>{DAYS[i].slice(0,3)}</div>
                      <div style={{fontSize:17,fontWeight:800,color:today?"#C2622D":"#0F172A",fontFamily:"'Playfair Display', serif"}}>{date.getDate()}</div>
                    </div>
                    <button onClick={()=>{setForm(f=>({...f,date:dropKey,queue:false,recetteQuery:"",recetteId:""}));setShowForm(true);}} title="Ajouter un repas ce jour" style={{background:"#FFF7ED",border:"1px solid #FDBA74",borderRadius:6,width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"#C2622D",fontSize:16,lineHeight:1,padding:0,flexShrink:0}}>+</button>
                  </div>
                  {meals.length===0&&<div style={{fontSize:10,color:"#94A3B8",textAlign:"center",paddingTop:8}}>—</div>}
                  {meals.map((m,j)=><MealChip key={j} meal={m}
  onViewRecette={(meal)=>{const r=recettes.find(x=>x.id===meal.recette_id||x.nom===(meal.recette||meal.repas));if(r){setSelectedMealRecette(r);setSelectedMealPlanning(meal);}}}
  onMoveToQueue={(meal)=>{
    const updated=planning.map(p=>p.id===meal.id?{...p,queue:true,date:null}:p);
    setPlanning(updated);
    notionUpdate(meal.id,{"File d'attente":nCheck(true),"Date":nDate(null)});
    toast(`"${meal.recette||meal.repas}" remis en file d'attente ✓`);
  }}
/>)}
                </div>
              );
            })}
          </div>

          {/* Queue */}
          <div style={{background:"#F1F5F9",border:"1px solid #E2E8F0",borderRadius:12,padding:16}}
            onDragOver={e=>{e.preventDefault();setDragOver("queue");}}
            onDragLeave={()=>setDragOver(null)}
            data-dropzone="queue"
            onDrop={async()=>{
              if(!dragItem)return;
              const updated=planning.map(p=>p.id===dragItem.id?{...p,queue:true}:p);
              setPlanning(updated);setCache("planning",updated);
              notionUpdate(dragItem.id,{"File d'attente":nCheck(true)});
              setDragItem(null);setDragOver(null);
            }}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              <Icon name="queue" size={14}/>
              <span style={{fontSize:12,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.08em"}}>File d'attente</span>
              <span style={{fontSize:11,color:"#64748B",marginLeft:"auto"}}>Glisser vers un jour</span>
              {queueItems.length>0&&!confirmClearQueue&&(
                <button onClick={()=>setConfirmClearQueue(true)} style={{fontSize:11,color:"#DC2626",background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:6,padding:"3px 10px",cursor:"pointer",fontWeight:600,fontFamily:"inherit"}}>Vider</button>
              )}
              {confirmClearQueue&&(
                <span style={{display:"flex",gap:6,alignItems:"center"}}>
                  <button onClick={()=>setConfirmClearQueue(false)} style={{fontSize:11,color:"#64748B",background:"#F1F5F9",border:"none",borderRadius:6,padding:"3px 10px",cursor:"pointer",fontWeight:600,fontFamily:"inherit"}}>Annuler</button>
                  <button disabled={clearingQueue} onClick={clearQueue} style={{fontSize:11,color:"#fff",background:"#DC2626",border:"none",borderRadius:6,padding:"3px 10px",cursor:"pointer",fontWeight:700,fontFamily:"inherit",opacity:clearingQueue?0.5:1}}>{clearingQueue?"...":"Tout retirer"}</button>
                </span>
              )}
            </div>
            {queueItems.length===0&&<div style={{fontSize:12,color:"#94A3B8",textAlign:"center",padding:"8px 0"}}>Vide — glisse ici pour mettre en attente</div>}
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {queueItems.map((m,i)=>(
                <div key={i} draggable onDragStart={()=>setDragItem(m)} onDragEnd={()=>setDragItem(null)}
                  onTouchStart={(e)=>{
                    const touch=e.touches[0];
                    const ghost=e.currentTarget.cloneNode(true);
                    ghost.style.cssText=`position:fixed;top:${touch.clientY-20}px;left:${touch.clientX-60}px;opacity:0.85;z-index:9999;pointer-events:none;border-radius:20px;padding:6px 12px;`;
                    document.body.appendChild(ghost);
                    touchDragRef.current={item:m,ghost};
                    setDragItem(m);
                  }}
                  onTouchMove={(e)=>{
                    if(!touchDragRef.current)return;
                    e.preventDefault();
                    const touch=e.touches[0];
                    touchDragRef.current.ghost.style.top=touch.clientY-20+"px";
                    touchDragRef.current.ghost.style.left=touch.clientX-60+"px";
                    const el=document.elementFromPoint(touch.clientX,touch.clientY);
                    const zone=el?.closest("[data-dropzone]");
                    setDragOver(zone?.dataset.dropzone||null);
                  }}
                  onTouchEnd={(e)=>{
                    if(!touchDragRef.current)return;
                    const touch=e.changedTouches[0];
                    const el=document.elementFromPoint(touch.clientX,touch.clientY);
                    const zone=el?.closest("[data-dropzone]");
                    if(zone&&zone.dataset.dropzone!=="queue"){
                      handleDrop(zone.dataset.dropzone,"Dîner");
                    }
                    touchDragRef.current.ghost.remove();
                    touchDragRef.current=null;
                    setDragItem(null);setDragOver(null);
                  }}
                  style={{padding:"6px 12px",background:`${MOMENT_COLORS[m.moment]||"#64748B"}22`,border:`1px solid ${MOMENT_COLORS[m.moment]||"#64748B"}44`,borderRadius:20,fontSize:12,fontWeight:600,color:MOMENT_COLORS[m.moment]||"#94A3B8",cursor:"grab",display:"flex",alignItems:"center",gap:6,opacity:dragItem?.id===m.id?0.4:1,touchAction:"none"}}>
                  <span onClick={e=>{e.stopPropagation();const r=recettes.find(x=>x.id===m.recette_id||x.nom===(m.recette||m.repas));if(r){setSelectedMealRecette(r);setSelectedMealPlanning(m);}}} style={{cursor:"pointer",flex:1}}>
                    <Icon name="drag" size={10}/>{m.recette||m.repas}
                  </span>
                  <button onClick={e=>{e.stopPropagation();removeFromQueue(m);}} onTouchStart={e=>e.stopPropagation()} title="Retirer de la file" style={{background:"none",border:"none",cursor:"pointer",color:MOMENT_COLORS[m.moment]||"#94A3B8",fontSize:14,lineHeight:1,padding:"0 2px",opacity:0.7,fontFamily:"inherit"}}>✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showWeekWizard&&(
        <WeekPlannerWizard
          recettes={recettes}
          planning={planning}
          toast={toast}
          onClose={()=>setShowWeekWizard(false)}
          onConfirm={()=>{setShowWeekWizard(false);setCache("planning",null);load(true);}}
        />
      )}

      {/* Popup repas en retard */}
      {overdueMeals&&overdueMeals.length>0&&(
        <div style={{position:"fixed",inset:0,zIndex:2500,background:"rgba(15,23,42,0.6)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div className="modal-inner" style={{background:"#FFFFFF",borderRadius:16,maxWidth:480,width:"100%",maxHeight:"80vh",overflow:"auto",padding:20}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
              <span style={{fontSize:24}}>⏰</span>
              <h3 style={{margin:0,fontSize:17,fontWeight:700,color:"#0F172A",fontFamily:"'Playfair Display',serif"}}>Repas non confirmés</h3>
            </div>
            <p style={{fontSize:13,color:"#64748B",marginTop:0,marginBottom:16}}>
              {overdueMeals.length} repas planifié{overdueMeals.length>1?"s":""} dans le passé n'{overdueMeals.length>1?"ont":"a"} pas été marqué{overdueMeals.length>1?"s":""} comme cuisiné{overdueMeals.length>1?"s":""}.
            </p>
            {overdueMeals.map(meal=>(
              <div key={meal.id} style={{border:"1px solid #E2E8F0",borderRadius:12,padding:"12px 14px",marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:10,gap:8}}>
                  <span style={{fontSize:14,fontWeight:600,color:"#0F172A"}}>{meal.recette||meal.repas}</span>
                  <span style={{fontSize:11,color:"#94A3B8",whiteSpace:"nowrap"}}>{new Date(meal.date+"T00:00").toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"})}{meal.moment?` · ${meal.moment}`:""}</span>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button disabled={overdueProcessing[meal.id]} onClick={()=>handleOverdueAction(meal,"done")}
                    style={{flex:1,padding:"8px 4px",background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:8,color:"#16A34A",fontSize:12,fontWeight:600,cursor:"pointer",opacity:overdueProcessing[meal.id]?0.5:1}}>
                    ✓ Fait
                  </button>
                  <button disabled={overdueProcessing[meal.id]} onClick={()=>handleOverdueAction(meal,"requeue")}
                    style={{flex:1,padding:"8px 4px",background:"#FFF7ED",border:"1px solid #FDBA74",borderRadius:8,color:"#C2622D",fontSize:12,fontWeight:600,cursor:"pointer",opacity:overdueProcessing[meal.id]?0.5:1}}>
                    ↩ File d'attente
                  </button>
                  <button disabled={overdueProcessing[meal.id]} onClick={()=>handleOverdueAction(meal,"cancel")}
                    style={{flex:1,padding:"8px 4px",background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,color:"#DC2626",fontSize:12,fontWeight:600,cursor:"pointer",opacity:overdueProcessing[meal.id]?0.5:1}}>
                    ✕ Annuler
                  </button>
                </div>
              </div>
            ))}
            <div style={{display:"flex",gap:8,marginTop:4}}>
              <button onClick={()=>setOverdueMeals([])}
                style={{flex:1,padding:"10px",background:"transparent",border:"1px solid #E2E8F0",borderRadius:10,color:"#64748B",fontSize:13,cursor:"pointer"}}>
                Plus tard
              </button>
              <button onClick={()=>{
                const d=new Date();const day=d.getDay();
                const daysToMon=day===0?1:8-day; // prochain lundi
                d.setDate(d.getDate()+daysToMon);
                localStorage.setItem("overdueSnoozeUntil",d.toISOString().split("T")[0]);
                setOverdueMeals([]);
                toast("Rappel reporté à lundi");
              }} style={{flex:1,padding:"10px",background:"#F8FAFC",border:"1px solid #E2E8F0",borderRadius:10,color:"#475569",fontSize:13,fontWeight:600,cursor:"pointer"}}>
                💤 Jusqu'à lundi
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedMealRecette&&!planningTargetFromDetail&&(
        <RecipeDetailModal
          recette={selectedMealRecette}
          onClose={()=>{setSelectedMealRecette(null);setSelectedMealPlanning(null);}}
          toast={toast}
          onAddToCourses={()=>{}}
          onAddToPlanning={(r,p,mode)=>{setPlanningTargetFromDetail({recette:r,portions:p,mode});}}
          onUpdate={(updated)=>setSelectedMealRecette(updated)}
          onCookComplete={()=>{toast&&toast("Repas validé ✓");setCache("planning",null);load(true);}}
          planningEntry={selectedMealPlanning}
          onCancelPlanning={cancelPlanningEntry}
          onRequeuePlanning={requeuePlanningEntry}
        />
      )}
      {planningTargetFromDetail&&(
        <AddToPlanningModal
          recette={planningTargetFromDetail.recette}
          portions={planningTargetFromDetail.portions}
          mode={planningTargetFromDetail.mode}
          toast={toast}
          onClose={()=>{setPlanningTargetFromDetail(null);setSelectedMealRecette(null);setSelectedMealPlanning(null);}}
        />
      )}

      {showCoursesModal&&<CoursesModal
        onClose={()=>setShowCoursesModal(false)}
        coursesSelection={coursesSelection}
        setCoursesSelection={setCoursesSelection}
        recettes={recettes}
        groupMode={groupMode}
        setGroupMode={setGroupMode}
        toast={toast}
      />}

      {showForm&&(
        <Modal title="Ajouter au planning" onClose={()=>setShowForm(false)}>
          <Field label="Recette">
            <div style={{position:"relative"}}>
              <input style={inputStyle} value={form.recetteQuery} onChange={e=>setForm(f=>({...f,recetteQuery:e.target.value,recetteId:""}))} placeholder="Rechercher une recette..."/>
              {suggestions.length>0&&(
                <div style={{position:"absolute",top:"100%",left:0,right:0,background:"#F1F5F9",border:"1px solid #334155",borderRadius:8,zIndex:100,marginTop:4,overflow:"hidden"}}>
                  {suggestions.map((r,i)=>(
                    <div key={i} onClick={()=>{setForm(f=>({...f,recetteQuery:r.nom,recetteId:r.id}));setSuggestions([]);}}
                      style={{padding:"10px 14px",cursor:"pointer",fontSize:13,color:"#0F172A",display:"flex",alignItems:"center",gap:10,borderBottom:"1px solid #334155"}}
                      onMouseEnter={e=>e.currentTarget.style.background="#334155"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      {r.photo&&<img src={r.photo} alt="" style={{width:32,height:32,objectFit:"cover",borderRadius:4}}/>}
                      <div>
                        <div style={{fontWeight:600}}>{r.nom}</div>
                        <div style={{fontSize:11,color:"#64748B"}}>{r.categorie} · {r.portions||DEFAULT_PORTIONS} p.</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Field>
          <div style={{display:"flex",gap:8,marginBottom:16}}>
            <button onClick={()=>setForm(f=>({...f,queue:false}))} style={{flex:1,padding:"8px",borderRadius:8,border:"1px solid",borderColor:!form.queue?"#C2622D":"#E2E8F0",background:!form.queue?"#FFF7ED":"transparent",color:!form.queue?"#C2622D":"#64748B",cursor:"pointer",fontSize:12,fontWeight:600}}>📅 Date précise</button>
            <button onClick={()=>setForm(f=>({...f,queue:true}))} style={{flex:1,padding:"8px",borderRadius:8,border:"1px solid",borderColor:form.queue?"#C2622D":"#E2E8F0",background:form.queue?"#FFF7ED":"transparent",color:form.queue?"#C2622D":"#64748B",cursor:"pointer",fontSize:12,fontWeight:600}}>⏳ File d'attente</button>
          </div>
          {!form.queue&&<Field label="Date"><input style={inputStyle} type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></Field>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Field label="Moment"><select style={inputStyle} value={form.moment} onChange={e=>setForm(f=>({...f,moment:e.target.value}))}>{MOMENTS.map(m=><option key={m}>{m}</option>)}</select></Field>
            <Field label="Portions"><input style={inputStyle} type="number" value={form.portions} onChange={e=>setForm(f=>({...f,portions:e.target.value}))}/></Field>
          </div>
          <button onClick={save} disabled={saving||!form.recetteQuery||((!form.queue&&!form.date))} style={form.recetteQuery&&(form.queue||form.date)?btnPrimary:btnDisabled}>{saving?"Enregistrement...":"Ajouter"}</button>
        </Modal>
      )}
    </div>
  );
}

// ── Courses Tab ───────────────────────────────────────────────────────────────
function CoursesTab({toast}){
  const [courses,setCourses]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showForm,setShowForm]=useState(false);
  const [sortBy,setSortBy]=useState("categorie"); // "categorie" | "recette"
  const [form,setForm]=useState({article:"",categorie:"Épicerie",quantite:"",semaine:"",recette:""});
  const [categorieTouched,setCategorieTouched]=useState(false); // true dès que l'utilisateur choisit la catégorie à la main
  const [saving,setSaving]=useState(false);
  const [showCoursesModal,setShowCoursesModal]=useState(false);
  const [coursesSelection,setCoursesSelection]=useState([]);
  const [generatingCourses,setGeneratingCourses]=useState(false);
  const [editItem,setEditItem]=useState(null); // ligne en cours d'édition
  const [editCatTouched,setEditCatTouched]=useState(false);
  const [suggestions,setSuggestions]=useState([]); // autocomplétion sur l'historique

  // Historique normalisé des articles déjà utilisés (pour normer l'orthographe).
  // On garde la 1re orthographe rencontrée par forme normalisée.
  const articleHistory=useMemo(()=>{
    const norm=s=>(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();
    const seen=new Map();
    for(const c of courses){
      const k=norm(c.article);
      if(k&&!seen.has(k))seen.set(k,{article:c.article,categorie:c.categorie});
    }
    return[...seen.values()];
  },[courses]);

  const updateSuggestions=(val)=>{
    const norm=s=>(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();
    const q=norm(val);
    if(q.length<1){setSuggestions([]);return;}
    setSuggestions(articleHistory.filter(h=>norm(h.article).includes(q)).slice(0,6));
  };

  const load=useCallback(async(force=false)=>{
    const cached=getCached("courses");
    if(cached&&!force){setCourses(cached);setLoading(false);return;}
    setLoading(true);
    try{const data=await notionQuery(DB_COURSES);const parsed=(data.results||[]).map(parseCourse);setCourses(parsed);setCache("courses",parsed);}catch(e){console.error(e);}
    setLoading(false);
  },[]);

  useEffect(()=>{load();},[load]);

  const toggleAchete=async(item)=>{
    const newVal=!item.achete;
    const updated=courses.map(c=>c.id===item.id?{...c,achete:newVal}:c);
    setCourses(updated);setCache("courses",updated);
    notionUpdate(item.id,{"Acheté":nCheck(newVal)});
  };

  const saveEditCourse=async()=>{
    if(!editItem?.article)return;
    const updated=courses.map(c=>c.id===editItem.id?{...editItem}:c);
    setCourses(updated);setCache("courses",updated);
    try{
      await notionUpdate(editItem.id,{
        "Article":nTitle(editItem.article),
        "Catégorie":nSel(editItem.categorie),
        "Quantité":nText(editItem.quantite||""),
      });
      toast("Article modifié ✓");
    }catch(e){logError("courseEdit",e,{item:editItem.article});toast("Erreur");}
    setEditItem(null);setEditCatTouched(false);
  };

  const deleteAchetes=async()=>{
    const toDelete=courses.filter(c=>c.achete);
    if(!toDelete.length)return;
    const updated=courses.filter(c=>!c.achete);
    setCourses(updated);setCache("courses",updated);
    // Archiver dans Notion en parallèle
    await Promise.all(toDelete.map(c=>
      fetch(`/api/notion?path=/v1/pages/${c.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({archived:true})})
    ));
    toast(toDelete.length+" article"+(toDelete.length>1?"s":"")+" supprimé"+(toDelete.length>1?"s":"")+" ✓");
  };

  const addItem=async()=>{
    setSaving(true);
    await notionCreate(DB_COURSES,{"Article":nTitle(form.article),"Catégorie":nSel(form.categorie),"Quantité":nText(form.quantite),"Semaine":nText(form.semaine),"Recette":nText(form.recette)});
    toast("Article ajouté ✓");setSaving(false);setShowForm(false);
    setForm({article:"",categorie:"Épicerie",quantite:"",semaine:"",recette:""});
    setCategorieTouched(false);
    setCache("courses",null);load(true);
  };

  // Group and merge quantities
  const grouped=sortBy==="categorie"
    ?courses.reduce((acc,c)=>{const k=c.categorie||"Autre";if(!acc[k])acc[k]=[];acc[k].push(c);return acc;},{})
    :courses.reduce((acc,c)=>{const k=c.recette||"Sans recette";if(!acc[k])acc[k]=[];acc[k].push(c);return acc;},{});

  const total=courses.length;const done=courses.filter(c=>c.achete).length;
  const hasDone=done>0;

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          {total>0&&<><div style={{background:"#F1F5F9",borderRadius:20,height:6,width:120,overflow:"hidden"}}><div style={{background:"#4ADE80",height:"100%",width:`${(done/total)*100}%`,borderRadius:20,transition:"width 0.3s"}}/></div><span style={{fontSize:12,color:"#64748B"}}>{done}/{total}</span></>}
        </div>
        <div style={{display:"flex",gap:8}}>
          <div style={{display:"flex",background:"#F1F5F9",borderRadius:8,overflow:"hidden"}}>
            <button onClick={()=>setSortBy("categorie")} style={{padding:"7px 12px",background:sortBy==="categorie"?"#C2622D":"transparent",border:"none",color:sortBy==="categorie"?"#fff":"#64748B",cursor:"pointer",fontSize:11,fontWeight:600}}>Par rayon</button>
            <button onClick={()=>setSortBy("recette")} style={{padding:"7px 12px",background:sortBy==="recette"?"#C2622D":"transparent",border:"none",color:sortBy==="recette"?"#fff":"#64748B",cursor:"pointer",fontSize:11,fontWeight:600}}>Par recette</button>
          </div>
          <button onClick={()=>load(true)} style={{padding:"8px 10px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:8,color:"#64748B",cursor:"pointer"}}><Icon name="refresh" size={14}/></button>
          {hasDone&&<button onClick={deleteAchetes} style={{padding:"8px 14px",background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,color:"#DC2626",cursor:"pointer",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:6}}>🗑 Supprimer les cochés ({done})</button>}
          <button onClick={()=>setShowForm(true)} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",background:"#C2622D",border:"none",borderRadius:8,color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer"}}><Icon name="plus" size={16}/>Ajouter</button>
        </div>
      </div>

      {loading?<Spinner label="Chargement des courses..."/>:(
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          {Object.keys(grouped).length===0&&<div style={{textAlign:"center",padding:48,color:"#64748B"}}><div style={{fontSize:40,marginBottom:12}}>🛒</div><div style={{fontSize:14}}>Liste vide.</div></div>}
          {Object.entries(grouped).map(([key,items])=>(
            <div key={key}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                {sortBy==="categorie"&&<div style={{width:10,height:10,borderRadius:"50%",background:CAT_COLORS[key]||"#6B7280"}}/>}
                <span style={{fontSize:11,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.1em"}}>{key}</span>
                <span style={{fontSize:10,color:"#64748B"}}>({items.filter(i=>!i.achete).length} restants)</span>
              </div>
              {items.map((item,j)=>(
                <div key={j} onClick={()=>toggleAchete(item)} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:8,cursor:"pointer",opacity:item.achete?0.5:1,marginBottom:4,transition:"opacity 0.2s"}}>
                  <div style={{width:20,height:20,borderRadius:5,border:`2px solid ${item.achete?"#4ADE80":"#334155"}`,background:item.achete?"#4ADE80":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    {item.achete&&<Icon name="check" size={12}/>}
                  </div>
                  <span style={{flex:1,fontSize:14,color:"#0F172A",textDecoration:item.achete?"line-through":"none"}}>{item.article}</span>
                  <span style={{fontSize:12,color:"#64748B"}}>{item.quantite}</span>
                  <button onClick={e=>{e.stopPropagation();setEditItem({...item});setEditCatTouched(false);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,opacity:0.5,padding:"0 2px"}}>✏️</button>
                  {sortBy==="categorie"&&item.recette&&<span style={{fontSize:10,color:"#64748B",background:"#F1F5F9",padding:"2px 6px",borderRadius:10}}>{item.recette}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {showForm&&(
        <Modal title="Ajouter un article" onClose={()=>setShowForm(false)}>
          <Field label="Article">
            <div style={{position:"relative"}}>
              <input style={inputStyle} value={form.article} onChange={e=>{
                const val=e.target.value;
                setForm(f=>({...f,article:val,categorie:categorieTouched?f.categorie:guessCategory(val)}));
                updateSuggestions(val);
              }} placeholder="Ex: Tomates" autoComplete="off"/>
              {suggestions.length>0&&(
                <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:10,background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:8,marginTop:4,boxShadow:"0 4px 12px rgba(0,0,0,0.08)",overflow:"hidden"}}>
                  {suggestions.map((s,i)=>(
                    <button key={i} onClick={()=>{setForm(f=>({...f,article:s.article,categorie:categorieTouched?f.categorie:s.categorie}));setSuggestions([]);}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,width:"100%",padding:"10px 12px",background:"none",border:"none",borderBottom:i<suggestions.length-1?"1px solid #F1F5F9":"none",cursor:"pointer",textAlign:"left",fontSize:14,color:"#0F172A"}}>
                      <span>{s.article}</span>
                      <span style={{fontSize:11,color:"#94A3B8"}}>{s.categorie}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Field label="Catégorie"><select style={inputStyle} value={form.categorie} onChange={e=>{setCategorieTouched(true);setForm(f=>({...f,categorie:e.target.value}));}}>{Object.keys(CAT_COLORS).map(c=><option key={c}>{c}</option>)}</select></Field>
            <Field label="Quantité"><input style={inputStyle} value={form.quantite} onChange={e=>setForm(f=>({...f,quantite:e.target.value}))} placeholder="500g..."/></Field>
          </div>
          <Field label="Recette (optionnel)"><input style={inputStyle} value={form.recette} onChange={e=>setForm(f=>({...f,recette:e.target.value}))} placeholder="Ex: Poulet rôti"/></Field>
          <button onClick={addItem} disabled={saving||!form.article} style={form.article?btnPrimary:btnDisabled}>{saving?"Ajout...":"Ajouter"}</button>
        </Modal>
      )}

      {editItem&&(
        <Modal title="Modifier l'article" onClose={()=>{setEditItem(null);setEditCatTouched(false);}}>
          <Field label="Article"><input style={inputStyle} value={editItem.article} onChange={e=>{
            const val=e.target.value;
            setEditItem(d=>({...d,article:val,categorie:editCatTouched?d.categorie:guessCategory(val)}));
          }} placeholder="Ex: Tomates"/></Field>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Field label="Catégorie"><select style={inputStyle} value={editItem.categorie} onChange={e=>{setEditCatTouched(true);setEditItem(d=>({...d,categorie:e.target.value}));}}>{Object.keys(CAT_COLORS).map(c=><option key={c}>{c}</option>)}</select></Field>
            <Field label="Quantité"><input style={inputStyle} value={editItem.quantite||""} onChange={e=>setEditItem(d=>({...d,quantite:e.target.value}))} placeholder="500g..."/></Field>
          </div>
          <button onClick={saveEditCourse} disabled={!editItem.article} style={editItem.article?btnPrimary:btnDisabled}>Enregistrer</button>
        </Modal>
      )}
    </div>
  );
}

// ── Discovery Tab ─────────────────────────────────────────────────────────────
function DiscoveryTab({toast,frigoCookTarget,clearFrigoTarget}){
  const [prompt,setPrompt]=useState("");
  const [cards,setCards]=useState([]);
  const [current,setCurrent]=useState(0);
  const [loading,setLoading]=useState(false);
  const [importing,setImporting]=useState(false);
  const [done,setDone]=useState(false);
  const [liked,setLiked]=useState([]);
  const [importStatus,setImportStatus]=useState({}); // {cardTitre: 'loading'|'done'|'error'}
  const [dragX,setDragX]=useState(0);
  const [dragging,setDragging]=useState(false);
  const [detail,setDetail]=useState(null); // {card,loading,data,error}
  const [localMatches,setLocalMatches]=useState([]); // recettes perso correspondant au frigo
  const [frigoContext,setFrigoContext]=useState(null); // {article,forme} d'où vient la recherche
  const [selectedLocal,setSelectedLocal]=useState(null); // recette perso ouverte en détail
  const startX=useRef(null);
  const movedRef=useRef(false);
  const cardRef=useRef(null);
  const EMOJIS=["🍽️","🥗","🍲","🥘","🍜","🥩","🐟","🥦","🍋","🫐"];
  const decodeEntities=(s)=>{
    if(!s)return s;
    const t=document.createElement("textarea");t.innerHTML=s;return t.value;
  };

  const inputStyle={width:"100%",padding:"12px 16px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:10,color:"#0F172A",fontSize:15,fontFamily:"inherit",outline:"none"};
  const btnP={padding:"12px 24px",background:"#C2622D",border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer",fontFamily:"inherit",width:"100%"};
  const btnD={...btnP,opacity:0.4,cursor:"not-allowed"};

  async function search(queryOverride){
    // queryOverride peut être un event (onClick) — n'accepter qu'une string.
    const override=(typeof queryOverride==="string")?queryOverride:"";
    const q=(override||prompt).trim();
    if(!q)return;
    setLoading(true);setCards([]);setCurrent(0);setLiked([]);setDone(false);
    try{
      const res=await fetch("/api/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:`recette ${q}`})});
      const data=await res.json();
      const arr=(data.results||[]).slice(0,9).map((r,i)=>({
        titre:decodeEntities((r.titre||"").replace(/[-|]\s*(Marmiton|CuisineAZ|750g|Chef Simon|Cuisine AZ|Recette)\s*$/gi,"").trim()),
        description:decodeEntities(r.description),url:r.url,source:r.source,origin:r._origin||"ai",
        categorie:r.categorie||"Dîner",temps:r.temps||null,difficulte:r.difficulte||null,
        emoji:r.emoji||EMOJIS[i%EMOJIS.length],
        image:r.image||null,spoonacularId:r.spoonacularId||null,note:r.note??null,noteCount:r.noteCount??null,
      }));
      // Affichage progressif simulant le streaming
      for(let i=0;i<arr.length;i++){
        await new Promise(r=>setTimeout(r,150));
        setCards(prev=>[...prev,arr[i]]);
      }
    }catch(e){console.error(e);}
    setLoading(false);
  }

  // Déclenché quand on arrive depuis le Frigo ("Cuisiner avec")
  // CASCADE : 1) tes recettes qui matchent la protéine  2) sinon/en complément, Découverte web
  useEffect(()=>{
    if(!frigoCookTarget)return;
    const article=(frigoCookTarget.article||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const forme=(frigoCookTarget.forme&&frigoCookTarget.forme!=="Autre")?frigoCookTarget.forme.toLowerCase():"";
    const q=`${forme} ${frigoCookTarget.article}`.trim();
    setPrompt(q);
    setFrigoContext({article:frigoCookTarget.article,forme:frigoCookTarget.forme});

    // 1) Chercher dans TES recettes (cache) : match sur nom + ingrédients
    const mesRecettes=getCached("recettes")||[];
    const norm=s=>(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    // mots-clés : le nom de l'article + variantes de forme
    const keyword=article.split(" ")[0]; // ex "poulet", "saumon"
    const matches=mesRecettes.filter(r=>{
      const hay=norm(r.nom)+" "+norm(r.ingredients);
      if(!hay.includes(keyword))return false;
      // si une forme précise est connue, privilégier les recettes qui la mentionnent,
      // mais ne pas exclure celles sans forme (le keyword protéine suffit)
      return true;
    });
    // trier : forme mentionnée d'abord, puis jamais cuisinées, puis récence
    if(forme){
      matches.sort((a,b)=>{
        const af=(norm(a.nom)+norm(a.ingredients)).includes(norm(forme))?1:0;
        const bf=(norm(b.nom)+norm(b.ingredients)).includes(norm(forme))?1:0;
        return bf-af;
      });
    }
    setLocalMatches(matches);

    // 2) Lancer AUSSI la recherche web en fallback/complément.
    //    Si tu as des recettes perso, elles s'affichent en haut ; sinon la Découverte prend le relais.
    search(q);
    clearFrigoTarget&&clearFrigoTarget();
    // eslint-disable-next-line
  },[frigoCookTarget]);

  // Import en arrière-plan : Spoonacular (0 crédit) → Claude fallback
  function importCardBg(card){
    setImportStatus(s=>({...s,[card.titre]:"loading"}));

    const doImport=(recipe)=>{
      if(!recipe?.nom){
        logError("importCardBg",new Error("Recette invalide"),{card:card.titre});
        setImportStatus(s=>({...s,[card.titre]:"error"}));return;
      }
      notionCreate(DB_RECETTES,{
        "Nom":nTitle(recipe.nom),"Catégorie":nSel(recipe.categorie||card.categorie),
        "Temps de préparation":nNum(recipe.temps||card.temps),"Portions":nNum(recipe.portions||4),
        "Ingrédients":nText(recipe.ingredients||""),"Instructions":nText(recipe.instructions||""),
        "Note":nSel(recipe.note||""),"Likes":nNum(0),"Dislikes":nNum(0),"Fois cuisinée":nNum(0),
        ...((card.url&&card.url.startsWith("http"))?{"Source":nUrl(card.url)}:{}),
        ...((recipe.photo||recipe.image||card.image)?{"Photo":nUrl(recipe.photo||recipe.image||card.image)}:{}),
      }).then(r=>{
        if(!r||r.object==="error"){
          logError("importCardBg",new Error(r?.message||"Échec de l'enregistrement Notion"),{card:card.titre});
          setImportStatus(s=>({...s,[card.titre]:"error"}));
          toast("\""+card.titre+"\" — échec de l'enregistrement ✕");
          return;
        }
        setImportStatus(s=>({...s,[card.titre]:r.object==="skip"?"skip":"done"}));
        toast(r.object==="skip"?"\""+card.titre+"\" déjà dans vos recettes":"\""+card.titre+"\" ajoutée ✓");
      }).catch(e=>{logError("importCardBg",e,{card:card.titre});setImportStatus(s=>({...s,[card.titre]:"error"}));toast("\""+card.titre+"\" — échec de l'enregistrement ✕");});
    };

    // Spoonacular : recette complète sans Claude
    if(card.spoonacularId){
      fetch("/api/spoonacular-recipe?id="+card.spoonacularId)
        .then(r=>r.json())
        .then(recipe=>{ if(recipe?.nom) doImport(recipe); else claudeFallback(); })
        .catch(()=>claudeFallback());
    } else { claudeFallback(); }

    function claudeFallback(){
      const fallbackPrompt=card.url?null:`Génère une recette pour: "${card.titre}". Description: ${card.description}. Ingrédients un par ligne.\n\n${RECIPE_JSON_PROMPT}`;
      withTimeout(extractRecipe(card.url,fallbackPrompt),25000,"Extraction trop longue")
        .then(recipe=>{
          if(recipe?.nom){ doImport(recipe); return; }
          // Extraction échouée mais l'utilisateur a liké : on enregistre au minimum la carte
          // (titre, description, lien) pour ne jamais perdre le like.
          doImport({
            nom:card.titre,
            categorie:card.categorie||"Dîner",
            temps:card.temps||null,
            portions:4,
            ingredients:"",
            instructions:card.description?`(Recette à compléter)\n\n${card.description}`:"(Recette à compléter — voir la source)",
            image:card.image||null,
          });
        })
        .catch(e=>{
          logError("importCardBg",e,{card:card.titre});
          // Même en cas de timeout, on sauvegarde la version minimale plutôt que de perdre le like
          doImport({
            nom:card.titre,categorie:card.categorie||"Dîner",temps:card.temps||null,portions:4,
            ingredients:"",instructions:card.description?`(Recette à compléter)\n\n${card.description}`:"(Recette à compléter — voir la source)",
            image:card.image||null,
          });
        });
    }
  }


  // Voir la fiche complète d'une carte, sans l'enregistrer dans Notion
  function openDetail(c){
    setDetail({card:c,loading:true,data:null,error:false});
    const finish=(data)=>setDetail(d=>(d&&d.card===c?{card:c,loading:false,data,error:!data?.nom&&!data?.ingredients}:d));
    const fallback=()=>{
      const fallbackPrompt=c.url?null:`Génère une recette pour: "${c.titre}". Description: ${c.description}. Ingrédients un par ligne.\n\n${RECIPE_JSON_PROMPT}`;
      extractRecipe(c.url,fallbackPrompt)
        .then(finish)
        .catch(e=>{logError("openDetail",e,{card:c.titre});setDetail(d=>(d&&d.card===c?{card:c,loading:false,data:null,error:true}:d));});
    };
    if(c.spoonacularId){
      fetch("/api/spoonacular-recipe?id="+c.spoonacularId).then(r=>r.json())
        .then(recipe=>{ if(recipe?.nom) finish(recipe); else fallback(); })
        .catch(fallback);
    } else fallback();
  }

  // Passer à la carte suivante/précédente sans enregistrer de décision (like/skip)
  function goTo(delta){
    setCurrent(c=>Math.max(0,Math.min(cards.length,c+delta)));
    setDragX(0);
  }

  function swipe(dir){
    if(current>=cards.length)return;
    const card=cards[current];
    if(dir==="right"){
      setLiked(l=>[...l,card]);
      importCardBg(card); // non-bloquant
    }
    setCurrent(c=>c+1);setDragX(0);
  }

    function onPointerDown(e){startX.current=e.clientX??e.touches?.[0]?.clientX;movedRef.current=false;setDragging(true);}
  function onPointerMove(e){
    if(!dragging||startX.current==null)return;
    const dx=(e.clientX??e.touches?.[0]?.clientX)-startX.current;
    if(Math.abs(dx)>8)movedRef.current=true;
    setDragX(dx);
  }
  function onPointerUp(){
    if(Math.abs(dragX)>80)swipe(dragX>0?"right":"left");
    else setDragX(0);
    setDragging(false);startX.current=null;
  }
  function onCardClick(){
    if(!movedRef.current&&card)openDetail(card);
  }

  const card=cards[current];
  const isLast=current>=cards.length&&cards.length>0;
  const rotation=dragX/20;
  const likeOpacity=Math.min(1,dragX/60);
  const skipOpacity=Math.min(1,-dragX/60);

  return(
    <div style={{maxWidth:540,margin:"0 auto",paddingTop:16}}>
      {/* Prompt */}
      <div style={{marginBottom:24}}>
        <p style={{color:"#64748B",fontSize:14,marginBottom:12,marginTop:0}}>Décris ce que tu veux cuisiner — occasion, contraintes, saison, nombre de repas…</p>
        <textarea value={prompt} onChange={e=>setPrompt(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();search();}}}
          placeholder="Ex: 5 repas légers pour une semaine de canicule, pas de viande rouge"
          rows={3} style={{...inputStyle,resize:"vertical",lineHeight:1.5}}/>
        <button onClick={()=>search()} disabled={loading||!prompt.trim()} style={{...(loading||!prompt.trim()?btnD:btnP),marginTop:10}}>
          {loading?"✨ Recherche en cours… ("+cards.length+" trouvées)":"✨ Trouver des recettes"}
        </button>
        {cards.length>0&&!loading&&(
          <p style={{textAlign:"center",fontSize:12,color:"#94A3B8",margin:"8px 0 0"}}>
            {cards.length} recette{cards.length>1?"s":""} trouvée{cards.length>1?"s":""} · {current} vue{current>1?"s":""}
          </p>
        )}
      </div>

      {/* CASCADE : tes recettes qui utilisent cet ingrédient (priorité sur la Découverte web) */}
      {frigoContext&&localMatches.length>0&&(
        <div style={{marginBottom:20,background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:14,padding:"14px 16px"}}>
          <div style={{fontSize:13,fontWeight:700,color:"#16A34A",marginBottom:4}}>
            🍳 Tes recettes avec {frigoContext.article}{frigoContext.forme&&frigoContext.forme!=="Autre"?` (${frigoContext.forme.toLowerCase()})`:""}
          </div>
          <p style={{fontSize:12,color:"#15803D",margin:"0 0 10px"}}>Tu sais déjà faire {localMatches.length===1?"ce plat":"ces plats"} — pas besoin de chercher ailleurs.</p>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {localMatches.slice(0,6).map(r=>(
              <button key={r.id} onClick={()=>setSelectedLocal(r)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"10px 12px",background:"#FFFFFF",border:"1px solid #D1FAE5",borderRadius:10,cursor:"pointer",textAlign:"left",width:"100%"}}>
                <span style={{fontSize:14,fontWeight:600,color:"#0F172A"}}>{r.nom}</span>
                <span style={{fontSize:11,color:"#94A3B8",whiteSpace:"nowrap"}}>{r.temps?`${r.temps} min`:""}{!r.derniere_cuisson?" · jamais cuisinée":""}</span>
              </button>
            ))}
          </div>
          <p style={{fontSize:11,color:"#94A3B8",margin:"10px 0 0",textAlign:"center"}}>↓ ou découvre de nouvelles idées ci-dessous</p>
        </div>
      )}
      {frigoContext&&localMatches.length===0&&!loading&&(
        <div style={{marginBottom:16,background:"#FFF7ED",border:"1px solid #FDBA74",borderRadius:12,padding:"12px 14px",fontSize:13,color:"#C2622D"}}>
          Aucune recette perso avec {frigoContext.article} — voici des idées à découvrir 👇
        </div>
      )}

      {/* Skeleton pendant chargement initial */}
      {loading&&cards.length===0&&(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <style>{`.sk{animation:pulse 1.4s ease-in-out infinite;background:#F1F5F9;border-radius:12px;}@keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}`}</style>
          {[300,200,250].map((w,i)=><div key={i} className="sk" style={{height:20,width:w}}/>)}
          <div className="sk" style={{height:360,borderRadius:20,marginTop:8}}/>
        </div>
      )}

      {/* Swipe */}
      {cards.length>0&&!isLast&&card&&(
        <div style={{position:"relative",height:440}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{color:"#64748B",fontSize:13}}>{current+1} / {cards.length}</span>
            <div style={{display:"flex",gap:4}}>{cards.map((_,i)=>(
              <div key={i} style={{width:18,height:3,borderRadius:2,background:i<current?"#C2622D":i===current?"#0F172A":"#E2E8F0"}}/>
            ))}</div>
            <span style={{color:"#C2622D",fontSize:13,fontWeight:600}}>❤️ {liked.length}</span>
          </div>

          {current+1<cards.length&&(
            <div style={{position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",width:"94%",height:420,background:"#F8FAFC",borderRadius:20,border:"1px solid #E2E8F0"}}/>
          )}

          <div ref={cardRef}
            onMouseDown={onPointerDown} onMouseMove={onPointerMove} onMouseUp={onPointerUp} onMouseLeave={onPointerUp}
            onTouchStart={onPointerDown} onTouchMove={onPointerMove} onTouchEnd={onPointerUp}
            onClick={onCardClick}
            style={{position:"absolute",top:0,left:0,right:0,height:420,
              background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:20,padding:24,
              transform:"translateX("+dragX+"px) rotate("+rotation+"deg)",
              transition:dragging?"none":"transform 0.3s ease",
              cursor:"grab",userSelect:"none",touchAction:"none",
              boxShadow:"0 8px 32px rgba(0,0,0,0.08)",
              display:"flex",flexDirection:"column",justifyContent:"space-between"
            }}>
            {dragX>20&&<div style={{position:"absolute",top:20,right:20,padding:"6px 14px",border:"2px solid #16A34A",borderRadius:8,color:"#16A34A",fontWeight:800,fontSize:15,opacity:likeOpacity,transform:"rotate(-12deg)",background:"rgba(240,253,244,.95)"}}>❤️ OUI</div>}
            {dragX<-20&&<div style={{position:"absolute",top:20,left:20,padding:"6px 14px",border:"2px solid #DC2626",borderRadius:8,color:"#DC2626",fontWeight:800,fontSize:15,opacity:skipOpacity,transform:"rotate(12deg)",background:"rgba(254,242,242,.95)"}}>✕ SKIP</div>}

            <div>
              {card.image
                ?<img src={card.image} alt={card.titre} style={{width:"100%",height:120,objectFit:"cover",borderRadius:12,marginBottom:10}} onError={e=>e.target.style.display="none"}/>
                :<div style={{fontSize:44,marginBottom:10,textAlign:"center"}}>{card.emoji||"🍽️"}</div>
              }
              <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
                {card.categorie&&<span style={{padding:"3px 10px",background:"#FFF7ED",borderRadius:20,fontSize:12,color:"#C2622D",fontWeight:600,border:"1px solid #FDBA74"}}>{card.categorie}</span>}
                {card.temps&&<span style={{padding:"3px 10px",background:"#F1F5F9",borderRadius:20,fontSize:12,color:"#475569"}}>⏱ {card.temps} min</span>}
                {card.difficulte&&<span style={{padding:"3px 10px",background:"#F1F5F9",borderRadius:20,fontSize:12,color:"#475569"}}>{card.difficulte}</span>}
                {card.origin!=="ai"&&card.source&&<span style={{padding:"3px 10px",background:"#ECFDF5",borderRadius:20,fontSize:12,color:"#059669",fontWeight:600}}>🌐 {card.source}</span>}
                {card.note!=null&&<span style={{padding:"3px 10px",background:"#FEFCE8",borderRadius:20,fontSize:12,color:"#CA8A04",fontWeight:600,border:"1px solid #FDE68A"}}>⭐ {(card.note/20).toFixed(1)}/5{card.noteCount?` (${card.noteCount})`:""}</span>}
              </div>
              <h2 style={{margin:"0 0 10px",fontSize:20,fontWeight:700,fontFamily:"'Playfair Display',serif",color:"#0F172A",lineHeight:1.3}}>{card.titre}</h2>
              <p style={{margin:0,color:"#64748B",fontSize:13,lineHeight:1.6}}>{card.description}</p>
            </div>
            {card.origin==="ai"
              ? <span style={{fontSize:12,color:"#7C3AED",fontWeight:600,background:"#F5F3FF",padding:"4px 10px",borderRadius:8,alignSelf:"flex-start"}}>✨ Générée par IA</span>
              : card.url
                ? <a href={card.url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{color:"#C2622D",fontSize:12,textDecoration:"none",fontWeight:600}}>🔗 {card.source||"Voir la source"}</a>
                : <span style={{fontSize:12,color:"#94A3B8"}}>{card.source||""}</span>
            }
          </div>

          <div style={{display:"flex",gap:16,marginTop:432,justifyContent:"center"}}>
            <button onClick={()=>swipe("left")} style={{width:60,height:60,borderRadius:"50%",background:"#FEF2F2",border:"2px solid #FECACA",color:"#DC2626",fontSize:22,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            <button onClick={()=>swipe("right")} style={{width:60,height:60,borderRadius:"50%",background:"#F0FDF4",border:"2px solid #BBF7D0",color:"#16A34A",fontSize:22,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>❤️</button>
          </div>
          <div style={{display:"flex",justifyContent:"center",gap:24,marginTop:14}}>
            <button onClick={()=>goTo(-1)} disabled={current===0} style={{background:"none",border:"none",color:current===0?"#CBD5E1":"#64748B",fontSize:13,cursor:current===0?"default":"pointer",fontFamily:"inherit",padding:0}}>‹ Précédente</button>
            <button onClick={()=>goTo(1)} style={{background:"none",border:"none",color:"#64748B",fontSize:13,cursor:"pointer",fontFamily:"inherit",padding:0}}>Suivante sans choisir ›</button>
          </div>
        </div>
      )}

      {/* End screen */}
      {isLast&&(
        <div style={{textAlign:"center",padding:32,background:"#FFFFFF",borderRadius:20,border:"1px solid #E2E8F0"}}>
          <div style={{fontSize:44,marginBottom:14}}>🎉</div>
          <h3 style={{margin:"0 0 8px",color:"#0F172A",fontSize:20}}>Tu as vu toutes les recettes !</h3>
          <p style={{color:"#64748B",marginBottom:20}}>{liked.length} recette{liked.length>1?"s":""} sélectionnée{liked.length>1?"s":""}</p>
          {liked.length>0&&(
            <>
              <div style={{marginBottom:20,textAlign:"left"}}>
                {liked.map((c,i)=>{
                  const status=importStatus[c.titre];
                  return(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"#F8FAFC",borderRadius:10,marginBottom:8,border:"1px solid #E2E8F0"}}>
                    <span style={{fontSize:18}}>{c.emoji||"🍽️"}</span>
                    <span style={{color:"#0F172A",fontSize:13,fontWeight:500,flex:1}}>{c.titre}</span>
                    {status==="loading"&&<span style={{fontSize:12,color:"#F59E0B"}}>⏳…</span>}
                    {status==="done"&&<span style={{fontSize:12,color:"#16A34A",fontWeight:600}}>✓</span>}
                    {status==="error"&&<button onClick={()=>importCardBg(c)} style={{fontSize:11,color:"#DC2626",background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:6,padding:"2px 8px",cursor:"pointer",fontFamily:"inherit"}}>✕ réessayer</button>}
                    {!status&&<span style={{fontSize:11,color:"#94A3B8"}}>{c.categorie}</span>}
                  </div>
                  );
                })}
              </div>

            </>
          )}
          <button onClick={()=>{setCards([]);setCurrent(0);setLiked([]);setDone(false);setPrompt("");}}
            style={{marginTop:12,padding:"10px 20px",background:"transparent",border:"1px solid #E2E8F0",borderRadius:10,color:"#64748B",cursor:"pointer",fontFamily:"inherit",fontSize:14,width:"100%"}}>
            Nouvelle recherche
          </button>
        </div>
      )}

      {!loading&&cards.length===0&&!isLast&&(
        <div style={{textAlign:"center",padding:48}}>
          <div style={{fontSize:44,marginBottom:12}}>✨</div>
          <p style={{margin:0,fontSize:15,color:"#64748B"}}>Décris ce que tu veux cuisiner ci-dessus</p>
        </div>
      )}

      {/* Fiche détaillée — consultation seule, aucune décision enregistrée */}
      {detail&&(
        <div onClick={()=>setDetail(null)} style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(15,23,42,0.6)",display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
          <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:540,maxHeight:"85vh",overflowY:"auto",background:"#FFFDF9",borderRadius:"20px 20px 0 0",padding:24}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,gap:12}}>
              <h2 style={{margin:0,fontFamily:"'Playfair Display',serif",fontSize:20,color:"#0F172A",lineHeight:1.3}}>{detail.card.titre}</h2>
              <button onClick={()=>setDetail(null)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#94A3B8",flexShrink:0}}>✕</button>
            </div>
            <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
              {detail.card.categorie&&<span style={{padding:"3px 10px",background:"#FFF7ED",borderRadius:20,fontSize:12,color:"#C2622D",fontWeight:600,border:"1px solid #FDBA74"}}>{detail.card.categorie}</span>}
              {detail.card.note!=null&&<span style={{padding:"3px 10px",background:"#FEFCE8",borderRadius:20,fontSize:12,color:"#CA8A04",fontWeight:600,border:"1px solid #FDE68A"}}>⭐ {(detail.card.note/20).toFixed(1)}/5{detail.card.noteCount?` (${detail.card.noteCount} avis)`:""}</span>}
            </div>
            {(detail.data?.photo||detail.data?.image||detail.card.image)&&<img src={detail.data?.photo||detail.data?.image||detail.card.image} alt={detail.card.titre} style={{width:"100%",maxHeight:200,objectFit:"cover",borderRadius:12,marginBottom:14}} onError={e=>e.target.style.display="none"}/>}
            {detail.loading&&<p style={{color:"#94A3B8",fontSize:14,textAlign:"center",padding:"20px 0"}}>Chargement de la recette…</p>}
            {!detail.loading&&detail.error&&<p style={{color:"#DC2626",fontSize:14,textAlign:"center",padding:"12px 0"}}>Impossible de charger cette recette pour le moment.</p>}
            {!detail.loading&&!detail.error&&detail.data&&(
              <>
                <div style={{display:"flex",gap:16,marginBottom:14,fontSize:13,color:"#64748B"}}>
                  {detail.data.temps&&<span>⏱ {detail.data.temps} min</span>}
                  {detail.data.portions&&<span>🍽 {detail.data.portions} portions</span>}
                </div>
                <h4 style={{margin:"0 0 8px",fontSize:14,color:"#0F172A"}}>Ingrédients</h4>
                <pre style={{whiteSpace:"pre-wrap",fontFamily:"inherit",fontSize:13,color:"#334155",background:"#F8FAFC",padding:12,borderRadius:10,margin:"0 0 16px"}}>{detail.data.ingredients||"—"}</pre>
                <h4 style={{margin:"0 0 8px",fontSize:14,color:"#0F172A"}}>Instructions</h4>
                <pre style={{whiteSpace:"pre-wrap",fontFamily:"inherit",fontSize:13,color:"#334155",margin:0}}>{detail.data.instructions||"—"}</pre>
              </>
            )}
            <div style={{display:"flex",gap:10,marginTop:22}}>
              <button onClick={()=>setDetail(null)} style={{flex:1,padding:"12px",background:"#F1F5F9",border:"none",borderRadius:10,color:"#475569",fontWeight:600,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Continuer à parcourir</button>
              <button onClick={()=>{swipe("left");setDetail(null);}} style={{padding:"12px 18px",background:"#FEF2F2",border:"2px solid #FECACA",borderRadius:10,color:"#DC2626",fontWeight:700,cursor:"pointer",fontSize:18}}>✕</button>
              <button onClick={()=>{swipe("right");setDetail(null);}} style={{padding:"12px 18px",background:"#F0FDF4",border:"2px solid #BBF7D0",borderRadius:10,color:"#16A34A",fontWeight:700,cursor:"pointer",fontSize:18}}>❤️</button>
            </div>
          </div>
        </div>
      )}
      {selectedLocal&&(
        <RecipeDetailModal
          recette={selectedLocal}
          onClose={()=>setSelectedLocal(null)}
          toast={toast}
          onAddToCourses={()=>{}}
          onAddToPlanning={()=>{}}
        />
      )}
    </div>
  );
}

// ── Error Panel ──────────────────────────────────────────────────────────────
function ErrorPanel({onClose}){
  return(
    <div style={{position:"fixed",inset:0,zIndex:3000,background:"rgba(15,23,42,0.7)",display:"flex",alignItems:"flex-end"}}>
      <div style={{width:"100%",maxHeight:"70vh",background:"#FFFFFF",borderRadius:"16px 16px 0 0",padding:20,overflow:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <span style={{fontWeight:700,fontSize:15,color:"#0F172A"}}>🔍 Logs d'erreur ({errorLog.length})</span>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{errorLog.length=0;onClose();}} style={{padding:"4px 10px",background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:6,color:"#DC2626",fontSize:12,cursor:"pointer"}}>Effacer</button>
            <button onClick={onClose} style={{padding:"4px 10px",background:"#F1F5F9",border:"none",borderRadius:6,color:"#475569",fontSize:12,cursor:"pointer"}}>Fermer</button>
          </div>
        </div>
        {errorLog.length===0&&<p style={{color:"#94A3B8",fontSize:13,textAlign:"center",padding:"20px 0"}}>Aucune erreur 🎉</p>}
        {[...errorLog].reverse().map((e,i)=>(
          <div key={i} style={{padding:"10px 12px",background:"#FFF7ED",border:"1px solid #FED7AA",borderRadius:8,marginBottom:8}}>
            <div style={{display:"flex",gap:8,marginBottom:4}}>
              <span style={{fontSize:11,color:"#94A3B8"}}>{e.time}</span>
              <span style={{fontSize:11,fontWeight:700,color:"#C2622D"}}>{e.context}</span>
            </div>
            <div style={{fontSize:13,color:"#0F172A",fontWeight:500}}>{e.message}</div>
            {e.details&&<pre style={{fontSize:11,color:"#64748B",marginTop:4,whiteSpace:"pre-wrap",wordBreak:"break-all"}}>{JSON.stringify(e.details,null,2)}</pre>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
function parseFrigo(page){
  const p=page.properties||{};
  const getT=x=>x?.title?.[0]?.plain_text||"";
  const getS=x=>x?.select?.name||"";
  const getD=x=>x?.date?.start||null;
  const getR=x=>x?.rich_text?.[0]?.plain_text||"";
  const getC=x=>!!x?.checkbox;
  return{
    id:page.id,
    article:getT(p["Article"]),
    proteine:getS(p["Protéine"]),
    forme:getS(p["Forme"]),
    peremption:getD(p["Date de péremption"]),
    quantite:getR(p["Quantité"]),
    ajoute:getD(p["Ajouté le"]),
    consomme:getC(p["Consommé"]),
  };
}

function joursAvant(dateStr){
  if(!dateStr)return null;
  const d=new Date(dateStr+"T00:00");
  const now=new Date();now.setHours(0,0,0,0);
  return Math.round((d-now)/(1000*3600*24));
}

function FrigoTab({toast,onCookWith}){
  const [items,setItems]=useState(()=>getCached("frigo")||[]);
  const [loading,setLoading]=useState(false);
  const [showCapture,setShowCapture]=useState(false);
  const [analyzing,setAnalyzing]=useState(false);
  const [draft,setDraft]=useState(null); // recette extraite en attente de confirmation
  const [preview,setPreview]=useState(null);
  const [zoomed,setZoomed]=useState(false);
  const [editItem,setEditItem]=useState(null); // item en cours d'édition
  const camRef=useRef(null);
  const fileRef=useRef(null);

  const load=useCallback(async(force)=>{
    if(!force){const c=getCached("frigo");if(c){setItems(c);return;}}
    setLoading(true);
    try{
      const data=await notionQuery(DB_FRIGO);
      const parsed=(data.results||[]).map(parseFrigo).filter(x=>!x.consomme);
      parsed.sort((a,b)=>{
        const ja=joursAvant(a.peremption),jb=joursAvant(b.peremption);
        if(ja==null)return 1;if(jb==null)return -1;return ja-jb;
      });
      setItems(parsed);setCache("frigo",parsed);
    }catch(e){logError("frigoLoad",e);}
    setLoading(false);
  },[]);
  useEffect(()=>{load();},[load]);

  const handleFile=async(file)=>{
    if(!file||!file.type.startsWith("image/"))return;
    setShowCapture(true);
    setPreview(URL.createObjectURL(file));
    setAnalyzing(true);
    const reader=new FileReader();
    reader.onload=async(e)=>{
      const base64=e.target.result.split(",")[1];
      const r=await claudeVision(FRIGO_JSON_PROMPT,base64,file.type);
      if(r?.article){
        setDraft({
          article:r.article||"",
          proteine:["Viande","Poisson","Volaille","Autre"].includes(r.proteine)?r.proteine:"Autre",
          forme:["Filet","Cuisses","Pavé","Steak","Entier","Haché","Tranches","Autre"].includes(r.forme)?r.forme:"Autre",
          peremption:r.date_peremption||"",
          quantite:r.quantite||"",
        });
      } else {
        setDraft({article:"",proteine:"Autre",forme:"Autre",peremption:"",quantite:""});
        toast("Lecture incomplète — complète à la main");
      }
      setAnalyzing(false);
    };
    reader.readAsDataURL(file);
  };

  const saveDraft=async()=>{
    if(!draft?.article)return;
    const today=new Date().toISOString().split("T")[0];
    try{
      const r=await notionCreate(DB_FRIGO,{
        "Article":nTitle(draft.article),
        "Protéine":nSel(draft.proteine),
        "Forme":nSel(draft.forme),
        ...(draft.peremption?{"Date de péremption":nDate(draft.peremption)}:{}),
        "Quantité":nText(draft.quantite||""),
        "Ajouté le":nDate(today),
        "Consommé":nCheck(false),
      });
      if(r?.object==="error"){toast("Erreur enregistrement");return;}
      toast(draft.article+" ajouté au frigo ✓");
      setShowCapture(false);setDraft(null);setPreview(null);
      load(true);
    }catch(e){logError("frigoSave",e);toast("Erreur");}
  };

  const markConsumed=async(item)=>{
    const updated=items.filter(x=>x.id!==item.id);
    setItems(updated);setCache("frigo",updated);
    try{await notionUpdate(item.id,{"Consommé":nCheck(true)});}
    catch(e){logError("frigoConsume",e,{item:item.article});}
  };

  const saveEdit=async()=>{
    if(!editItem?.article)return;
    try{
      await notionUpdate(editItem.id,{
        "Article":nTitle(editItem.article),
        "Protéine":nSel(editItem.proteine),
        "Forme":nSel(editItem.forme),
        ...(editItem.peremption?{"Date de péremption":nDate(editItem.peremption)}:{"Date de péremption":nDate(null)}),
        "Quantité":nText(editItem.quantite||""),
      });
      toast("Modifié ✓");
      setEditItem(null);
      load(true);
    }catch(e){logError("frigoEdit",e,{item:editItem.article});toast("Erreur");}
  };

  const deleteItem=async(item)=>{
    const updated=items.filter(x=>x.id!==item.id);
    setItems(updated);setCache("frigo",updated);
    setEditItem(null);
    try{await fetch(`/api/notion?path=/v1/pages/${item.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({archived:true})});}
    catch(e){logError("frigoDelete",e,{item:item.article});}
  };

  const badge=(j)=>{
    if(j==null)return{txt:"pas de date",bg:"#F1F5F9",fg:"#64748B"};
    if(j<0)return{txt:"périmé",bg:"#FEF2F2",fg:"#DC2626"};
    if(j===0)return{txt:"aujourd'hui",bg:"#FEF2F2",fg:"#DC2626"};
    if(j===1)return{txt:"demain",bg:"#FFF7ED",fg:"#C2622D"};
    if(j<=3)return{txt:`${j} jours`,bg:"#FFF7ED",fg:"#C2622D"};
    return{txt:`${j} jours`,bg:"#ECFDF5",fg:"#059669"};
  };

  return(
    <div style={{maxWidth:640,margin:"0 auto"}}>
      <input ref={camRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
      <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>

      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <button onClick={()=>camRef.current?.click()} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"12px",background:"#C2622D",border:"none",borderRadius:10,color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer"}}>📷 Photographier un produit</button>
        <button onClick={()=>fileRef.current?.click()} style={{padding:"12px 14px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:10,color:"#475569",fontWeight:600,fontSize:13,cursor:"pointer"}}>🖼️</button>
      </div>

      {items.length===0&&!loading&&(
        <div style={{textAlign:"center",padding:"40px 20px",color:"#94A3B8"}}>
          <div style={{fontSize:40,marginBottom:8}}>🧊</div>
          <p style={{fontSize:14}}>Aucun produit enregistré.<br/>Photographie tes viandes, poissons et volailles pour suivre les dates de péremption.</p>
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {items.map(item=>{
          const j=joursAvant(item.peremption);const b=badge(j);
          return(
            <div key={item.id} style={{background:"#FFFFFF",border:"1px solid #F1F5F9",borderRadius:12,padding:"12px 14px",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:15,fontWeight:700,color:"#0F172A"}}>{item.article}{item.forme&&item.forme!=="Autre"?<span style={{fontWeight:400,color:"#64748B"}}> · {item.forme}</span>:""}</div>
                  <div style={{fontSize:12,color:"#94A3B8",marginTop:2}}>{item.proteine}{item.quantite?` · ${item.quantite}`:""}</div>
                </div>
                <span style={{padding:"4px 10px",background:b.bg,color:b.fg,borderRadius:20,fontSize:12,fontWeight:700,whiteSpace:"nowrap"}}>{b.txt}</span>
              </div>
              <div style={{display:"flex",gap:8,marginTop:10}}>
                <button onClick={()=>setEditItem({...item})} style={{padding:"8px 10px",background:"#F8FAFC",border:"1px solid #E2E8F0",borderRadius:8,color:"#64748B",fontSize:12,fontWeight:600,cursor:"pointer"}}>✏️</button>
                <button onClick={()=>onCookWith&&onCookWith(item)} style={{flex:1,padding:"8px",background:"#FFF7ED",border:"1px solid #FDBA74",borderRadius:8,color:"#C2622D",fontSize:12,fontWeight:600,cursor:"pointer"}}>🍳 Cuisiner avec</button>
                <button onClick={()=>markConsumed(item)} style={{flex:1,padding:"8px",background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:8,color:"#16A34A",fontSize:12,fontWeight:600,cursor:"pointer"}}>✓ Consommé</button>
              </div>
            </div>
          );
        })}
      </div>

      {showCapture&&(
        <div style={{position:"fixed",inset:0,zIndex:2500,background:"rgba(15,23,42,0.6)",display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
          <div className="modal-inner" style={{background:"#FFFFFF",borderRadius:"20px 20px 0 0",maxWidth:520,width:"100%",maxHeight:"90vh",overflow:"auto",padding:20}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <h3 style={{margin:0,fontSize:17,fontWeight:700,fontFamily:"'Playfair Display',serif"}}>Nouveau produit</h3>
              <button onClick={()=>{setShowCapture(false);setDraft(null);setPreview(null);}} style={{background:"none",border:"none",cursor:"pointer",color:"#94A3B8",fontSize:18}}>✕</button>
            </div>
            {preview&&<div style={{position:"relative",marginBottom:12}}><img src={preview} alt="" onClick={()=>setZoomed(true)} style={{width:"100%",height:140,objectFit:"cover",borderRadius:12,cursor:"zoom-in",display:"block"}}/><span onClick={()=>setZoomed(true)} style={{position:"absolute",bottom:8,right:8,background:"rgba(15,23,42,0.75)",color:"#fff",fontSize:11,fontWeight:600,padding:"3px 8px",borderRadius:20,cursor:"zoom-in"}}>🔍 Agrandir</span></div>}
            {analyzing?(
              <div style={{textAlign:"center",padding:"20px",color:"#64748B",fontSize:14}}>🔍 Lecture de l'étiquette…</div>
            ):draft?(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div><label style={{fontSize:11,fontWeight:700,color:"#64748B",textTransform:"uppercase"}}>Article</label><input value={draft.article} onChange={e=>setDraft(d=>({...d,article:e.target.value}))} style={{width:"100%",padding:"10px",border:"1px solid #E2E8F0",borderRadius:8,fontSize:14,marginTop:4}}/></div>
                <div style={{display:"flex",gap:8}}>
                  <div style={{flex:1}}><label style={{fontSize:11,fontWeight:700,color:"#64748B",textTransform:"uppercase"}}>Protéine</label><select value={draft.proteine} onChange={e=>setDraft(d=>({...d,proteine:e.target.value}))} style={{width:"100%",padding:"10px",border:"1px solid #E2E8F0",borderRadius:8,fontSize:14,marginTop:4}}>{["Viande","Poisson","Volaille","Autre"].map(o=><option key={o}>{o}</option>)}</select></div>
                  <div style={{flex:1}}><label style={{fontSize:11,fontWeight:700,color:"#64748B",textTransform:"uppercase"}}>Forme</label><select value={draft.forme} onChange={e=>setDraft(d=>({...d,forme:e.target.value}))} style={{width:"100%",padding:"10px",border:"1px solid #E2E8F0",borderRadius:8,fontSize:14,marginTop:4}}>{["Filet","Cuisses","Pavé","Steak","Entier","Haché","Tranches","Autre"].map(o=><option key={o}>{o}</option>)}</select></div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <div style={{flex:1}}><label style={{fontSize:11,fontWeight:700,color:"#64748B",textTransform:"uppercase"}}>Péremption</label><input type="date" value={draft.peremption} onChange={e=>setDraft(d=>({...d,peremption:e.target.value}))} style={{width:"100%",padding:"10px",border:"1px solid #E2E8F0",borderRadius:8,fontSize:14,marginTop:4}}/></div>
                  <div style={{flex:1}}><label style={{fontSize:11,fontWeight:700,color:"#64748B",textTransform:"uppercase"}}>Quantité</label><input value={draft.quantite} onChange={e=>setDraft(d=>({...d,quantite:e.target.value}))} placeholder="500g" style={{width:"100%",padding:"10px",border:"1px solid #E2E8F0",borderRadius:8,fontSize:14,marginTop:4}}/></div>
                </div>
                {!draft.peremption&&<p style={{fontSize:12,color:"#C2622D",margin:0}}>⚠️ Date non lue — saisis-la pour activer le suivi de péremption.</p>}
                <button onClick={saveDraft} disabled={!draft.article} style={{width:"100%",padding:"12px",background:draft.article?"#C2622D":"#E2E8F0",border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:14,cursor:draft.article?"pointer":"default",marginTop:4}}>Ajouter au frigo</button>
              </div>
            ):null}
          </div>
          {zoomed&&preview&&(
            <div onClick={()=>setZoomed(false)} style={{position:"fixed",inset:0,zIndex:3000,background:"rgba(0,0,0,0.92)",display:"flex",alignItems:"center",justifyContent:"center",padding:12}}>
              <img src={preview} alt="" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain",borderRadius:8}}/>
              <button onClick={e=>{e.stopPropagation();setZoomed(false);}} style={{position:"absolute",top:"calc(12px + env(safe-area-inset-top))",right:16,background:"rgba(255,255,255,0.15)",border:"none",color:"#fff",fontSize:22,width:40,height:40,borderRadius:20,cursor:"pointer"}}>✕</button>
              <span style={{position:"absolute",bottom:"calc(16px + env(safe-area-inset-bottom))",left:0,right:0,textAlign:"center",color:"rgba(255,255,255,0.7)",fontSize:12}}>Pince pour zoomer · touche pour fermer</span>
            </div>
          )}
        </div>
      )}
      {editItem&&(
        <div style={{position:"fixed",inset:0,zIndex:2600,background:"rgba(15,23,42,0.6)",display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
          <div className="modal-inner" style={{background:"#FFFFFF",borderRadius:"20px 20px 0 0",maxWidth:520,width:"100%",maxHeight:"90vh",overflow:"auto",padding:20}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <h3 style={{margin:0,fontSize:17,fontWeight:700,fontFamily:"'Playfair Display',serif"}}>Modifier</h3>
              <button onClick={()=>setEditItem(null)} style={{background:"none",border:"none",cursor:"pointer",color:"#94A3B8",fontSize:18}}>✕</button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <div><label style={{fontSize:11,fontWeight:700,color:"#64748B",textTransform:"uppercase"}}>Article</label><input value={editItem.article} onChange={e=>setEditItem(d=>({...d,article:e.target.value}))} style={{width:"100%",padding:"10px",border:"1px solid #E2E8F0",borderRadius:8,fontSize:14,marginTop:4}}/></div>
              <div style={{display:"flex",gap:8}}>
                <div style={{flex:1}}><label style={{fontSize:11,fontWeight:700,color:"#64748B",textTransform:"uppercase"}}>Protéine</label><select value={editItem.proteine} onChange={e=>setEditItem(d=>({...d,proteine:e.target.value}))} style={{width:"100%",padding:"10px",border:"1px solid #E2E8F0",borderRadius:8,fontSize:14,marginTop:4}}>{["Viande","Poisson","Volaille","Autre"].map(o=><option key={o}>{o}</option>)}</select></div>
                <div style={{flex:1}}><label style={{fontSize:11,fontWeight:700,color:"#64748B",textTransform:"uppercase"}}>Forme</label><select value={editItem.forme} onChange={e=>setEditItem(d=>({...d,forme:e.target.value}))} style={{width:"100%",padding:"10px",border:"1px solid #E2E8F0",borderRadius:8,fontSize:14,marginTop:4}}>{["Filet","Cuisses","Pavé","Steak","Entier","Haché","Tranches","Autre"].map(o=><option key={o}>{o}</option>)}</select></div>
              </div>
              <div style={{display:"flex",gap:8}}>
                <div style={{flex:1}}><label style={{fontSize:11,fontWeight:700,color:"#64748B",textTransform:"uppercase"}}>Péremption</label><input type="date" value={editItem.peremption||""} onChange={e=>setEditItem(d=>({...d,peremption:e.target.value}))} style={{width:"100%",padding:"10px",border:"1px solid #E2E8F0",borderRadius:8,fontSize:14,marginTop:4}}/></div>
                <div style={{flex:1}}><label style={{fontSize:11,fontWeight:700,color:"#64748B",textTransform:"uppercase"}}>Quantité</label><input value={editItem.quantite||""} onChange={e=>setEditItem(d=>({...d,quantite:e.target.value}))} placeholder="500g" style={{width:"100%",padding:"10px",border:"1px solid #E2E8F0",borderRadius:8,fontSize:14,marginTop:4}}/></div>
              </div>
              <button onClick={saveEdit} disabled={!editItem.article} style={{width:"100%",padding:"12px",background:editItem.article?"#C2622D":"#E2E8F0",border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:14,cursor:editItem.article?"pointer":"default",marginTop:4}}>Enregistrer</button>
              <button onClick={()=>deleteItem(editItem)} style={{width:"100%",padding:"10px",background:"transparent",border:"1px solid #FECACA",borderRadius:10,color:"#DC2626",fontSize:13,fontWeight:600,cursor:"pointer"}}>🗑 Supprimer du frigo</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default function App(){
  const [tab,setTab]=useState("planning");
  const [frigoCookTarget,setFrigoCookTarget]=useState(null);
  const [toastMsg,setToastMsg]=useState(null);
  const [showErrorPanel,setShowErrorPanel]=useState(false);
  const [errorCount,setErrorCount]=useState(0);
  const toast=msg=>setToastMsg(msg);

  // Garder l'écran allumé dans toute l'app (Wake Lock API)
  useEffect(()=>{
    let wakeLock=null;
    let released=false;
    const acquire=async()=>{
      if(!("wakeLock" in navigator))return;
      try{
        wakeLock=await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release",()=>{wakeLock=null;});
      }catch(e){/* refusé (batterie faible, onglet caché) — silencieux */}
    };
    const onVisibility=()=>{
      if(document.visibilityState==="visible"&&!released) acquire();
    };
    acquire();
    document.addEventListener("visibilitychange",onVisibility);
    return()=>{
      released=true;
      document.removeEventListener("visibilitychange",onVisibility);
      if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null;}
    };
  },[]);

  // Surveiller les nouvelles erreurs
  useEffect(()=>{
    const interval=setInterval(()=>{
      if(errorLog.length>errorCount) setErrorCount(errorLog.length);
    },1000);
    return()=>clearInterval(interval);
  },[errorCount]);
  const tabs=[
    {id:"recettes",  label:"Recettes",  emoji:"📖"},
    {id:"planning",  label:"Planning",  emoji:"📅"},
    {id:"courses",   label:"Courses",   emoji:"🛒"},
    {id:"frigo",     label:"Frigo",     emoji:"🧊"},
    {id:"discovery", label:"Découvrir", emoji:"✨"},
  ];

  const TAB_TITLES = {
    recettes:  "Mes recettes",
    planning:  "Planning",
    courses:   "Liste de courses",
    frigo:     "Mon frigo",
    discovery: "Découvrir",
  };

  return(
    <div style={{minHeight:"100vh",background:"#F8FAFC",color:"#0F172A",fontFamily:"'DM Sans', system-ui, sans-serif",paddingBottom:"calc(64px + env(safe-area-inset-bottom))"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap');
        *{box-sizing:border-box;}
        html,body,#root{overflow-x:hidden;max-width:100vw;}
        @keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
        @keyframes slideUp{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}
        ::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:#F1F5F9;}::-webkit-scrollbar-thumb{background:#CBD5E1;border-radius:4px;}
        select option{background:#FFFFFF;}
        .tab-content{animation:slideUp 0.18s ease;}
        @media(max-width:480px){
          .btn-label{display:none;}
        }
        @media(max-width:640px){
          /* Planning */
          .planning-grid{grid-template-columns:1fr!important;}
          .planning-grid>div{min-height:auto!important;flex-direction:row!important;display:flex!important;align-items:flex-start!important;gap:10px!important;}
          .planning-grid>div>.day-header{min-width:52px!important;flex-shrink:0!important;}
          /* Modales */
          .modal-inner{border-radius:20px 20px 0 0!important;max-height:92vh!important;position:fixed!important;bottom:0!important;left:0!important;right:0!important;margin:0!important;width:100%!important;max-width:100%!important;}
          /* Navigation */
          .top-nav{display:none!important;}
          .app-header-title{display:block!important;}
          .app-content{padding:12px 14px 80px!important;}
          /* Recettes */
          .recipe-card{padding:12px!important;}
          .recipe-card-actions{gap:6px!important;}
          /* Courses */
          .course-item{padding:14px 16px!important;min-height:52px!important;}
          .course-checkbox{width:24px!important;height:24px!important;}
          /* Fiche recette */
          .recipe-detail-grid{grid-template-columns:1fr!important;}
          /* Typographie */
          body{font-size:15px!important;}
        }
        @media(min-width:641px){
          .bottom-nav{display:none!important;}
          .top-nav{display:flex!important;}
          .app-content{padding:28px 24px!important;}
        }
      `}</style>

      {/* ── Header ── */}
      <div style={{borderBottom:"1px solid #E2E8F0",padding:"0 20px",background:"#FFFFFF",position:"sticky",top:0,zIndex:100,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        <div style={{maxWidth:980,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:52}}>
          {/* Logo */}
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:20}}>🍽️</span>
            <span style={{fontSize:15,fontWeight:800,fontFamily:"'Playfair Display', serif",color:"#0F172A"}}>Meal Planner</span>
          </div>

          {/* Nav desktop */}
          <nav className="top-nav" style={{display:"flex",gap:2}}>
            {tabs.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)}
                style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:8,border:"none",
                  background:tab===t.id?"#FFF7ED":"transparent",
                  color:tab===t.id?"#C2622D":"#64748B",
                  fontWeight:tab===t.id?700:500,fontSize:13,cursor:"pointer",fontFamily:"inherit",
                  borderBottom:tab===t.id?"2px solid #C2622D":"2px solid transparent"}}>
                <span>{t.emoji}</span>{t.label}
              </button>
            ))}
          </nav>

          {/* Titre page courante sur mobile */}
          <span className="app-header-title" style={{display:"none",fontSize:14,fontWeight:700,color:"#0F172A",position:"absolute",left:"50%",top:"50%",transform:"translate(-50%,-50%)"}}>
            {TAB_TITLES[tab]}
          </span>

          {/* Bouton erreurs */}
          {errorCount>0&&(
            <button onClick={()=>setShowErrorPanel(true)}
              style={{padding:"4px 8px",background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:6,color:"#DC2626",fontSize:11,cursor:"pointer",fontWeight:700}}>
              ⚠️ {errorCount}
            </button>
          )}
        </div>
      </div>

      {/* ── Contenu ── */}
      <div className="app-content tab-content" key={tab} style={{maxWidth:980,margin:"0 auto",padding:"20px 20px",paddingBottom:"calc(20px + env(safe-area-inset-bottom))"}}>
        {tab==="recettes"  &&<RecettesTab  toast={toast}/>}
        {tab==="planning"  &&<PlanningTab  toast={toast}/>}
        {tab==="courses"   &&<CoursesTab   toast={toast}/>}
        {tab==="frigo"     &&<FrigoTab     toast={toast} onCookWith={(item)=>{setFrigoCookTarget(item);setTab("discovery");}}/>}
        {tab==="discovery" &&<DiscoveryTab toast={toast} frigoCookTarget={frigoCookTarget} clearFrigoTarget={()=>setFrigoCookTarget(null)}/>}
      </div>

      {/* ── Bottom tab bar (mobile only) ── */}
      <nav className="bottom-nav" style={{
        position:"fixed",bottom:0,left:0,right:0,zIndex:200,
        background:"#FFFFFF",borderTop:"1px solid #F1F5F9",
        display:"flex",
        paddingBottom:"env(safe-area-inset-bottom)",
        boxShadow:"0 -4px 20px rgba(0,0,0,0.06)",
      }}>
        {tabs.map(t=>{
          const active=tab===t.id;
          return(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
              gap:3,padding:"12px 4px 10px",border:"none",background:"transparent",
              color:active?"#C2622D":"#94A3B8",cursor:"pointer",fontFamily:"inherit",
              position:"relative",transition:"color 0.15s",
            }}>
              {active&&<div style={{position:"absolute",top:0,left:"15%",right:"15%",height:3,background:"#C2622D",borderRadius:"0 0 3px 3px"}}/>}
              <span style={{fontSize:22,lineHeight:1,filter:active?"none":"grayscale(30%) opacity(0.6)"}}>{t.emoji}</span>
              <span style={{fontSize:11,fontWeight:active?700:400,color:active?"#C2622D":"#94A3B8",letterSpacing:"0.01em"}}>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {toastMsg&&<Toast message={toastMsg} onClose={()=>setToastMsg(null)}/>}
      {showErrorPanel&&<ErrorPanel onClose={()=>{setShowErrorPanel(false);setErrorCount(0);}}/>}
    </div>
  );
}
