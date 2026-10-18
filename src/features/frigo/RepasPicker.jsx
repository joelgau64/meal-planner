// Choix du repas lié à un article du frigo, en deux blocs :
//  1. « Au planning et en file » : les repas déjà prévus — les plus pertinents, affichés d'office.
//     Ceux qui correspondent à l'article (💡) passent devant, puis par date, puis la file.
//  2. « Autres recettes » : suggestions parmi les recettes non planifiées + recherche.
//     Une recette non planifiée est mise en file d'attente à l'enregistrement de l'article.
import { useState } from "react";
import { fmtJour, suggererRecettes } from "../../lib/frigo";
import { inputStyle } from "../../ui/primitives";

const n=s=>(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const APERCU=6;

// value : {planningId} | {recette} | null
export function RepasPicker({article,value,onChange,repas,recettes}){
  const [q,setQ]=useState("");
  const [tout,setTout]=useState(false);
  const [toutesAutres,setToutesAutres]=useState(false);
  const query=n(q.trim());

  const recetteDe=p=>recettes.find(r=>r.id===p.recette_id)||recettes.find(r=>n(r.nom)===n(p.recette||p.repas));
  const repasDe=r=>repas.find(p=>p.recette_id===r.id||n(p.recette||p.repas)===n(r.nom));
  const libDate=p=>p.queue||!p.date?"file d'attente":fmtJour(p.date);

  // 1) Repas prévus, notés selon l'article (nom du repas + ingrédients de sa recette).
  const notes=new Map(suggererRecettes(article,repas.map(p=>({id:p.id,nom:p.recette||p.repas,ingredients:recetteDe(p)?.ingredients||""})),repas.length)
    .map(x=>[x.recette.id,x.score]));
  const prevus=[...repas]
    .filter(p=>!query||n(p.recette||p.repas).includes(query))
    .sort((a,b)=>(notes.get(b.id)||0)-(notes.get(a.id)||0)); // tri stable : garde l'ordre date → file
  const visibles=tout||query?prevus:prevus.slice(0,APERCU);

  // 2) Autres recettes : suggestions (hors repas déjà prévus) + résultats de recherche.
  const horsPlanning=recettes.filter(r=>!repasDe(r));
  const autres=query
    ?horsPlanning.filter(r=>n(r.nom).includes(query)).slice(0,6).map(r=>({r,sugg:false}))
          // Toutes les correspondances (pas de plafond : « saumon » en touche une vingtaine), 4 visibles d'office.
      :suggererRecettes(article,horsPlanning,50).map(x=>({r:x.recette,sugg:true}));
  const autresVisibles=query||toutesAutres?autres:autres.slice(0,4);

  const selLabel=value?.planningId?(()=>{const p=repas.find(x=>x.id===value.planningId);return p?`${p.recette||p.repas} · ${libDate(p)}`:"Repas lié";})()
    :value?.recette?`${value.recette.nom} · sera ajoutée à la file`:null;

  const titre={fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em",color:"var(--subtle)",margin:"8px 2px 2px"};
  const ligne={display:"flex",alignItems:"center",gap:8,width:"100%",textAlign:"left",padding:"9px 12px",border:"none",borderRadius:10,background:"var(--surface-2)",color:"var(--text)",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"};
  const sugg={background:"#FFF7ED",color:"#9A3412"};

  if(selLabel)return(
    <div>
      <label style={{fontSize:13,fontWeight:600,color:"var(--text-2)"}}>Repas prévu <span style={{fontWeight:400,color:"var(--subtle)"}}>(optionnel)</span></label>
      <div style={{display:"flex",alignItems:"center",gap:8,marginTop:4,padding:"9px 12px",borderRadius:10,background:"var(--accent-soft)",color:"var(--accent)",fontSize:13,fontWeight:600}}>
        <span style={{flex:1}}>🍳 {selLabel}</span>
        <button type="button" onClick={()=>onChange(null)} aria-label="Retirer le lien" style={{background:"none",border:"none",color:"inherit",fontSize:16,cursor:"pointer",padding:0}}>✕</button>
      </div>
    </div>
  );

  return(
    <div>
      <label style={{fontSize:13,fontWeight:600,color:"var(--text-2)"}}>Repas prévu <span style={{fontWeight:400,color:"var(--subtle)"}}>(optionnel)</span></label>
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Chercher un repas ou une recette…" style={{...inputStyle,marginTop:4}}/>

      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        <div style={titre}>Au planning et en file ({prevus.length})</div>
        {visibles.map(p=>{const s=notes.has(p.id);return(
          <button key={p.id} type="button" onClick={()=>{onChange({planningId:p.id});setQ("");}} style={{...ligne,...(s?sugg:{})}}>
            <span style={{flex:1,minWidth:0}}>{s?"💡 ":""}{p.recette||p.repas}</span>
            <span style={{fontSize:11,fontWeight:p.queue||!p.date?400:700,whiteSpace:"nowrap",opacity:0.8}}>{libDate(p)}</span>
          </button>);})}
        {!query&&prevus.length>APERCU&&(
          <button type="button" onClick={()=>setTout(t=>!t)} style={{background:"none",border:"none",color:"var(--accent)",fontSize:12,fontWeight:600,cursor:"pointer",padding:"2px",textAlign:"left",fontFamily:"inherit"}}>
            {tout?"Réduire":`Voir les ${prevus.length-APERCU} autres`}
          </button>
        )}
        {!prevus.length&&<div style={{fontSize:12,color:"var(--subtle)",padding:"2px 4px"}}>{query?"Aucun repas prévu ne correspond":"Rien au planning ni en file"}</div>}

        {autres.length>0&&<div style={titre}>{query?"Autres recettes":`Autres recettes suggérées (${autres.length})`}</div>}
        {autresVisibles.map(({r,sugg:s})=>(
          <button key={r.id} type="button" onClick={()=>{onChange({recette:r});setQ("");}} style={{...ligne,...(s?sugg:{})}}>
            <span style={{flex:1,minWidth:0}}>{s?"💡 ":""}{r.nom}</span>
            <span style={{fontSize:11,fontWeight:400,whiteSpace:"nowrap",opacity:0.8}}>→ file d'attente</span>
          </button>
        ))}
        {!query&&autres.length>4&&(
          <button type="button" onClick={()=>setToutesAutres(t=>!t)} style={{background:"none",border:"none",color:"var(--accent)",fontSize:12,fontWeight:600,cursor:"pointer",padding:"2px",textAlign:"left",fontFamily:"inherit"}}>
            {toutesAutres?"Réduire":`Voir les ${autres.length-4} autres suggestions`}
          </button>
        )}
        {query&&!prevus.length&&!autres.length&&<div style={{fontSize:12,color:"var(--subtle)",padding:"2px 4px"}}>Aucune recette trouvée</div>}
      </div>
    </div>
  );
}
