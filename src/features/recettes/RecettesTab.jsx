import { useCallback, useEffect, useState } from "react";
import { AddToPlanningModal } from "../planning/AddToPlanningModal";
import { AddRecipeModal } from "./AddRecipeModal";
import { RecipeDetailModal } from "./RecipeDetailModal";
import { getCached, setCache } from "../../lib/cache";
import { DB_RECETTES } from "../../lib/constants";
import { nNum, notionQuery, notionUpdate, parseRecette } from "../../lib/notion";
import { Icon } from "../../ui/Icon";
import { RecipeThumb, ScoreBadge, Spinner, inputStyle } from "../../ui/primitives";

// ── Recettes Tab ──────────────────────────────────────────────────────────────
export function RecettesTab({toast}){
  const [recettes,setRecettes]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showAdd,setShowAdd]=useState(false);
  const [selected,setSelected]=useState(null);
  const [planningTarget,setPlanningTarget]=useState(null); // {recette, portions, mode}
  const [filter,setFilter]=useState("Toutes");
  const [sortBy,setSortBy]=useState("score");
  const [voting,setVoting]=useState(null);
  const [searchQuery,setSearchQuery]=useState("");

  const load=useCallback(async(force=false,silent=false)=>{
    const cached=getCached("recettes");
    if(cached&&!force){setRecettes(cached);setLoading(false);return;}
    if(!silent)setLoading(true);
    try{const data=await notionQuery(DB_RECETTES);const parsed=(data.results||[]).map(parseRecette);setRecettes(parsed);setCache("recettes",parsed);}catch(e){console.error(e);}
    if(!silent)setLoading(false);
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
            style={{width:"100%",padding:"10px 14px 10px 36px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,fontSize:13,color:"var(--text)",outline:"none",fontFamily:"inherit"}}
          />
          <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"var(--subtle)",display:"flex"}}><Icon name="search" size={16}/></span>
          {searchQuery&&<button onClick={()=>setSearchQuery("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"var(--subtle)",cursor:"pointer",fontSize:16,lineHeight:1}}>✕</button>}
        </div>
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,gap:12,flexWrap:"wrap"}}>
        <div className="chip-row" style={{display:"flex",gap:8,overflowX:"auto",flex:"1 1 100%",margin:"0 -14px",padding:"0 14px 2px"}}>
          {cats.map(c=>(<button key={c} onClick={()=>setFilter(c)} style={{padding:"6px 14px",borderRadius:999,fontSize:12,fontWeight:600,cursor:"pointer",border:"1px solid",borderColor:filter===c?"var(--text)":"var(--border)",background:filter===c?"var(--text)":"#FFFFFF",color:filter===c?"#fff":"var(--text-2)",whiteSpace:"nowrap"}}>{c}</button>))}
        </div>
        <div style={{display:"flex",gap:8}}>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{...inputStyle,width:"auto",fontSize:12,padding:"6px 10px"}}><option value="score">Score</option><option value="cuisinee">Plus cuisinée</option><option value="recent">À refaire</option></select>
          <button onClick={()=>load(true)} style={{padding:"8px 10px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,color:"var(--muted)",cursor:"pointer"}}><Icon name="refresh" size={14}/></button>
          <button onClick={async()=>{toast("Récupération des photos...");const res=await fetch('/api/sync-photos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});const data=await res.json();toast(`Photos: ${data.updated} mises à jour ✓`);load(true);}} title="Récupérer les photos" style={{padding:"8px 10px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,color:"var(--muted)",cursor:"pointer",display:"flex"}}><Icon name="image" size={14}/></button>
          <button onClick={()=>setShowAdd(true)} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 16px",background:"var(--accent)",border:"none",borderRadius:10,color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer"}}><Icon name="plus" size={16}/>Nouvelle</button>
        </div>
      </div>

      {loading?<Spinner label="Chargement des recettes..."/>:(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(min(100%,160px), 1fr))",gap:12}}>
          {sorted.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",padding:48,color:"var(--muted)"}}><div style={{fontSize:40,marginBottom:12}}>📖</div><div style={{fontSize:14}}>Aucune recette.</div></div>}
          {sorted.map((r,i)=>(
            <div key={r.id||i} className="card" style={{overflow:"hidden",cursor:"pointer",display:"flex",flexDirection:"column"}}>
              <RecipeThumb recette={r} onClick={()=>setSelected(r)}/>
              <div style={{padding:14}} onClick={()=>setSelected(r)}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                  <h4 style={{margin:0,fontSize:15,fontWeight:600,color:"var(--text)",letterSpacing:"-0.01em",lineHeight:1.3,flex:1,marginRight:8,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{r.nom||"Sans titre"}</h4>
                  <ScoreBadge score={score(r)}/>
                </div>
                {r.categorie&&<span style={{fontSize:11,fontWeight:600,padding:"3px 8px",borderRadius:10,background:"var(--surface-2)",color:"var(--muted)"}}>{r.categorie}</span>}
                <div style={{marginTop:8,display:"flex",gap:10,fontSize:11,color:"var(--muted)",flexWrap:"wrap"}}>
                  {r.temps>0&&<span style={{display:"inline-flex",alignItems:"center",gap:4}}><Icon name="clock" size={12}/>{r.temps} min</span>}
                  {r.fois_cuisinee>0&&<span>{r.fois_cuisinee}× cuisinée</span>}
                </div>
              </div>
              <div style={{display:"flex",gap:0,borderTop:"1px solid #F0EDEA",marginTop:"auto"}} onClick={e=>e.stopPropagation()}>
                <button onClick={()=>vote(r,"up")} disabled={voting===r.id+"up"} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"8px",background:"transparent",border:"none",borderRight:"1px solid #F0EDEA",color:"var(--muted)",cursor:"pointer",fontSize:12,fontWeight:600}}><Icon name="thumb_up" size={12}/>{r.likes||0}</button>
                <button onClick={()=>vote(r,"down")} disabled={voting===r.id+"down"} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"8px",background:"transparent",border:"none",color:"var(--subtle)",cursor:"pointer",fontSize:12,fontWeight:600}}><Icon name="thumb_down" size={12}/>{r.dislikes||0}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd&&<AddRecipeModal onClose={()=>setShowAdd(false)} onSaved={(msg)=>{toast(msg);load(true,true);}}/>}

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
