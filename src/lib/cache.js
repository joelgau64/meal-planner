
// ── Cache ─────────────────────────────────────────────────────────────────────
export const cache = {recettes:null,planning:null,courses:null};
export const cacheTime = {recettes:0,planning:0,courses:0};
export const CACHE_TTL = 5*60*1000;
export function getCached(k){return cache[k]&&Date.now()-cacheTime[k]<CACHE_TTL?cache[k]:null;}
export function setCache(k,d){cache[k]=d;cacheTime[k]=Date.now();}
