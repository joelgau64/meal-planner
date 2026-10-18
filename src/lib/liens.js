// Lien article du frigo ↔ repas du planning (partagé par Frigo et Découvrir).
// Le lien pointe vers une ENTRÉE du planning (file d'attente ou date) : c'est elle qui porte la date
// comparée à la péremption. Une recette pas encore planifiée est donc d'abord mise en file d'attente.
import { peekCached, setCache } from "./cache";
import { DB_FRIGO, DB_PLANNING, DEFAULT_PORTIONS } from "./constants";
import { parseFrigo } from "./frigo";
import { nCheck, nNum, nSel, nText, nTitle, notionCreate, notionQuery, notionUpdate, parsePlanning } from "./notion";

const n=s=>(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();

/** Repas existant (non cuisiné, en file ou à venir) pour cette recette, s'il y en a un. */
export function repasPourRecette(recette,planning,todayISO){
  return (planning||[]).find(p=>!p.fait&&(p.queue||!p.date||p.date>=todayISO)&&(p.recette_id===recette.id||n(p.recette||p.repas)===n(recette.nom)))||null;
}

/** Met la recette en file d'attente et renvoie l'entrée créée (cache planning mis à jour). */
export async function mettreEnFile(recette){
  const res=await notionCreate(DB_PLANNING,{
    "Repas":nTitle(recette.nom),"Recette":nText(recette.nom),"Recette ID":nText(recette.id),
    "Portions":nNum(recette.portions||DEFAULT_PORTIONS),"Moment":nSel("Dîner"),"File d'attente":nCheck(true),
  });
  if(!res?.id||res.object==="error")throw new Error("Impossible de mettre la recette en file d'attente");
  const entry=parsePlanning(res);
  setCache("planning",[...(peekCached("planning")||[]),entry]);
  return entry;
}

/** Lie un article à une recette : réutilise le repas existant, sinon met la recette en file. */
export async function lierArticleARecette(itemId,recette,todayISO){
  let entry=repasPourRecette(recette,peekCached("planning"),todayISO);
  const cree=!entry;
  if(!entry)entry=await mettreEnFile(recette);
  await notionUpdate(itemId,{"Planning ID":nText(entry.id)});
  const frigo=peekCached("frigo");
  if(frigo)setCache("frigo",frigo.map(f=>f.id===itemId?{...f,planningId:entry.id}:f));
  return{entry,cree};
}

/** Retire le lien d'un article. */
export async function delierArticle(itemId){
  await notionUpdate(itemId,{"Planning ID":nText("")});
  const frigo=peekCached("frigo");
  if(frigo)setCache("frigo",frigo.map(f=>f.id===itemId?{...f,planningId:""}:f));
}


/**
 * Repas cuisiné → les articles du frigo qui lui sont liés sont marqués « Consommé » (ils sortent du frigo).
 * Interroge Notion directement (le cache frigo peut être absent ou périmé). Renvoie les articles retirés.
 * Ne lève jamais : un échec ici ne doit pas bloquer le « cuisiné ».
 */
export async function consommerArticlesLies(planningId){
  if(!planningId)return[];
  try{
    const res=await notionQuery(DB_FRIGO,{and:[
      {property:"Planning ID",rich_text:{equals:planningId}},
      {property:"Consommé",checkbox:{equals:false}},
    ]});
    const lies=(res.results||[]).map(parseFrigo);
    for(const it of lies)await notionUpdate(it.id,{"Consommé":nCheck(true)});
    const ids=new Set(lies.map(i=>i.id));
    const frigo=peekCached("frigo");
    if(frigo&&ids.size)setCache("frigo",frigo.filter(f=>!ids.has(f.id)));
    return lies;
  }catch(e){
    console.error("consommerArticlesLies",e);
    return[];
  }
}
export const libRetires=lies=>lies.length?`🧊 ${lies.map(l=>l.article).join(", ")} retiré${lies.length>1?"s":""} du frigo`:"";
