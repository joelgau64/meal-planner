// ── Chargement des données Notion, mutualisé ─────────────────────────────────
// Un seul endroit sait comment charger chaque base. Les appels simultanés pour la
// même base partagent la même requête (pas de doublon quand un onglet et le
// préchargement demandent la même chose au même moment).
import { DB_COURSES, DB_FRIGO, DB_PLANNING, DB_RECETTES } from "./constants";
import { localISO } from "./dates";
import { isFresh, peekCached, setCache } from "./cache";
import { notionQuery, parseCourse, parsePlanning, parseRecette } from "./notion";
import { joursAvant, parseFrigo } from "./frigo";

// Planning : 8 dernières semaines + futur + file d'attente + repas sans date.
export const PLANNING_HISTORY_DAYS=56;
export function planningWindowFilter(){
  const since=localISO(new Date(Date.now()-PLANNING_HISTORY_DAYS*864e5));
  return {or:[
    {property:"Date",date:{on_or_after:since}},
    {property:"Date",date:{is_empty:true}},
    {property:"File d'attente",checkbox:{equals:true}},
  ]};
}

const LOADERS={
  recettes:async()=>(await notionQuery(DB_RECETTES)).results.map(parseRecette),
  planning:async()=>(await notionQuery(DB_PLANNING,planningWindowFilter())).results.map(parsePlanning),
  courses:async()=>(await notionQuery(DB_COURSES)).results.map(parseCourse),
  // Filtre côté Notion : avant, tous les produits déjà consommés étaient téléchargés puis jetés.
  frigo:async()=>{
    const items=(await notionQuery(DB_FRIGO,{property:"Consommé",checkbox:{equals:false}})).results.map(parseFrigo);
    return items.sort((a,b)=>{const ja=joursAvant(a.peremption),jb=joursAvant(b.peremption);if(ja==null)return 1;if(jb==null)return -1;return ja-jb;});
  },
};
const inflight={};
/** Charge depuis Notion, met en cache, renvoie les données. Requêtes identiques mutualisées. */
export function fetchAndCache(k){
  if(!inflight[k]) inflight[k]=LOADERS[k]().then(d=>{setCache(k,d);return d;}).finally(()=>{delete inflight[k];});
  return inflight[k];
}
/**
 * Chargement standard d'un onglet :
 *  - affiche immédiatement la dernière version connue (onCached) ;
 *  - recharge si absente, périmée ou si force=true, puis appelle onFresh.
 * Renvoie true si un spinner est nécessaire (aucune donnée à montrer).
 */
export function loadWithCache(k,{force=false,onCached,onFresh,onError}){
  const peek=peekCached(k);
  if(peek&&onCached) onCached(peek);
  if(peek&&!force&&isFresh(k)) return {needSpinner:false,promise:Promise.resolve(peek)};
  const promise=fetchAndCache(k).then(d=>{onFresh&&onFresh(d);return d;}).catch(e=>{onError&&onError(e);});
  return {needSpinner:!peek,promise};
}
/** Préchargement en tâche de fond de tout ce qui est périmé. */
export function prefetchStale(keys=Object.keys(LOADERS)){
  for(const k of keys) if(!isFresh(k)) fetchAndCache(k).catch(()=>{});
}
