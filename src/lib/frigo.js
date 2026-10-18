// Utilitaires de la base Frigo (partagés par l'onglet et le chargeur de données).

export function parseFrigo(page){
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
    planningId:getR(p["Planning ID"]),
  };
}

export function joursAvant(dateStr){
  if(!dateStr)return null;
  const d=new Date(dateStr+"T00:00");
  const now=new Date();now.setHours(0,0,0,0);
  return Math.round((d-now)/(1000*3600*24));
}

// Lien optionnel article ↔ repas (file d'attente ou planifié).
// Renvoie null si pas de lien exploitable, sinon {entry, statut:"file"|"ok"|"apres", jours}
// « apres » = le repas est planifié après la date de péremption → alerte.
export function lienPlanning(item,planning){
  if(!item?.planningId)return null;
  const entry=(planning||[]).find(p=>p.id===item.planningId);
  if(!entry||entry.fait)return null;
  if(entry.queue||!entry.date)return{entry,statut:"file"};
  if(item.peremption&&entry.date>item.peremption)return{entry,statut:"apres"};
  return{entry,statut:"ok"};
}

// Repas proposables pour un lien : file d'attente + repas à venir non cuisinés.
export function repasLiables(planning,todayISO){
  return (planning||[])
    .filter(p=>!p.fait&&(p.queue||(p.date&&p.date>=todayISO)))
    .sort((a,b)=>(a.queue?1:0)-(b.queue?1:0)||String(a.date).localeCompare(String(b.date)));
}

export const fmtJour=iso=>iso?new Date(iso+"T00:00").toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"numeric"}):"";

// ── Suggestion de recette pour un article (déterministe, sans IA) ────────────
const norm=s=>(s||"").toLowerCase().replace(/œ/g,"oe").replace(/æ/g,"ae").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const STOP=new Set(["de","du","des","la","le","les","d","l","a","au","aux","et","en","sans","avec","nature","bio","label","rouge","francais","france","origine","race","superieur","cuit","cuite","frais","fraiche","x","g","kg"]);
// Morceaux / formes : utiles mais moins discriminants que l'animal (« épaule d'agneau » → c'est « agneau » qui compte).
const GENERIQUES=new Set(["epaule","filet","filets","cuisse","cuisses","roti","tranche","tranches","steak","steaks","pave","paves","hache","hachee","viande","morceau","morceaux","gigot","cote","cotes","escalope","escalopes","blanc","blancs","dos","emince","emincee","piece","pieces","entier","entiere"]);
const racine=w=>w.length>4?w.replace(/(s|x)$/,""):w;
export function motsCles(article){
  return [...new Set(norm(article).split(/[^a-z0-9]+/).filter(w=>w.length>1&&!STOP.has(w)).map(racine))];
}
/** Classe recettes et repas par pertinence pour un article. Renvoie [{score, recette}] trié. */
export function suggererRecettes(article,recettes,max=3){
  const mots=motsCles(article);if(!mots.length)return[];
  return (recettes||[]).map(r=>{
    const nom=norm(r.nom),ing=norm(r.ingredients);
    let score=0;
    for(const m of mots){
      const poids=GENERIQUES.has(m)?0.5:2;
      const re=new RegExp(`\\b${m}`);
      if(re.test(nom))score+=poids*1.5;
      else if(re.test(ing))score+=poids;
    }
    return{score,recette:r};
  }).filter(x=>x.score>=2).sort((a,b)=>b.score-a.score).slice(0,max);
}
