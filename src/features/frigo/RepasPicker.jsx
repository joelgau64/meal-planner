// Choix du repas lié à un article du frigo :
//  - suggestions automatiques (recettes dont le nom/les ingrédients correspondent à l'article) ;
//  - recherche dans la file d'attente, les repas à venir ET toutes les recettes.
// Une recette pas encore planifiée est mise en file d'attente à l'enregistrement de l'article.
import { useState } from "react";
import { fmtJour, suggererRecettes } from "../../lib/frigo";
import { inputStyle } from "../../ui/primitives";

const n=s=>(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");

// value : {planningId} | {recette} | null
export function RepasPicker({article,value,onChange,repas,recettes}){
  const [q,setQ]=useState("");

  // Un repas déjà en file/planifié pour cette recette ? Alors on se lie à lui plutôt qu'à la recette.
  const repasDe=r=>repas.find(p=>p.recette_id===r.id||n(p.recette||p.repas)===n(r.nom));
  const choisirRecette=r=>{const p=repasDe(r);onChange(p?{planningId:p.id}:{recette:r});setQ("");};

  const libRepas=p=>(p.recette||p.repas)+(p.queue||!p.date?" · file d'attente":" · "+fmtJour(p.date));
  const selLabel=value?.planningId?(()=>{const p=repas.find(x=>x.id===value.planningId);return p?libRepas(p):"Repas lié";})()
    :value?.recette?`${value.recette.nom} · sera ajoutée à la file`:null;

  const suggestions=value?[]:suggererRecettes(article,recettes);
  const query=n(q.trim());
  const resRepas=query?repas.filter(p=>n(p.recette||p.repas).includes(query)).slice(0,5):[];
  const idsLies=new Set(resRepas.map(p=>p.recette_id));
  const resRecettes=query?recettes.filter(r=>n(r.nom).includes(query)&&!idsLies.has(r.id)).slice(0,6):[];

  const chip={display:"block",width:"100%",textAlign:"left",padding:"9px 12px",border:"none",borderRadius:10,background:"var(--surface-2)",color:"var(--text)",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"};
  return(
    <div>
      <label style={{fontSize:13,fontWeight:600,color:"var(--text-2)"}}>Repas prévu <span style={{fontWeight:400,color:"var(--subtle)"}}>(optionnel)</span></label>
      {selLabel?(
        <div style={{display:"flex",alignItems:"center",gap:8,marginTop:4,padding:"9px 12px",borderRadius:10,background:"var(--accent-soft)",color:"var(--accent)",fontSize:13,fontWeight:600}}>
          <span style={{flex:1}}>🍳 {selLabel}</span>
          <button type="button" onClick={()=>onChange(null)} aria-label="Retirer le lien" style={{background:"none",border:"none",color:"inherit",fontSize:16,cursor:"pointer",padding:0}}>✕</button>
        </div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:4}}>
          {suggestions.map(({recette:r})=>{const p=repasDe(r);return(
            <button key={r.id} type="button" onClick={()=>choisirRecette(r)} style={{...chip,background:"#FFF7ED",color:"#9A3412"}}>
              💡 {r.nom}<span style={{fontWeight:400}}>{p?(p.queue||!p.date?" · déjà en file":" · prévu "+fmtJour(p.date)):" · suggestion"}</span>
            </button>);})}
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Chercher une recette…" style={inputStyle}/>
          {resRepas.map(p=><button key={p.id} type="button" onClick={()=>{onChange({planningId:p.id});setQ("");}} style={chip}>{libRepas(p)}</button>)}
          {resRecettes.map(r=><button key={r.id} type="button" onClick={()=>choisirRecette(r)} style={chip}>{r.nom}<span style={{fontWeight:400,color:"var(--subtle)"}}> · recette</span></button>)}
          {query&&!resRepas.length&&!resRecettes.length&&<div style={{fontSize:12,color:"var(--subtle)",padding:"2px 4px"}}>Aucune recette trouvée</div>}
        </div>
      )}
    </div>
  );
}
