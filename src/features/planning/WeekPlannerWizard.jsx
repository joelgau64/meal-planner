import { useEffect, useRef, useState } from "react";
import { DB_PLANNING, DB_RECETTES, DEFAULT_PORTIONS } from "../../lib/constants";
import { localISO } from "../../lib/dates";
import { logError } from "../../lib/errors";
import { nCheck, nDate, nNum, nSel, nText, nTitle, nUrl, notionCreate } from "../../lib/notion";
import { Icon } from "../../ui/Icon";

// ── Assistant Planifier ma semaine ────────────────────────────────────────────
// Semaine type : 7 dîners + 2 déjeuners (samedi, dimanche)
export function WeekPlannerWizard({recettes,planning,onClose,onConfirm,toast}){
  const [saving,setSaving]=useState(false);
  const [discoveryPool,setDiscoveryPool]=useState([]);
  const [discoveryLoading,setDiscoveryLoading]=useState(true);

  // Charger ~6 recettes découverte (Spoonacular) pour injection à ~25%
  useEffect(()=>{
    const month=new Date().getMonth()+1;
    const saison=month>=3&&month<=5?"printemps":month>=6&&month<=8?"été":month>=9&&month<=11?"automne":"hiver";
    fetch("/api/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:`plat familial ${saison} facile`})})
      .then(r=>r.json())
      .then(d=>{
        const pool=(d.results||[]).filter(r=>r.spoonacularId).slice(0,6)
          .map(r=>({...r,isDiscovery:true,nom:r.titre}));
        setDiscoveryPool(pool);
      })
      .catch(()=>{})
      .finally(()=>setDiscoveryLoading(false));
  },[]);

  // Slots de la semaine prochaine (lundi → dimanche)
  const buildSlots=()=>{
    const now=new Date();const day=now.getDay();
    const monday=new Date(now);monday.setDate(now.getDate()-(day===0?6:day-1)+7); // semaine prochaine
    const slots=[];
    for(let i=0;i<7;i++){
      const d=new Date(monday);d.setDate(monday.getDate()+i);
      const dateStr=localISO(d);
      slots.push({date:dateStr,moment:"Dîner",label:d.toLocaleDateString("fr-FR",{weekday:"short",day:"numeric"})});
      if(i===5||i===6){ // samedi, dimanche → déjeuner aussi
        slots.push({date:dateStr,moment:"Déjeuner",label:d.toLocaleDateString("fr-FR",{weekday:"short",day:"numeric"})});
      }
    }
    return slots.sort((a,b)=>a.date.localeCompare(b.date)||( a.moment==="Déjeuner"?-1:1));
  };

  // Détection poisson / pâtes par mots-clés (nom + ingrédients)
  const FISH_KW=/saumon|cabillaud|lieu|poisson|thon|crevette|truite|dorade|daurade|bar\b|colin|merlu|sole|maquereau|sardine|moule|fruits de mer|gambas|encornet|calamar/i;
  const PASTA_KW=/p[âa]tes|spaghetti|penne|tagliatelle|lasagne|rigatoni|macaroni|linguine|fusilli|gnocchi|nouilles|orzo|coquillette|farfalle|ravioli|cannelloni/i;
  const isFish=r=>FISH_KW.test((r.nom||"")+" "+(r.ingredients||""));
  const isPasta=r=>PASTA_KW.test((r.nom||"")+" "+(r.ingredients||""));

  // Scorer + sélection sous contraintes :
  // - jamais 2x la même recette (garanti par le pool)
  // - max 3 plats de pâtes / semaine
  // - ≥1 poisson si aucun poisson cuisiné dans les 7 derniers jours
  const suggestRecettes=(count)=>{
    const scored=[...recettes]
      .filter(r=>!["Dessert","Sauce & Marinade"].includes(r.categorie))
      .map(r=>{
        let score=0;
        if(!r.derniere_cuisson)score+=100;
        else score+=Math.min((Date.now()-new Date(r.derniere_cuisson).getTime())/(1000*3600*24),90);
        score+=((r.note||"").length)*5;
        score+=(r.likes||0)*3-(r.dislikes||0)*5;
        score+=Math.random()*15;
        return {r,score};
      }).sort((a,b)=>b.score-a.score);

    // Sélection greedy avec cap pâtes
    const picked=[];
    let pastaCount=0;
    for(const {r} of scored){
      if(picked.length>=count)break;
      if(isPasta(r)){
        if(pastaCount>=3)continue;
        pastaCount++;
      }
      picked.push(r);
    }

    // Règle poisson : si aucun poisson dans la sélection ET aucun cuisiné ces 7 derniers jours
    const hasFishPicked=picked.some(isFish);
    if(!hasFishPicked){
      const weekAgo=localISO(new Date(Date.now()-7*24*3600*1000));
      const fishRecently=planning.some(p=>p.fait&&p.date&&p.date>=weekAgo&&(()=>{
        const r=recettes.find(x=>x.id===p.recette_id||x.nom===(p.recette||p.repas));
        return r&&isFish(r);
      })());
      if(!fishRecently){
        const bestFish=scored.find(({r})=>isFish(r)&&!picked.includes(r));
        if(bestFish){
          // Remplacer la moins bien scorée non-poisson
          for(let i=picked.length-1;i>=0;i--){
            if(!isFish(picked[i])){picked[i]=bestFish.r;break;}
          }
        }
      }
    }
    return picked;
  };

  const slots=useRef(buildSlots()).current;
  const [assignments,setAssignments]=useState(()=>{
    const sugg=suggestRecettes(slots.length);
    return slots.map((slot,i)=>({...slot,recette:sugg[i]||null,accepted:true}));
  });

  // Quand le pool découverte arrive : remplacer ~25% des slots (jamais 2 consécutifs)
  useEffect(()=>{
    if(discoveryPool.length===0)return;
    setAssignments(prev=>{
      const count=Math.max(1,Math.round(prev.length*0.25));
      const next=[...prev];
      let placed=0;
      for(let i=1;i<next.length&&placed<count&&placed<discoveryPool.length;i+=3){
        next[i]={...next[i],recette:discoveryPool[placed]};
        placed++;
      }
      return next;
    });
  },[discoveryPool]);

  const swapRecette=(idx)=>{
    const used=new Set(assignments.filter(a=>a.recette).map(a=>a.recette.id||a.recette.spoonacularId));
    const localPool=recettes.filter(r=>!used.has(r.id)&&!["Dessert","Sauce & Marinade"].includes(r.categorie));
    const discPool=discoveryPool.filter(r=>!used.has(r.spoonacularId));
    // 25% de chance de proposer une découverte si dispo
    const useDiscovery=discPool.length>0&&Math.random()<0.25;
    const pool=useDiscovery?discPool:localPool.length>0?localPool:discPool;
    if(pool.length===0){toast("Plus de recettes disponibles");return;}
    const next=pool[Math.floor(Math.random()*pool.length)];
    setAssignments(a=>a.map((x,i)=>i===idx?{...x,recette:next}:x));
  };

  const toggleSlot=(idx)=>{
    setAssignments(a=>a.map((x,i)=>i===idx?{...x,accepted:!x.accepted}:x));
  };

  const confirm=async()=>{
    setSaving(true);
    const toCreate=assignments.filter(a=>a.accepted&&a.recette);
    let ok=0;
    for(const a of toCreate){
      try{
        let recetteId=a.recette.id;
        let recetteNom=a.recette.nom;
        // Recette découverte → import Spoonacular dans Notion d'abord (0 crédit Claude)
        if(a.recette.isDiscovery&&a.recette.spoonacularId){
          const full=await fetch("/api/spoonacular-recipe?id="+a.recette.spoonacularId).then(r=>r.json());
          if(full?.nom){
            const created=await notionCreate(DB_RECETTES,{
              "Nom":nTitle(full.nom),"Catégorie":nSel(full.categorie||"Dîner"),
              "Temps de préparation":nNum(full.temps),"Portions":nNum(full.portions||DEFAULT_PORTIONS),
              "Ingrédients":nText(full.ingredients||""),"Instructions":nText(full.instructions||""),
              "Likes":nNum(0),"Dislikes":nNum(0),"Fois cuisinée":nNum(0),
              ...(full.source?{"Source":nUrl(full.source)}:{}),
              ...(full.photo?{"Photo":nUrl(full.photo)}:{}),
            });
            recetteId=created?.object==="skip"?created.existing.id:created.id;
            recetteNom=full.nom;
          }
        }
        await notionCreate(DB_PLANNING,{
          "Repas":nTitle(recetteNom),
          "Date":nDate(a.date),
          "Moment":nSel(a.moment),
          "Recette":nText(recetteNom),
          "Recette ID":nText(recetteId||""),
          "Portions":nNum(a.recette.portions||DEFAULT_PORTIONS),
          "File d'attente":nCheck(false),
        });
        ok++;
      }catch(e){logError("weekPlanner",e,{recette:a.recette.nom});}
    }
    setSaving(false);
    toast(ok+" repas planifiés pour la semaine prochaine ✓");
    onConfirm();
  };

  return(
    <div style={{position:"fixed",inset:0,zIndex:2500,background:"rgba(28,25,23,0.6)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div className="modal-inner" style={{background:"var(--surface)",borderRadius:14,maxWidth:520,width:"100%",maxHeight:"85vh",overflow:"auto",padding:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
          <h3 style={{margin:0,fontSize:17,fontWeight:700,color:"var(--text)",letterSpacing:"-0.02em"}}>Planifier ma semaine</h3>
          <button onClick={onClose} aria-label="Fermer" className="icon-btn"><Icon name="close" size={18}/></button>
        </div>
        <p style={{fontSize:12,color:"var(--muted)",marginTop:0,marginBottom:14}}>Semaine prochaine · 7 dîners + week-end déjeuners. Les recettes les moins cuisinées récemment sont proposées en premier. ↻ pour changer, décocher pour sauter.</p>

        {assignments.map((a,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 10px",background:a.accepted?"#FFFFFF":"var(--bg)",border:"1px solid var(--border)",borderRadius:10,marginBottom:6,opacity:a.accepted?1:0.5}}>
            <input type="checkbox" checked={a.accepted} onChange={()=>toggleSlot(i)} style={{width:18,height:18,accentColor:"var(--accent)",flexShrink:0}}/>
            <div style={{width:64,flexShrink:0}}>
              <div style={{fontSize:11,fontWeight:700,color:"var(--accent)",textTransform:"capitalize"}}>{a.label}</div>
              <div style={{fontSize:11,color:"var(--subtle)"}}>{a.moment}</div>
            </div>
            <span style={{flex:1,fontSize:13,color:"var(--text)",fontWeight:500,lineHeight:1.3}}>
              {a.recette?a.recette.nom:"—"}
              {a.recette?.isDiscovery&&<span style={{fontSize:11,color:"#7C3AED",marginLeft:6,background:"#F5F3FF",padding:"1px 6px",borderRadius:10}}>✨ Découverte</span>}
              {a.recette&&!a.recette.isDiscovery&&!a.recette.derniere_cuisson&&<span style={{fontSize:11,color:"var(--success)",marginLeft:6}}>jamais cuisinée</span>}
            </span>
            <button onClick={()=>swapRecette(i)} title="Changer" style={{background:"none",border:"1px solid var(--border)",borderRadius:10,padding:"4px 8px",cursor:"pointer",color:"var(--muted)",fontSize:13,flexShrink:0}}>↻</button>
          </div>
        ))}

        <button onClick={confirm} disabled={saving||assignments.filter(a=>a.accepted&&a.recette).length===0}
          style={{width:"100%",padding:"12px",background:saving?"var(--border)":"var(--accent)",border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:14,cursor:saving?"wait":"pointer",marginTop:8}}>
          {saving?"Planification en cours…":"✓ Planifier "+assignments.filter(a=>a.accepted&&a.recette).length+" repas"}
        </button>
      </div>
    </div>
  );
}
