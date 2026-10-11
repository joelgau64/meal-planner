import { loadWithCache } from "../../lib/data";
import { useCallback, useEffect, useRef, useState } from "react";
import { CoursesModal } from "../courses/CoursesModal";
import { AddToPlanningModal } from "./AddToPlanningModal";
import { WeekPlannerWizard } from "./WeekPlannerWizard";
import { RecipeDetailModal } from "../recettes/RecipeDetailModal";
import { peekCached, setCache } from "../../lib/cache";
import { DAYS, DB_PLANNING, DEFAULT_PORTIONS, MOMENTS, MOMENT_COLORS } from "../../lib/constants";
import { localISO } from "../../lib/dates";
import { logError } from "../../lib/errors";
import { nCheck, nDate, nNum, nSel, nText, nTitle, notionCreate, notionUpdate } from "../../lib/notion";
import { Icon } from "../../ui/Icon";
import { Field, Modal, RecipeThumb, Spinner, btnDisabled, btnPrimary, inputStyle } from "../../ui/primitives";

// Date par défaut pour la planification : aujourd'hui, ou demain s'il est 18:00 passé.
// (Le soir, on planifie généralement pour le lendemain.)
export function defaultPlanningDate(){
  const now=new Date();
  const d=new Date(now);
  if(now.getHours()>=18) d.setDate(d.getDate()+1);
  return localISO(d);
}

