import { useEffect, useRef, useState } from "react";
import { getCached, setCache } from "../../lib/cache";
import { localISO } from "../../lib/dates";
import { logError } from "../../lib/errors";
import { splitIngredientLines } from "../../lib/ingredients";
import { nCheck, nDate, nNum, notionUpdate } from "../../lib/notion";
import { Icon } from "../../ui/Icon";

// ── Recipe Detail Modal ───────────────────────────────────────────────────────
// Détecte les durées dans une étape
export function detectTimer(text){
  const t=text.toLowerCase();
  let seconds=0;
  const h=t.match(/(\d+)\s*h(?:eure)?/);
  const m=t.match(/(\d+)\s*min/);
  const s=t.match(/(\d+)\s*sec/);
  if(h)seconds+=parseInt(h[1])*3600;
  if(m)seconds+=parseInt(m[1])*60;
  if(s)seconds+=parseInt(s[1]);
  return seconds>0?seconds:null;
}

export function playAlarm(){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    [0,0.3,0.6].forEach(t=>{
      const o=ctx.createOscillator();const g=ctx.createGain();
      o.connect(g);g.connect(ctx.destination);
      o.frequency.value=880;o.type="sine";
      g.gain.setValueAtTime(0.4,ctx.currentTime+t);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+t+0.4);
      o.start(ctx.currentTime+t);o.stop(ctx.currentTime+t+0.5);
    });
  }catch(e){}
}

