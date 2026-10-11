// ── Cache des données Notion ─────────────────────────────────────────────────
// Stratégie "stale-while-revalidate" :
//  - les données sont gardées en mémoire ET dans localStorage → disponibles
//    instantanément, même après fermeture de l'app ;
//  - un onglet affiche tout de suite la dernière version connue, puis la rafraîchit
//    en arrière-plan si elle a plus de CACHE_TTL.
const STORE_PREFIX = "mp-cache:v1:";
export const CACHE_TTL = 2*60*1000;
export const cache = {};
export const cacheTime = {};

function readStore(k){
  if(k in cache) return;
  try{
    const raw=localStorage.getItem(STORE_PREFIX+k);
    if(!raw) return;
    const {t,d}=JSON.parse(raw);
    cache[k]=d; cacheTime[k]=t;
  }catch{/* stockage indisponible ou corrompu : on ignore */}
}
/** Données fraîches (< TTL) ou null — sémantique historique. */
export function getCached(k){readStore(k);return cache[k]&&Date.now()-(cacheTime[k]||0)<CACHE_TTL?cache[k]:null;}
/** Dernière version connue, quel que soit son âge (pour un affichage immédiat). */
export function peekCached(k){readStore(k);return cache[k]||null;}
export function isFresh(k){readStore(k);return !!cache[k]&&Date.now()-(cacheTime[k]||0)<CACHE_TTL;}
export function setCache(k,d){
  cache[k]=d; cacheTime[k]=d?Date.now():0;
  try{
    if(d) localStorage.setItem(STORE_PREFIX+k,JSON.stringify({t:cacheTime[k],d}));
    else localStorage.removeItem(STORE_PREFIX+k);
  }catch{/* quota dépassé : le cache mémoire suffit */}
}
