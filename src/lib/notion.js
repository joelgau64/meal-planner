import { DB_RECETTES, DEFAULT_PORTIONS } from "./constants";
import { logError } from "./errors";

// ── Notion API ────────────────────────────────────────────────────────────────
// Notion limite à ~3 requêtes/s et renvoie 429 (rate_limited) ou 409 (conflict) au-delà.
// Avant : ces réponses étaient traitées comme des échecs définitifs → écritures en rafale
// (nettoyage de liste, imports) perdues. On réessaie avec un délai croissant.
const RETRY_STATUS=new Set([409,429,500,502,503,504]);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function notionFetch(path,init,tries=5){
  for(let i=0;;i++){
    const res=await fetch(`/api/notion?path=${path}`,init);
    if(!RETRY_STATUS.has(res.status)||i>=tries-1)return res.json();
    const ra=Number(res.headers.get("retry-after"));
    await sleep(ra>0?ra*1000:400*2**i);
  }
}
export async function notionQuery(dbId,filter,sorts){
  const all=[];
  let cursor=undefined;
  try{
    do{
      const body={page_size:100};
      if(filter)body.filter=filter;
      if(sorts)body.sorts=sorts;
      if(cursor)body.start_cursor=cursor;
      const data=await notionFetch(`/v1/databases/${dbId}/query`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
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
export async function notionCreate(dbId,properties){
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
  const data=await notionFetch(`/v1/pages`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({parent:{database_id:dbId},properties})});
  if(data.object==="error") logError("notionCreate",new Error(data.message),{dbId});
  return data;
}
export async function notionUpdate(pageId,properties){
  const data=await notionFetch(`/v1/pages/${pageId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({properties})});
  if(data.object==="error") logError("notionUpdate",new Error(data.message),{pageId,props:Object.keys(properties)});
  return data;
}
export async function notionArchive(pageId){
  const data=await notionFetch(`/v1/pages/${pageId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({archived:true})});
  if(data.object==="error") logError("notionArchive",new Error(data.message),{pageId});
  return data;
}

// ── Notion helpers ────────────────────────────────────────────────────────────
// Notion limite chaque segment rich_text à 2000 caractères, mais accepte jusqu'à 100 segments.
// Avant : .slice(0,2000) → instructions/ingrédients longs tronqués EN SILENCE à l'enregistrement.
export const nText=s=>{const str=String(s||"");const chunks=[];for(let i=0;i<str.length&&chunks.length<100;i+=2000)chunks.push({text:{content:str.slice(i,i+2000)}});return{rich_text:chunks};};
export const nTitle=s=>({title:[{text:{content:String(s||"")}}]});
export const nNum=n=>({number:Number(n)||0});
export const nSel=s=>{
  if(!s)return{select:null};
  // Notion interdit les virgules dans les options de select.
  // Une virgule = souvent une description parasite renvoyée par la Vision :
  // on garde ce qui précède la 1re virgule, nettoyé et borné à 100 caractères.
  let v=String(s).split(",")[0].trim().slice(0,100);
  return v?{select:{name:v}}:{select:null};
};
export const nDate=d=>d?{date:{start:d}}:{date:null};
export const nCheck=b=>({checkbox:!!b});
export const nUrl=u=>u?{url:u}:{url:null};

export function getTitle(page){const t=page.properties;for(const k of Object.keys(t)){if(t[k].type==="title"&&t[k].title?.[0]?.plain_text)return t[k].title[0].plain_text;}return"";}
export function getText(p){return (p?.rich_text||[]).map(t=>t.plain_text||"").join("");} // tous les segments, pas seulement le 1er
export function getSelect(p){return p?.select?.name||"";}
export function getNum(p){return p?.number||0;}
export function getCheck(p){return p?.checkbox||false;}
export function getDate(p){return p?.date?.start||null;}
export function getUrl(p){return p?.url||null;}

export function parseRecette(page){
  const p=page.properties;
  return{id:page.id,nom:getTitle(page),categorie:getSelect(p["Catégorie"]),temps:getNum(p["Temps de préparation"]),portions:getNum(p["Portions"])||DEFAULT_PORTIONS,ingredients:getText(p["Ingrédients"]),instructions:getText(p["Instructions"]),note:getSelect(p["Note"]),likes:getNum(p["Likes"]),dislikes:getNum(p["Dislikes"]),fois_cuisinee:getNum(p["Fois cuisinée"]),derniere_cuisson:getDate(p["Dernière cuisson"]),photo:getUrl(p["Photo"]),sourceUrl:getUrl(p["Source"])||getText(p["Source URL"])||"",commentaires:getText(p["Commentaires"])||""};
}
export function parsePlanning(page){
  const p=page.properties;
  return{id:page.id,repas:getTitle(page),date:getDate(p["Date"]),moment:getSelect(p["Moment"]),recette:getText(p["Recette"]),recette_id:getText(p["Recette ID"]),portions:getNum(p["Portions"])||DEFAULT_PORTIONS,notes:getText(p["Notes"]),fait:getCheck(p["Cuisiné"]),queue:getCheck(p["File d'attente"])};
}
// Base « Ingrédients » (dictionnaire de normalisation des courses).
export function parseIngredientEntry(page){
  const p=page.properties;
  return{id:page.id,nom:getTitle(page),alias:getText(p["Alias"]),categorie:getSelect(p["Catégorie"]),gardeManger:getCheck(p["Garde-manger"])};
}
export function parseCourse(page){
  const p=page.properties;
  return{id:page.id,article:getTitle(page),categorie:getSelect(p["Catégorie"]),quantite:getText(p["Quantité"]),achete:getCheck(p["Acheté"]),semaine:getText(p["Semaine"]),recette:getText(p["Recette"])};
}