export function StepTimer({seconds,stepIdx}){
  const [remaining,setRemaining]=useState(seconds);
  const [running,setRunning]=useState(false);
  const [done,setDone]=useState(false);
  const intervalRef=useRef(null);
  const endTimeRef=useRef(null);   // timestamp (ms) de fin — source de vérité
  const doneRef=useRef(false);

  // Recalcule le restant depuis l'horloge réelle (résiste à l'écran éteint)
  const tick=()=>{
    if(endTimeRef.current==null)return;
    const left=Math.max(0,Math.round((endTimeRef.current-Date.now())/1000));
    setRemaining(left);
    if(left<=0&&!doneRef.current){
      doneRef.current=true;
      clearInterval(intervalRef.current);
      setRunning(false);setDone(true);playAlarm();
    }
  };

  useEffect(()=>{
    if(running){
      // (re)poser l'échéance si pas déjà fixée
      if(endTimeRef.current==null) endTimeRef.current=Date.now()+remaining*1000;
      intervalRef.current=setInterval(tick,1000);
      tick();
    }
    return()=>clearInterval(intervalRef.current);
  },[running]);

  // Au retour d'écran/onglet : recalcul immédiat (rattrape le temps écoulé hors-ligne)
  useEffect(()=>{
    const onVis=()=>{ if(document.visibilityState==="visible"&&running) tick(); };
    document.addEventListener("visibilitychange",onVis);
    return()=>document.removeEventListener("visibilitychange",onVis);
  },[running]);

  const toggle=()=>{
    setRunning(r=>{
      const next=!r;
      if(next){ endTimeRef.current=Date.now()+remaining*1000; }
      else { endTimeRef.current=null; clearInterval(intervalRef.current); } // pause: fige le restant
      return next;
    });
  };

  const reset=()=>{endTimeRef.current=null;doneRef.current=false;setRemaining(seconds);setRunning(false);setDone(false);clearInterval(intervalRef.current);};
  const fmt=(s)=>{const h=Math.floor(s/3600);const m=Math.floor((s%3600)/60);const sec=s%60;return h>0?`${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`:`${m}:${String(sec).padStart(2,"0")}`;};
  const pct=((seconds-remaining)/seconds)*100;
  return(
    <div style={{marginTop:10,padding:"10px 14px",background:done?"#D1FAE5":running?"#FEF3C7":"var(--surface-2)",borderRadius:10,border:`1px solid ${done?"#6EE7B7":running?"#FCD34D":"var(--border)"}`}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:20}}>{done?"✅":running?"⏱️":"⏱"}</span>
        <span style={{fontSize:20,fontWeight:700,fontFamily:"monospace",color:done?"#065F46":running?"#92400E":"var(--text-2)",flex:1}}>{fmt(remaining)}</span>
        {!done&&<button onClick={toggle} style={{padding:"4px 12px",background:running?"#FCD34D":"var(--accent)",border:"none",borderRadius:10,color:running?"#92400E":"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>{running?"Pause":"Démarrer"}</button>}
        <button onClick={reset} style={{padding:"4px 8px",background:"none",border:"1px solid var(--border)",borderRadius:10,color:"var(--subtle)",fontSize:11,cursor:"pointer"}}>↺</button>
      </div>
      <div style={{marginTop:8,height:4,background:"var(--border)",borderRadius:2,overflow:"hidden"}}>
        <div style={{height:"100%",width:pct+"%",background:done?"#34D399":running?"#F59E0B":"var(--accent)",transition:"width 1s linear",borderRadius:2}}/>
      </div>
      {done&&<div style={{fontSize:12,color:"#065F46",fontWeight:600,marginTop:6}}>⏰ Temps écoulé !</div>}
    </div>
  );
}

export function CookingMode({recette,scaled,portions,onClose,planningEntry,onCookComplete,toast}){
  const instructions=recette.instructions
    ?recette.instructions.split("\n").filter(s=>s.trim()).map(s=>s.replace(/^\d+\.\s*/,"").trim()).filter(Boolean)
    :[];
  // Utilise les quantités déjà recalculées (scaled) passées par RecipeDetailModal,
  // pour ne pas revenir aux quantités d'origine de la recette. Fallback sur le texte
  // brut si scaled n'est pas fourni (ex: futur appel sans passer par le détail).
  const ingredients=scaled&&scaled.length
    ?scaled.map(ing=>ing.scalable
      ?`${ing.name} — ${ing.displayQty||ing.qty}${ing.unit?" "+ing.unit:""}`
      :(ing.original||ing.name))
    :splitIngredientLines(recette.ingredients);
  const [completing,setCompleting]=useState(false);
  const [fridgeConfirm,setFridgeConfirm]=useState(null); // items frigo à confirmer

  // Cherche dans le frigo (cache) les protéines mentionnées par la recette.
  const findFridgeMatches=()=>{
    const frigo=getCached("frigo")||[];
    const norm=s=>(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const hay=norm(recette.nom)+" "+norm(recette.ingredients);
    return frigo.filter(item=>{
      const kw=norm(item.article).split(" ")[0];
      return kw&&hay.includes(kw);
    });
  };

  const handleComplete=async()=>{
    if(completing)return;
    setCompleting(true);
    // Diagnostic visible : d'où vient l'appel, planningEntry présent ?
    if(!planningEntry?.id){
      toast&&toast("⚠️ Pas d'entrée planning (id manquant) — ouvre la recette depuis le planning");
      setCompleting(false);
      return;
    }
    // Marquer le planning comme Cuisiné + incrémenter Fois cuisinée
    try{
      const r1=await notionUpdate(planningEntry.id,{"Cuisiné":nCheck(true)});
      if(r1?.object==="error") throw new Error(r1.message||"Échec Cuisiné");
      if(recette.id){
        const r2=await notionUpdate(recette.id,{"Fois cuisinée":nNum((recette.fois_cuisinee||0)+1),"Dernière cuisson":nDate(localISO(new Date()))});
        if(r2?.object==="error") throw new Error(r2.message||"Échec Fois cuisinée");
      }
      toast&&toast("✓ Marqué cuisiné");
    }catch(e){logError("cookComplete",e,{recette:recette.nom});toast&&toast("Erreur : "+e.message);setCompleting(false);return;}
    // Proposer de retirer les protéines du frigo concernées
    const matches=findFridgeMatches();
    if(matches.length>0){ setFridgeConfirm(matches); setCompleting(false); }
    else { onCookComplete&&onCookComplete(); onClose(); }
  };

  const confirmFridgeRemoval=async(remove)=>{
    if(remove&&fridgeConfirm){
      const frigo=getCached("frigo")||[];
      const ids=new Set(fridgeConfirm.map(m=>m.id));
      setCache("frigo",frigo.filter(f=>!ids.has(f.id)));
      for(const item of fridgeConfirm){
        try{await notionUpdate(item.id,{"Consommé":nCheck(true)});}catch(e){logError("cookFridge",e,{item:item.article});}
      }
    }
    setFridgeConfirm(null);
    onCookComplete&&onCookComplete();
    onClose();
  };
  const total=instructions.length;

  return(
    <div style={{position:"fixed",inset:0,zIndex:2000,background:"var(--surface)",display:"flex",flexDirection:"column"}}>
      {/* Header fixe */}
      <div style={{padding:"14px 20px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:12,background:"var(--surface)",flexShrink:0,position:"sticky",top:0,zIndex:10}}>
        <button onClick={onClose} aria-label="Quitter le mode cuisine" className="icon-btn"><Icon name="close" size={20}/></button>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:12,fontWeight:600,color:"var(--subtle)"}}>Mode cuisine</div>
          <div style={{fontSize:16,fontWeight:700,color:"var(--text)",letterSpacing:"-0.02em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{recette.nom}</div>
        </div>
        <span style={{fontSize:12,color:"var(--subtle)"}}>{recette.temps} min · {portions||recette.portions||4} pers.</span>
      </div>

      {/* Scroll unique */}
      <div style={{flex:1,overflow:"auto",padding:"0 0 40px"}}>

        {/* Photo */}
        {recette.photo&&<img src={recette.photo} alt={recette.nom} style={{width:"100%",height:180,objectFit:"cover",display:"block"}} onError={e=>e.target.style.display="none"}/>}

        {/* Ingrédients */}
        <div style={{padding:"16px 20px 0"}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--accent)",marginBottom:10}}>🧂 Ingrédients</div>
          <div style={{background:"var(--accent-soft)",border:"1px solid transparent",borderRadius:14,padding:"12px 14px",marginBottom:24}}>
            {ingredients.map((ing,i)=>(
              <div key={i} style={{fontSize:13,color:"var(--text)",padding:"4px 0",borderBottom:i<ingredients.length-1?"1px solid #FED7AA":"none",lineHeight:1.5}}>{ing}</div>
            ))}
          </div>

          {/* Étapes */}
          <div style={{fontSize:11,fontWeight:700,color:"var(--accent)",marginBottom:12}}>📋 Étapes</div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {instructions.map((step,i)=>{
              const timerSec=detectTimer(step);
              return(
                <div key={i} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:14,overflow:"hidden"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"var(--bg)",borderBottom:"1px solid var(--surface-2)"}}>
                    <div style={{width:22,height:22,borderRadius:"50%",background:"var(--accent)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <span style={{fontSize:11,fontWeight:700,color:"#fff"}}>{i+1}</span>
                    </div>
                    <span style={{fontSize:11,fontWeight:600,color:"var(--text-2)"}}>Étape {i+1} / {total}</span>
                  </div>
                  <div style={{padding:"12px 14px"}}>
                    <p style={{fontSize:15,color:"var(--text)",lineHeight:1.7,margin:0,fontWeight:500}}>{step}</p>
                    {timerSec&&<StepTimer key={i} seconds={timerSec} stepIdx={i}/>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Fin */}
          {planningEntry?(
            <button onClick={handleComplete} disabled={completing} style={{width:"100%",marginTop:24,padding:"20px",background:"#EEF6F0",border:"1px solid transparent",borderRadius:14,textAlign:"center",cursor:"pointer"}}>
              <div style={{fontSize:28,marginBottom:6}}>🎉</div>
              <div style={{fontSize:15,fontWeight:700,color:"#065F46"}}>{completing?"Enregistrement…":"Bon appétit ! · Marquer comme cuisiné"}</div>
              <div style={{fontSize:11,color:"var(--success)",marginTop:4}}>Valide le repas et met à jour le frigo</div>
            </button>
          ):(
            <div style={{marginTop:24,padding:"20px",background:"#EEF6F0",border:"1px solid transparent",borderRadius:14,textAlign:"center"}}>
              <div style={{fontSize:28,marginBottom:6}}>🎉</div>
              <div style={{fontSize:15,fontWeight:700,color:"#065F46"}}>Bon appétit !</div>
            </div>
          )}
          {fridgeConfirm&&(
            <div style={{position:"fixed",inset:0,zIndex:3000,background:"rgba(28,25,23,0.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
              <div style={{background:"var(--surface)",borderRadius:14,maxWidth:440,width:"100%",padding:20}}>
                <h3 style={{margin:"0 0 8px",fontSize:16,fontWeight:700,letterSpacing:"-0.02em"}}>Mettre à jour le frigo ?</h3>
                <p style={{fontSize:13,color:"var(--muted)",margin:"0 0 12px"}}>Tu as cuisiné cette recette. Retirer {fridgeConfirm.length>1?"ces produits":"ce produit"} du frigo ?</p>
                <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
                  {fridgeConfirm.map(m=>(
                    <div key={m.id} style={{padding:"8px 12px",background:"var(--bg)",borderRadius:10,fontSize:14,fontWeight:600,color:"var(--text)"}}>{m.article}{m.forme&&m.forme!=="Autre"?` · ${m.forme}`:""}</div>
                  ))}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>confirmFridgeRemoval(false)} style={{flex:1,padding:"12px",background:"var(--surface-2)",border:"none",borderRadius:10,color:"var(--text-2)",fontWeight:600,fontSize:14,cursor:"pointer"}}>Garder</button>
                  <button onClick={()=>confirmFridgeRemoval(true)} style={{flex:1,padding:"12px",background:"#16A34A",border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>Retirer du frigo</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