// Repas dans la grille du planning. Tap = fiche recette, rond = "cuisiné", flèche = remettre en file.
// Appui long (400 ms) = glisser vers un autre jour ou vers la file.
export function MealChip({meal,recette,ctx}){
  const {planning,setPlanning,dragItem,setDragItem,setDragOver,handleDrop,touchDragRef,confirmCuisine,confirming,toast,onView,onMoveToQueue}=ctx;
  const longPressTimer=useRef(null);
  const isDragging=useRef(false);
  const touchStartPos=useRef(null);
  const handleTouchStart=e=>{
    isDragging.current=false;
    const touch=e.touches[0];
    touchStartPos.current={x:touch.clientX,y:touch.clientY};
    const node=e.currentTarget;
    longPressTimer.current=setTimeout(()=>{
      isDragging.current=true;
      navigator.vibrate?.(15);
      const ghost=node.cloneNode(true);
      ghost.style.cssText=`position:fixed;top:${touch.clientY-28}px;left:${touch.clientX-120}px;width:240px;opacity:0.92;z-index:9999;pointer-events:none;border-radius:14px;background:#fff;box-shadow:0 12px 32px rgba(28,25,23,0.18);`;
      document.body.appendChild(ghost);
      touchDragRef.current={item:meal,ghost};
      setDragItem(meal);
    },400);
  };
  const handleTouchMove=e=>{
    const touch=e.touches[0];
    if(!isDragging.current){
      if(touchStartPos.current){
        const dx=Math.abs(touch.clientX-touchStartPos.current.x),dy=Math.abs(touch.clientY-touchStartPos.current.y);
        if(dx>8||dy>8)clearTimeout(longPressTimer.current);
      }
      return;
    }
    if(!touchDragRef.current)return;
    e.preventDefault();
    touchDragRef.current.ghost.style.top=touch.clientY-28+"px";
    touchDragRef.current.ghost.style.left=touch.clientX-120+"px";
    const zone=document.elementFromPoint(touch.clientX,touch.clientY)?.closest("[data-dropzone]");
    setDragOver(zone?.dataset.dropzone||null);
  };
  const handleTouchEnd=e=>{
    clearTimeout(longPressTimer.current);
    if(!isDragging.current||!touchDragRef.current){setDragItem(null);return;}
    const item=touchDragRef.current.item;
    const touch=e.changedTouches[0];
    const zone=document.elementFromPoint(touch.clientX,touch.clientY)?.closest("[data-dropzone]");
    if(zone){
      const key=zone.dataset.dropzone;
      if(key==="queue"){
        const updated=planning.map(p=>p.id===item.id?{...p,queue:true}:p);
        setPlanning(updated);setCache("planning",updated);
        notionUpdate(item.id,{"File d'attente":nCheck(true)});
        toast(`"${item.recette||item.repas}" remis en file d'attente ✓`);
      }else handleDrop(key,undefined,item);
    }
    try{touchDragRef.current.ghost.remove();}catch{/* déjà retiré */}
    touchDragRef.current=null;
    setDragItem(null);setDragOver(null);
    isDragging.current=false;
  };
  const accent=MOMENT_COLORS[meal.moment]||"#78716C";
  const busy=confirming===meal.id;
  return(
    <div draggable onDragStart={()=>setDragItem(meal)} onDragEnd={()=>setDragItem(null)}
      onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
      className="meal-chip"
      style={{display:"flex",alignItems:"center",gap:10,padding:6,background:"var(--surface)",borderRadius:14,boxShadow:"0 0 0 1px rgba(28,25,23,0.06)",opacity:dragItem?.id===meal.id?0.35:1,cursor:"grab",WebkitUserSelect:"none",userSelect:"none"}}>
      <div className="meal-thumb" onClick={()=>onView(meal)} style={{width:44,height:44,borderRadius:10,overflow:"hidden",flexShrink:0,opacity:meal.fait?0.55:1}}>
        <RecipeThumb recette={recette||{nom:meal.recette||meal.repas}} height={44}/>
      </div>
      <div className="meal-body" onClick={()=>onView(meal)} style={{flex:1,minWidth:0,cursor:"pointer"}}>
        <div style={{fontSize:14,fontWeight:600,color:meal.fait?"var(--subtle)":"var(--text)",textDecoration:meal.fait?"line-through":"none",lineHeight:1.25,overflow:"hidden",textOverflow:"ellipsis",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{meal.recette||meal.repas}</div>
        {meal.moment&&<div style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"var(--muted)",marginTop:2}}><span style={{width:6,height:6,borderRadius:999,background:accent}}/>{meal.moment}</div>}
      </div>
      {!meal.fait&&<button onClick={e=>{e.stopPropagation();onMoveToQueue(meal);}} onTouchStart={e=>e.stopPropagation()} aria-label="Remettre en file d'attente" title="Remettre en file" className="icon-btn meal-queue"><Icon name="undo" size={16}/></button>}
      <button onClick={e=>{e.stopPropagation();if(!meal.fait&&!busy)confirmCuisine(meal);}} onTouchStart={e=>e.stopPropagation()} disabled={meal.fait||busy} aria-label={meal.fait?"Cuisiné":"Marquer comme cuisiné"} title={meal.fait?"Cuisiné":"Marquer comme cuisiné"}
        style={{width:36,height:36,borderRadius:999,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",cursor:meal.fait?"default":"pointer",border:meal.fait?"none":"2px solid #D6D3D1",background:meal.fait?"var(--success)":"transparent",color:meal.fait?"#fff":"transparent",opacity:busy?0.5:1,padding:0}}>
        <Icon name="check" size={16}/>
      </button>
    </div>
  );
}

export function PlanningTab({toast}){
  const [planning,setPlanning]=useState(()=>peekCached("planning")||[]);
  const [recettes,setRecettes]=useState(()=>peekCached("recettes")||[]);
  const [loading,setLoading]=useState(()=>!peekCached("planning"));
  const [showForm,setShowForm]=useState(false);
  const [weekOffset,setWeekOffset]=useState(0);
  const [dragItem,setDragItem]=useState(null);
  const [dragOver,setDragOver]=useState(null);
  const touchDragRef=useRef(null); // {item, ghost, startX, startY}

  // Cleanup global si touch annulé ou changement de page
  useEffect(()=>{
    const cleanup=()=>{
      if(touchDragRef.current?.ghost){
        try{touchDragRef.current.ghost.remove();}catch(e){}
        touchDragRef.current=null;
      }
      setDragItem(null);setDragOver(null);
    };
    window.addEventListener("touchcancel",cleanup);
    return()=>{
      window.removeEventListener("touchcancel",cleanup);
      cleanup(); // nettoyage au unmount du composant
    };
  },[]);
  const [confirming,setConfirming]=useState(null);
  const [form,setForm]=useState({recetteQuery:"",recetteId:"",moment:"Dîner",portions:DEFAULT_PORTIONS,notes:"",date:"",queue:false});
  const [suggestions,setSuggestions]=useState([]);
  const [saving,setSaving]=useState(false);
  const [showCoursesModal,setShowCoursesModal]=useState(false);
  const [coursesSelection,setCoursesSelection]=useState([]);
  const [groupMode,setGroupMode]=useState("recette");
  const [selectedMealRecette,setSelectedMealRecette]=useState(null);
  const [selectedMealPlanning,setSelectedMealPlanning]=useState(null);
  const [planningTargetFromDetail,setPlanningTargetFromDetail]=useState(null);
  const [overdueMeals,setOverdueMeals]=useState(null);
  const [overdueProcessing,setOverdueProcessing]=useState({});
  const [showWeekWizard,setShowWeekWizard]=useState(false);

  const getWeekDates=(offset=0)=>{
    const now=new Date();const day=now.getDay();
    const monday=new Date(now);monday.setDate(now.getDate()-(day===0?6:day-1)+offset*7);
    return Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setDate(monday.getDate()+i);return d;});
  };
  const weekDates=getWeekDates(weekOffset);

  const load=useCallback(async(force=false,silent=false)=>{
    const P=loadWithCache("planning",{force,onCached:setPlanning,onFresh:setPlanning,onError:e=>toast&&toast("❌ Planning non chargé : "+e.message)});
    const R=loadWithCache("recettes",{force,onCached:setRecettes,onFresh:setRecettes,onError:e=>toast&&toast("❌ Recettes non chargées : "+e.message)});
    if(P.needSpinner&&!silent)setLoading(true);else setLoading(false);
    await Promise.all([P.promise,R.promise]);
    setLoading(false);
  },[toast]);

  useEffect(()=>{load();},[load]);

  // Détection des repas planifiés dans le passé non cuisinés (1x par session)
  useEffect(()=>{
    if(overdueMeals!==null||planning.length===0)return;
    const snooze=localStorage.getItem("overdueSnoozeUntil");
    if(snooze&&localISO(new Date())<snooze)return;
    if(sessionStorage.getItem("overdueChecked"))return;
    const todayStr=localISO(new Date());
    const overdue=planning.filter(p=>!p.queue&&!p.fait&&p.date&&p.date<todayStr);
    if(overdue.length>0){
      setOverdueMeals(overdue);
    } else {
      setOverdueMeals([]);
    }
    sessionStorage.setItem("overdueChecked","1");
  },[planning,overdueMeals]);

  // Actions sur les repas en retard
  const handleOverdueAction=async(meal,action)=>{
    setOverdueProcessing(s=>({...s,[meal.id]:true}));
    try{
      if(action==="cancel"){
        // Archiver l'entrée planning
        await fetch(`/api/notion?path=/v1/pages/${meal.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({archived:true})});
        const updated=planning.filter(p=>p.id!==meal.id);
        setPlanning(updated);setCache("planning",updated);
      } else if(action==="done"){
        // Marquer cuisiné + incrémenter compteur recette
        await notionUpdate(meal.id,{"Cuisiné":nCheck(true)});
        const recetteData=recettes.find(r=>r.id===meal.recette_id||r.nom===(meal.recette||meal.repas));
        if(recetteData){
          await notionUpdate(recetteData.id,{
            "Fois cuisinée":nNum((recetteData.fois_cuisinee||0)+1),
            "Dernière cuisson":nDate(meal.date),
          });
        }
        const updated=planning.map(p=>p.id===meal.id?{...p,fait:true}:p);
        setPlanning(updated);setCache("planning",updated);
      } else if(action==="requeue"){
        // Remettre en file d'attente sans date
        await notionUpdate(meal.id,{"File d'attente":nCheck(true),"Date":nDate(null)});
        const updated=planning.map(p=>p.id===meal.id?{...p,queue:true,date:null}:p);
        setPlanning(updated);setCache("planning",updated);
      }
      // Retirer de la liste overdue
      setOverdueMeals(m=>m.filter(x=>x.id!==meal.id));
    }catch(e){
      logError("handleOverdueAction",e,{meal:meal.repas,action});
    }
    setOverdueProcessing(s=>({...s,[meal.id]:false}));
  };

  // Partage du menu de la semaine (WhatsApp / clipboard)
  const shareWeekMenu=()=>{
    const weekStart=localISO(weekDates[0]);
    const weekEnd=localISO(weekDates[6]);
    const meals=planning
      .filter(p=>!p.queue&&p.date&&p.date>=weekStart&&p.date<=weekEnd)
      .sort((a,b)=>a.date.localeCompare(b.date)||(a.moment==="Déjeuner"?-1:1));
    if(meals.length===0){toast("Aucun repas planifié cette semaine");return;}
    const lines=["🍽️ Menu de la semaine\n"];
    let lastDate="";
    for(const m of meals){
      if(m.date!==lastDate){
        lines.push("\n📅 "+new Date(m.date+"T00:00").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"}));
        lastDate=m.date;
      }
      lines.push(`  ${m.moment==="Déjeuner"?"☀️":"🌙"} ${m.recette||m.repas}${m.fait?" ✓":""}`);
    }
    lines.push("\n👨‍🍳 Recettes : https://meal-planner-psi-seven.vercel.app");
    const text=lines.join("\n");
    if(navigator.share){
      navigator.share({text}).catch(()=>{});
    } else {
      navigator.clipboard.writeText(text);
      toast("Menu copié — colle-le dans WhatsApp ✓");
    }
  };

  // Autocomplete
  useEffect(()=>{
    if(!form.recetteQuery||form.recetteQuery.length<2){setSuggestions([]);return;}
    const q=form.recetteQuery.toLowerCase();
    setSuggestions(recettes.filter(r=>r.nom.toLowerCase().includes(q)).slice(0,6));
  },[form.recetteQuery,recettes]);

  const save=async()=>{
    setSaving(true);
    const targetDate=form.queue?(()=>{const now=new Date();const day=now.getDay();const nextMonday=new Date(now);nextMonday.setDate(now.getDate()+(day===0?1:8-day));return localISO(nextMonday);})():form.date;
    await notionCreate(DB_PLANNING,{
      "Repas":nTitle(form.recetteQuery),"Date":nDate(targetDate),"Moment":nSel(form.moment),
      "Recette":nText(form.recetteQuery),"Recette ID":nText(form.recetteId),
      "Portions":nNum(form.portions),"Notes":nText(form.notes),"File d'attente":nCheck(form.queue),
    });
    toast("Repas ajouté ✓");setSaving(false);setShowForm(false);
    setForm({recetteQuery:"",recetteId:"",moment:"Dîner",portions:DEFAULT_PORTIONS,notes:"",date:"",queue:false});
    setCache("planning",null);load(true,true);
  };

  const confirmCuisine=async(meal)=>{
    setConfirming(meal.id);
    const updated=planning.map(p=>p.id===meal.id?{...p,fait:true}:p);
    setPlanning(updated);setCache("planning",updated);
    // Marquer comme fait dans Planning
    const updateRes=await notionUpdate(meal.id,{"Cuisiné":nCheck(true)});
    if(updateRes?.object==="error") console.error("confirmCuisine error:",updateRes.message);
    // Mettre à jour Fois cuisinée + Dernière cuisson dans DB Recettes
    const recetteData=recettes.find(r=>r.id===meal.recette_id||r.nom===(meal.recette||meal.repas));
    if(recetteData){
      const newCount=(recetteData.fois_cuisinee||0)+1;
      await notionUpdate(recetteData.id,{
        "Fois cuisinée":nNum(newCount),
        "Dernière cuisson":nDate(localISO(new Date())),
      });
    }
    toast(`"${meal.recette}" cuisiné ✓`);setConfirming(null);
  };

  // Annule une entrée de planning (archivage définitif)
  const cancelPlanningEntry=async(meal)=>{
    try{
      await fetch(`/api/notion?path=/v1/pages/${meal.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({archived:true})});
      const updated=planning.filter(p=>p.id!==meal.id);
      setPlanning(updated);setCache("planning",updated);
      toast(`"${meal.recette||meal.repas}" retiré du planning ✓`);
    }catch(e){logError("cancelPlanningEntry",e,{id:meal.id});toast("Erreur lors de l'annulation");}
    setSelectedMealRecette(null);setSelectedMealPlanning(null);
  };

  // Remet une entrée de planning en file d'attente (sans date)
  const requeuePlanningEntry=async(meal)=>{
    const updated=planning.map(p=>p.id===meal.id?{...p,queue:true,date:null}:p);
    setPlanning(updated);setCache("planning",updated);
    await notionUpdate(meal.id,{"File d'attente":nCheck(true),"Date":nDate(null)});
    toast(`"${meal.recette||meal.repas}" remis en file d'attente ✓`);
    setSelectedMealRecette(null);setSelectedMealPlanning(null);
  };

  // Drag and drop
  const handleDrop=async(targetDate,targetMoment,item=dragItem)=>{
    if(!item)return;
    const moment=item.moment||targetMoment||"Dîner";
    const updated=planning.map(p=>p.id===item.id?{...p,date:targetDate,moment,queue:false}:p);
    setPlanning(updated);setCache("planning",updated);
    notionUpdate(item.id,{"Date":nDate(targetDate),"Moment":nSel(moment),"File d'attente":nCheck(false)});
    toast(`"${item.recette||item.repas}" déplacé ✓`);
    setDragItem(null);setDragOver(null);
  };

  const isToday=d=>d.toDateString()===new Date().toDateString();
  const isPast=d=>d<new Date()&&!isToday(d);
  const getMeals=date=>planning.filter(p=>p.date===localISO(date)&&!p.queue);
  const queueItems=planning.filter(p=>p.queue);
  const [clearingQueue,setClearingQueue]=useState(false);
  const [confirmClearQueue,setConfirmClearQueue]=useState(false);

  // Retirer un item de la file : archive l'entrée planning (la recette reste dans Recettes)
  const removeFromQueue=async(item)=>{
    const updated=planning.filter(p=>p.id!==item.id);
    setPlanning(updated);setCache("planning",updated);
    try{
      await fetch(`/api/notion?path=/v1/pages/${item.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({archived:true})});
    }catch(e){logError("removeFromQueue",e,{item:item.recette||item.repas});}
  };

  // Vider toute la file d'attente
  const clearQueue=async()=>{
    setClearingQueue(true);
    const items=[...queueItems];
    const remaining=planning.filter(p=>!p.queue);
    setPlanning(remaining);setCache("planning",remaining);
    for(const item of items){
      try{
        await fetch(`/api/notion?path=/v1/pages/${item.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({archived:true})});
      }catch(e){logError("clearQueue",e,{item:item.recette||item.repas});}
    }
    setClearingQueue(false);setConfirmClearQueue(false);
    toast(items.length+" repas retirés de la file");
  };
  const weekLabel=()=>({0:"Cette semaine",1:"Semaine prochaine","-1":"Semaine dernière"}[weekOffset]||`Sem. ${weekOffset>0?"+":""}${weekOffset}`);

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:0,minWidth:0,flex:1}}>
          <button onClick={()=>setWeekOffset(w=>w-1)} aria-label="Semaine précédente" className="icon-btn" style={{transform:"rotate(180deg)"}}><Icon name="arrow" size={18}/></button>
          <button onClick={()=>setWeekOffset(0)} title="Revenir à cette semaine" style={{background:"none",border:"none",padding:"2px 2px",cursor:weekOffset?"pointer":"default",textAlign:"left",fontFamily:"inherit",minWidth:0,overflow:"hidden"}}>
            <div className="week-label" style={{fontSize:16,fontWeight:700,color:"var(--text)",letterSpacing:"-0.01em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{weekLabel()}</div>
            <div style={{fontSize:12,color:"var(--muted)",whiteSpace:"nowrap"}}>{weekDates[0].toLocaleDateString("fr-FR",{day:"numeric",month:"short"})} – {weekDates[6].toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}</div>
          </button>
          <button onClick={()=>setWeekOffset(w=>w+1)} aria-label="Semaine suivante" className="icon-btn"><Icon name="arrow" size={18}/></button>
        </div>
        <div style={{display:"flex",gap:4,alignItems:"center",flexShrink:0}}>
          <button onClick={()=>setShowWeekWizard(true)} aria-label="Planifier ma semaine" title="Planifier ma semaine" className="icon-btn"><Icon name="sparkle" size={18}/></button>
          <button onClick={()=>{
            const today=new Date();today.setHours(0,0,0,0);
            const twoWeeksLater=new Date(today);twoWeeksLater.setDate(today.getDate()+14);
            const todayStr=localISO(today);
            const limitStr=localISO(twoWeeksLater);
            const planned=planning.filter(p=>!p.queue&&!p.fait&&p.date&&p.date>=todayStr&&p.date<=limitStr);
            const meals=[...queueItems.filter(m=>!m.fait),...planned];
            const unique=[];const seen=new Set();
            meals.forEach(m=>{const k=m.recette||m.repas;if(k&&!seen.has(k)){seen.add(k);unique.push(m);}});
            setCoursesSelection(unique.map(m=>({...m,selected:true})));
            setShowCoursesModal(true);
          }} aria-label="Générer les courses" title="Générer les courses" className="icon-btn"><Icon name="cart" size={18}/></button>
          <button onClick={shareWeekMenu} aria-label="Partager le menu" title="Partager le menu de la semaine" className="icon-btn hide-xs"><Icon name="share" size={18}/></button>
          <button onClick={()=>{setForm(f=>({...f,date:defaultPlanningDate(),queue:false,recetteQuery:"",recetteId:""}));setShowForm(true);}} aria-label="Ajouter un repas" style={{display:"flex",alignItems:"center",gap:6,height:40,padding:"0 14px",marginLeft:4,background:"var(--accent)",border:"none",borderRadius:999,color:"#fff",fontWeight:600,fontSize:14,cursor:"pointer"}}><Icon name="plus" size={16}/><span className="btn-label">Ajouter</span></button>
        </div>
      </div>

      {loading?<Spinner label="Chargement du planning…"/>:(
        <div>
          {/* Semaine */}
          <div className="planning-grid" style={{display:"grid",gridTemplateColumns:"repeat(7,minmax(0,1fr))",gap:8,marginBottom:20}}>
            {weekDates.map((date,i)=>{
              const meals=getMeals(date);const today=isToday(date);const past=isPast(date);
              const dropKey=localISO(date);
              const over=dragOver===dropKey;
              const ctx={planning,setPlanning,dragItem,setDragItem,setDragOver,handleDrop,touchDragRef,confirmCuisine,confirming,toast,
                onView:meal=>{const r=recettes.find(x=>x.id===meal.recette_id||x.nom===(meal.recette||meal.repas));if(r){setSelectedMealRecette(r);setSelectedMealPlanning(meal);}},
                onMoveToQueue:meal=>{
                  const updated=planning.map(p=>p.id===meal.id?{...p,queue:true,date:null}:p);
                  setPlanning(updated);setCache("planning",updated);
                  notionUpdate(meal.id,{"File d'attente":nCheck(true),"Date":nDate(null)});
                  toast(`"${meal.recette||meal.repas}" remis en file d'attente ✓`);
                }};
              return(
                <div key={dropKey} className="day-cell" data-dropzone={dropKey}
                  onDragOver={e=>{e.preventDefault();setDragOver(dropKey);}}
                  onDragLeave={()=>setDragOver(null)}
                  onDrop={()=>handleDrop(dropKey)}
                  style={{background:over?"var(--accent-soft)":"transparent",outline:over?"2px dashed var(--accent)":"none",outlineOffset:-2,borderRadius:16,padding:6,display:"flex",flexDirection:"column",gap:8,opacity:past&&!over?0.72:1,transition:"background .15s"}}>
                  <div className="day-header" style={{display:"flex",alignItems:"center",gap:8,padding:"2px 4px"}}>
                    <span style={{fontSize:12,fontWeight:600,color:today?"var(--accent)":"var(--muted)",textTransform:"capitalize"}}>{DAYS[i].slice(0,3).toLowerCase()}</span>
                    <span style={{width:28,height:28,borderRadius:999,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,background:today?"var(--accent)":"transparent",color:today?"#fff":"var(--text)"}}>{date.getDate()}</span>
                  </div>
                  <div className="day-meals" style={{display:"flex",flexDirection:"column",gap:6,flex:1,minWidth:0}}>
                    {meals.map(m=><MealChip key={m.id} meal={m} recette={recettes.find(x=>x.id===m.recette_id)||recettes.find(x=>x.nom===(m.recette||m.repas))} ctx={ctx}/>)}
                    {!past&&<button onClick={()=>{setForm(f=>({...f,date:dropKey,queue:false,recetteQuery:"",recetteId:""}));setShowForm(true);}} className="add-slot" aria-label={`Ajouter un repas ${DAYS[i]}`}>
                      <Icon name="plus" size={14}/>{meals.length===0&&<span className="add-slot-label">Ajouter</span>}
                    </button>}
                    {past&&meals.length===0&&<div style={{fontSize:12,color:"var(--subtle)",padding:"10px 4px"}}>—</div>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Queue */}
          <div className="card" style={{padding:16,outline:dragOver==="queue"?"2px dashed var(--accent)":"none",outlineOffset:-2}}
            onDragOver={e=>{e.preventDefault();setDragOver("queue");}}
            onDragLeave={()=>setDragOver(null)}
            data-dropzone="queue"
            onDrop={async()=>{
              if(!dragItem)return;
              const updated=planning.map(p=>p.id===dragItem.id?{...p,queue:true}:p);
              setPlanning(updated);setCache("planning",updated);
              notionUpdate(dragItem.id,{"File d'attente":nCheck(true)});
              setDragItem(null);setDragOver(null);
            }}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              <span style={{fontSize:16,fontWeight:700,color:"var(--text)",letterSpacing:"-0.01em"}}>À caser</span>
              {queueItems.length>0&&<span style={{fontSize:12,fontWeight:700,color:"var(--muted)",background:"var(--surface-2)",borderRadius:999,padding:"2px 8px"}}>{queueItems.length}</span>}
              <span style={{fontSize:12,color:"var(--subtle)",marginLeft:"auto"}}>appui long pour glisser</span>
              {queueItems.length>0&&!confirmClearQueue&&(
                <button onClick={()=>setConfirmClearQueue(true)} style={{fontSize:11,color:"var(--danger)",background:"#FEF2F2",border:"1px solid transparent",borderRadius:10,padding:"3px 10px",cursor:"pointer",fontWeight:600,fontFamily:"inherit"}}>Vider</button>
              )}
              {confirmClearQueue&&(
                <span style={{display:"flex",gap:6,alignItems:"center"}}>
                  <button onClick={()=>setConfirmClearQueue(false)} style={{fontSize:11,color:"var(--muted)",background:"var(--surface-2)",border:"none",borderRadius:10,padding:"3px 10px",cursor:"pointer",fontWeight:600,fontFamily:"inherit"}}>Annuler</button>
                  <button disabled={clearingQueue} onClick={clearQueue} style={{fontSize:11,color:"#fff",background:"#DC2626",border:"none",borderRadius:10,padding:"3px 10px",cursor:"pointer",fontWeight:700,fontFamily:"inherit",opacity:clearingQueue?0.5:1}}>{clearingQueue?"…":"Tout retirer"}</button>
                </span>
              )}
            </div>
            {queueItems.length===0&&<div style={{fontSize:12,color:"var(--subtle)",textAlign:"center",padding:"8px 0"}}>Vide — glisse ici pour mettre en attente</div>}
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {queueItems.map((m,i)=>(
                <div key={i} draggable onDragStart={()=>setDragItem(m)} onDragEnd={()=>setDragItem(null)}
                  onTouchStart={(e)=>{
                    const touch=e.touches[0];
                    const ghost=e.currentTarget.cloneNode(true);
                    ghost.style.cssText=`position:fixed;top:${touch.clientY-20}px;left:${touch.clientX-60}px;opacity:0.85;z-index:9999;pointer-events:none;border-radius:20px;padding:6px 12px;`;
                    document.body.appendChild(ghost);
                    touchDragRef.current={item:m,ghost};
                    setDragItem(m);
                  }}
                  onTouchMove={(e)=>{
                    if(!touchDragRef.current)return;
                    e.preventDefault();
                    const touch=e.touches[0];
                    touchDragRef.current.ghost.style.top=touch.clientY-20+"px";
                    touchDragRef.current.ghost.style.left=touch.clientX-60+"px";
                    const el=document.elementFromPoint(touch.clientX,touch.clientY);
                    const zone=el?.closest("[data-dropzone]");
                    setDragOver(zone?.dataset.dropzone||null);
                  }}
                  onTouchEnd={(e)=>{
                    if(!touchDragRef.current)return;
                    const touch=e.changedTouches[0];
                    const el=document.elementFromPoint(touch.clientX,touch.clientY);
                    const zone=el?.closest("[data-dropzone]");
                    if(zone&&zone.dataset.dropzone!=="queue"){
                      handleDrop(zone.dataset.dropzone,undefined,touchDragRef.current.item);
                    }
                    touchDragRef.current.ghost.remove();
                    touchDragRef.current=null;
                    setDragItem(null);setDragOver(null);
                  }}
                  style={{padding:"8px 10px 8px 14px",background:"var(--bg)",boxShadow:"0 0 0 1px rgba(28,25,23,0.08)",borderRadius:999,fontSize:13,fontWeight:600,color:"var(--text)",cursor:"grab",display:"flex",alignItems:"center",gap:6,opacity:dragItem?.id===m.id?0.4:1,touchAction:"none"}}>
                  <span onClick={e=>{e.stopPropagation();const r=recettes.find(x=>x.id===m.recette_id||x.nom===(m.recette||m.repas));if(r){setSelectedMealRecette(r);setSelectedMealPlanning(m);}}} style={{cursor:"pointer",flex:1}}>
                    <Icon name="drag" size={10}/>{m.recette||m.repas}
                  </span>
                  <button onClick={e=>{e.stopPropagation();removeFromQueue(m);}} onTouchStart={e=>e.stopPropagation()} title="Retirer de la file" style={{background:"none",border:"none",cursor:"pointer",color:MOMENT_COLORS[m.moment]||"var(--subtle)",fontSize:14,lineHeight:1,padding:"0 2px",opacity:0.7,fontFamily:"inherit"}}>✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showWeekWizard&&(
        <WeekPlannerWizard
          recettes={recettes}
          planning={planning}
          toast={toast}
          onClose={()=>setShowWeekWizard(false)}
          onConfirm={()=>{setShowWeekWizard(false);setCache("planning",null);load(true,true);}}
        />
      )}

      {/* Popup repas en retard */}
      {overdueMeals&&overdueMeals.length>0&&(
        <div style={{position:"fixed",inset:0,zIndex:2500,background:"rgba(28,25,23,0.6)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div className="modal-inner" style={{background:"var(--surface)",borderRadius:14,maxWidth:480,width:"100%",maxHeight:"80vh",overflow:"auto",padding:20}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                            <h3 style={{margin:0,fontSize:17,fontWeight:700,color:"var(--text)",letterSpacing:"-0.02em"}}>Repas non confirmés</h3>
            </div>
            <p style={{fontSize:13,color:"var(--muted)",marginTop:0,marginBottom:16}}>
              {overdueMeals.length} repas planifié{overdueMeals.length>1?"s":""} dans le passé n'{overdueMeals.length>1?"ont":"a"} pas été marqué{overdueMeals.length>1?"s":""} comme cuisiné{overdueMeals.length>1?"s":""}.
            </p>
            {overdueMeals.map(meal=>(
              <div key={meal.id} style={{border:"1px solid var(--border)",borderRadius:14,padding:"12px 14px",marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:10,gap:8}}>
                  <span style={{fontSize:14,fontWeight:600,color:"var(--text)"}}>{meal.recette||meal.repas}</span>
                  <span style={{fontSize:11,color:"var(--subtle)",whiteSpace:"nowrap"}}>{new Date(meal.date+"T00:00").toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"})}{meal.moment?` · ${meal.moment}`:""}</span>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button disabled={overdueProcessing[meal.id]} onClick={()=>handleOverdueAction(meal,"done")}
                    style={{flex:1,padding:"8px 4px",background:"#EEF6F0",border:"1px solid transparent",borderRadius:10,color:"var(--success)",fontSize:12,fontWeight:600,cursor:"pointer",opacity:overdueProcessing[meal.id]?0.5:1}}>
                    ✓ Fait
                  </button>
                  <button disabled={overdueProcessing[meal.id]} onClick={()=>handleOverdueAction(meal,"requeue")}
                    style={{flex:1,padding:"8px 4px",background:"var(--accent-soft)",border:"1px solid transparent",borderRadius:10,color:"var(--accent)",fontSize:12,fontWeight:600,cursor:"pointer",opacity:overdueProcessing[meal.id]?0.5:1}}>
                    ↩ File d'attente
                  </button>
                  <button disabled={overdueProcessing[meal.id]} onClick={()=>handleOverdueAction(meal,"cancel")}
                    style={{flex:1,padding:"8px 4px",background:"#FEF2F2",border:"1px solid transparent",borderRadius:10,color:"var(--danger)",fontSize:12,fontWeight:600,cursor:"pointer",opacity:overdueProcessing[meal.id]?0.5:1}}>
                    ✕ Annuler
                  </button>
                </div>
              </div>
            ))}
            <div style={{display:"flex",gap:8,marginTop:4}}>
              <button onClick={()=>setOverdueMeals([])}
                style={{flex:1,padding:"10px",background:"transparent",border:"1px solid var(--border)",borderRadius:10,color:"var(--muted)",fontSize:13,cursor:"pointer"}}>
                Plus tard
              </button>
              <button onClick={()=>{
                const d=new Date();const day=d.getDay();
                const daysToMon=day===0?1:8-day; // prochain lundi
                d.setDate(d.getDate()+daysToMon);
                localStorage.setItem("overdueSnoozeUntil",localISO(d));
                setOverdueMeals([]);
                toast("Rappel reporté à lundi");
              }} style={{flex:1,padding:"10px",background:"var(--bg)",border:"1px solid var(--border)",borderRadius:10,color:"var(--text-2)",fontSize:13,fontWeight:600,cursor:"pointer"}}>
                💤 Jusqu'à lundi
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedMealRecette&&!planningTargetFromDetail&&(
        <RecipeDetailModal
          recette={selectedMealRecette}
          onClose={()=>{setSelectedMealRecette(null);setSelectedMealPlanning(null);}}
          toast={toast}
          onAddToCourses={()=>{}}
          onAddToPlanning={(r,p,mode)=>{setPlanningTargetFromDetail({recette:r,portions:p,mode});}}
          onUpdate={(updated)=>setSelectedMealRecette(updated)}
          onCookComplete={()=>{toast&&toast("Repas validé ✓");setCache("planning",null);load(true,true);}}
          planningEntry={selectedMealPlanning}
          onCancelPlanning={cancelPlanningEntry}
          onRequeuePlanning={requeuePlanningEntry}
        />
      )}
      {planningTargetFromDetail&&(
        <AddToPlanningModal
          recette={planningTargetFromDetail.recette}
          portions={planningTargetFromDetail.portions}
          mode={planningTargetFromDetail.mode}
          toast={toast}
          onClose={()=>{setPlanningTargetFromDetail(null);setSelectedMealRecette(null);setSelectedMealPlanning(null);}}
        />
      )}

      {showCoursesModal&&<CoursesModal
        onClose={()=>setShowCoursesModal(false)}
        coursesSelection={coursesSelection}
        setCoursesSelection={setCoursesSelection}
        recettes={recettes}
        groupMode={groupMode}
        setGroupMode={setGroupMode}
        toast={toast}
      />}

      {showForm&&(
        <Modal title="Ajouter au planning" onClose={()=>setShowForm(false)}>
          <Field label="Recette">
            <div style={{position:"relative"}}>
              <input style={inputStyle} value={form.recetteQuery} onChange={e=>setForm(f=>({...f,recetteQuery:e.target.value,recetteId:""}))} placeholder="Rechercher une recette…"/>
              {suggestions.length>0&&(
                <div style={{position:"absolute",top:"100%",left:0,right:0,background:"var(--surface-2)",border:"1px solid #44403C",borderRadius:10,zIndex:100,marginTop:4,overflow:"hidden"}}>
                  {suggestions.map((r,i)=>(
                    <div key={i} onClick={()=>{setForm(f=>({...f,recetteQuery:r.nom,recetteId:r.id}));setSuggestions([]);}}
                      style={{padding:"10px 14px",cursor:"pointer",fontSize:13,color:"var(--text)",display:"flex",alignItems:"center",gap:10,borderBottom:"1px solid #44403C"}}
                      onMouseEnter={e=>e.currentTarget.style.background="#44403C"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      {r.photo&&<img src={r.photo} alt="" style={{width:32,height:32,objectFit:"cover",borderRadius:10}}/>}
                      <div>
                        <div style={{fontWeight:600}}>{r.nom}</div>
                        <div style={{fontSize:11,color:"var(--muted)"}}>{r.categorie} · {r.portions||DEFAULT_PORTIONS} p.</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Field>
          <div style={{display:"flex",gap:8,marginBottom:16}}>
            <button onClick={()=>setForm(f=>({...f,queue:false}))} style={{flex:1,padding:"8px",borderRadius:10,border:"1px solid",borderColor:!form.queue?"var(--accent)":"var(--border)",background:!form.queue?"var(--accent-soft)":"transparent",color:!form.queue?"var(--accent)":"var(--muted)",cursor:"pointer",fontSize:12,fontWeight:600}}>📅 Date précise</button>
            <button onClick={()=>setForm(f=>({...f,queue:true}))} style={{flex:1,padding:"8px",borderRadius:10,border:"1px solid",borderColor:form.queue?"var(--accent)":"var(--border)",background:form.queue?"var(--accent-soft)":"transparent",color:form.queue?"var(--accent)":"var(--muted)",cursor:"pointer",fontSize:12,fontWeight:600}}>⏳ File d'attente</button>
          </div>
          {!form.queue&&<Field label="Date"><input style={inputStyle} type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></Field>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Field label="Moment"><select style={inputStyle} value={form.moment} onChange={e=>setForm(f=>({...f,moment:e.target.value}))}>{MOMENTS.map(m=><option key={m}>{m}</option>)}</select></Field>
            <Field label="Portions"><input style={inputStyle} type="number" value={form.portions} onChange={e=>setForm(f=>({...f,portions:e.target.value}))}/></Field>
          </div>
          <button onClick={save} disabled={saving||!form.recetteQuery||((!form.queue&&!form.date))} style={form.recetteQuery&&(form.queue||form.date)?btnPrimary:btnDisabled}>{saving?"Enregistrement…":"Ajouter"}</button>
        </Modal>
      )}
    </div>
  );
}
