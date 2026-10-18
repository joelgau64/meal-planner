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
