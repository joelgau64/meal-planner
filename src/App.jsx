import { useState, useEffect, useCallback, useRef } from "react";

const DB_RECETTES = "39c7b0f8-bf02-4893-bc05-6d82b8c38617";
const DB_PLANNING = "dc70bd98-0691-41b9-abfc-5bde68630995";
const DB_COURSES = "35f5b3b5-095f-4998-a014-9a112807e711";

const DAYS = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const MOMENTS = ["Petit-déjeuner","Déjeuner","Dîner","Snack"];
const MOMENT_COLORS = {"Déjeuner":"#C2622D","Dîner":"#475569"};
const CAT_COLORS = {"Fruits & Légumes":"#16A34A","Viandes & Poissons":"#DC2626","Produits laitiers":"#2563EB","Épicerie":"#EA580C","Surgelés":"#7C3AED","Boissons":"#0891B2","Autre":"#6B7280"};
const EMPTY_FORM = {nom:"",categorie:"Dîner",temps:"",portions:4,ingredients:"",instructions:"",tags:[],note:"***",photoUrl:"",sourceUrl:""};
const DEFAULT_PORTIONS = 4;

// ── Cache ─────────────────────────────────────────────────────────────────────
const cache = {recettes:null,planning:null,courses:null};
const cacheTime = {recettes:0,planning:0,courses:0};
const CACHE_TTL = 5*60*1000;
function getCached(k){return cache[k]&&Date.now()-cacheTime[k]<CACHE_TTL?cache[k]:null;}
function setCache(k,d){cache[k]=d;cacheTime[k]=Date.now();}

// ── Notion API ────────────────────────────────────────────────────────────────
async function notionQuery(dbId,filter,sorts){
  const body={page_size:200};
  if(filter)body.filter=filter;
  if(sorts)body.sorts=sorts;
  const res=await fetch(`/api/notion?path=/v1/databases/${dbId}/query`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  return res.json();
}
async function notionCreate(dbId,properties){
  const res=await fetch(`/api/notion?path=/v1/pages`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({parent:{database_id:dbId},properties})});
  return res.json();
}
async function notionUpdate(pageId,properties){
  const res=await fetch(`/api/notion?path=/v1/pages/${pageId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({properties})});
  return res.json();
}

// ── Notion helpers ────────────────────────────────────────────────────────────
const nText=s=>({rich_text:[{text:{content:String(s||"").slice(0,2000)}}]});
const nTitle=s=>({title:[{text:{content:String(s||"")}}]});
const nNum=n=>({number:Number(n)||0});
const nSel=s=>s?{select:{name:String(s)}}:{select:null};
const nDate=d=>d?{date:{start:d}}:{date:null};
const nCheck=b=>({checkbox:!!b});
const nUrl=u=>u?{url:u}:{url:null};

function getTitle(page){const t=page.properties;for(const k of Object.keys(t)){if(t[k].type==="title"&&t[k].title?.[0]?.plain_text)return t[k].title[0].plain_text;}return"";}
function getText(p){return p?.rich_text?.[0]?.plain_text||"";}
function getSelect(p){return p?.select?.name||"";}
function getNum(p){return p?.number||0;}
function getCheck(p){return p?.checkbox||false;}
function getDate(p){return p?.date?.start||null;}
function getUrl(p){return p?.url||null;}

function parseRecette(page){
  const p=page.properties;
  return{id:page.id,nom:getTitle(page),categorie:getSelect(p["Catégorie"]),temps:getNum(p["Temps de préparation"]),portions:getNum(p["Portions"])||DEFAULT_PORTIONS,ingredients:getText(p["Ingrédients"]),instructions:getText(p["Instructions"]),note:getSelect(p["Note"]),likes:getNum(p["Likes"]),dislikes:getNum(p["Dislikes"]),fois_cuisinee:getNum(p["Fois cuisinée"]),derniere_cuisson:getDate(p["Dernière cuisson"]),photo:getUrl(p["Photo"]),sourceUrl:getUrl(p["Source"])||getText(p["Source URL"])||""};
}
function parsePlanning(page){
  const p=page.properties;
  return{id:page.id,repas:getTitle(page),date:getDate(p["Date"]),moment:getSelect(p["Moment"]),recette:getText(p["Recette"]),recette_id:getText(p["Recette ID"]),portions:getNum(p["Portions"])||DEFAULT_PORTIONS,notes:getText(p["Notes"]),fait:getCheck(p["Acheté"]),queue:getCheck(p["File d'attente"])};
}
function parseCourse(page){
  const p=page.properties;
  return{id:page.id,article:getTitle(page),categorie:getSelect(p["Catégorie"]),quantite:getText(p["Quantité"]),achete:getCheck(p["Acheté"]),semaine:getText(p["Semaine"]),recette:getText(p["Recette"])};
}

// ── Ingredient parsing ────────────────────────────────────────────────────────
function parseIngredients(text){
  if(!text)return[];
  return text.split(/\n|,(?=\s*\d|\s*[A-ZÀ-Ö])/g)
    .map(s=>s.trim()).filter(Boolean)
    .map(line=>{
      const match=line.match(/^([\d.,/]+)\s*(g|kg|ml|cl|l|dl|c\.?à\.?s\.?|c\.?à\.?c\.?|tasse|cuillère[s]?|tbsp|tsp|cup|oz|lb|pincée[s]?)?\s*(.+)/i);
      if(match){
        const qty=parseFloat(match[1].replace(',','.'));
        return{original:line,qty,unit:match[2]||"",name:match[3].trim(),scalable:!isNaN(qty)};
      }
      return{original:line,qty:null,unit:"",name:line,scalable:false};
    });
}

function scaleIngredients(ingredients,basePortion,newPortion){
  if(!basePortion||basePortion===newPortion)return ingredients;
  const ratio=newPortion/basePortion;
  return ingredients.map(ing=>{
    if(!ing.scalable)return ing;
    const newQty=ing.qty*ratio;
    const rounded=Math.round(newQty*10)/10;
    const qtyStr=rounded%1===0?String(rounded):String(rounded);
    return{...ing,displayQty:qtyStr};
  });
}

function guessCategory(name){
  const n=name.toLowerCase();
  if(/poulet|boeuf|porc|veau|agneau|saumon|thon|cabillaud|crevette|merlu|bar|truite|canard|jambon|bacon|lardons|viande|poisson/.test(n))return"Viandes & Poissons";
  if(/lait|crème|beurre|fromage|yaourt|parmesan|mozzarella|feta|ricotta|gruyère/.test(n))return"Produits laitiers";
  if(/tomate|carotte|oignon|ail|courgette|aubergine|poivron|épinard|salade|brocoli|poireau|champignon|pomme de terre|patate|fenouil|céleri|haricot|pois|lentille|quinoa|avocat|concombre|citron|orange/.test(n))return"Fruits & Légumes";
  if(/eau|vin|bière|jus|bouillon|lait de coco/.test(n))return"Boissons";
  if(/surgelé|congelé/.test(n))return"Surgelés";
  return"Épicerie";
}

// ── Claude API ────────────────────────────────────────────────────────────────
async function claudeJSON(system,user,withSearch=false){
  const body={model:"claude-sonnet-4-5",max_tokens:1500,system,messages:[{role:"user",content:user}]};
  if(withSearch)body.tools=[{type:"web_search_20250305",name:"web_search"}];
  const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data=await res.json();
  return parseJSON((data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join(""));
}
async function claudeVision(prompt,base64,mediaType){
  const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:1500,system:"Tu es un chef cuisinier expert. Retourne UNIQUEMENT un JSON valide, sans backticks.",messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:mediaType,data:base64}},{type:"text",text:prompt}]}]})});
  const data=await res.json();
  return parseJSON((data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join(""));
}
function parseJSON(text){try{return JSON.parse(text.replace(/```json\n?|```\n?/g,"").trim());}catch{return null;}}

const RECIPE_JSON_PROMPT=`Retourne exactement ce JSON sans backticks:
{"nom":"nom du plat en français","categorie":"Déjeuner","temps":30,"portions":4,"ingredients":"liste avec quantités en g/ml, UN ingrédient par ligne","instructions":"étapes numérotées","tags":[],"note":"***","sourceUrl":""}`;

// ── Icons ─────────────────────────────────────────────────────────────────────
const Icon=({name,size=18})=>{
  const icons={
    book:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>,
    calendar:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    cart:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 001.99 1.61H19a2 2 0 001.99-1.82l1-9.58H6"/></svg>,
    plus:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    check:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>,
    camera:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>,
    link:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>,
    sparkle:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M5 3l.75 2.25L8 6l-2.25.75L5 9l-.75-2.25L2 6l2.25-.75z"/></svg>,
    edit:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    close:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    loader:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>,
    arrow:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>,
    thumb_up:<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"/><path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" fill="none" stroke="currentColor" strokeWidth="2"/></svg>,
    thumb_down:<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17" fill="none" stroke="currentColor" strokeWidth="2"/></svg>,
    chef:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 13.87A4 4 0 017.41 6a5.11 5.11 0 0111.18 0A4 4 0 0118 13.87V21H6z"/><line x1="6" y1="17" x2="18" y2="17"/></svg>,
    refresh:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>,
    import:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
    queue:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
    external:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
    drag:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="5" r="1" fill="currentColor"/><circle cx="15" cy="5" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="19" r="1" fill="currentColor"/><circle cx="15" cy="19" r="1" fill="currentColor"/></svg>,
    people:<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
  };
  return icons[name]||null;
};

// ── UI Primitives ─────────────────────────────────────────────────────────────
function Spinner({label="Chargement..."}){
  return(<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12,padding:40,color:"#64748B"}}><div style={{animation:"spin 1s linear infinite"}}><Icon name="loader" size={28}/></div><span style={{fontSize:13}}>{label}</span></div>);
}
function Toast({message,onClose}){
  useEffect(()=>{const t=setTimeout(onClose,3000);return()=>clearTimeout(t);},[onClose]);
  return(<div style={{position:"fixed",bottom:24,right:24,background:"#F1F5F9",color:"#0F172A",padding:"12px 20px",borderRadius:10,fontSize:13,fontWeight:500,zIndex:1000,boxShadow:"0 8px 32px rgba(0,0,0,0.3)",display:"flex",alignItems:"center",gap:10}}><span style={{color:"#4ADE80"}}><Icon name="check" size={16}/></span>{message}</div>);
}
function Modal({title,onClose,children,wide,full}){
  return(<div style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.5)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={onClose}><div style={{background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:16,width:"100%",maxWidth:full?900:wide?680:520,maxHeight:"90vh",overflow:"auto"}} onClick={e=>e.stopPropagation()}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"20px 24px",borderBottom:"1px solid #E2E8F0",position:"sticky",top:0,background:"#FFFFFF",zIndex:10}}><h3 style={{margin:0,fontSize:16,fontWeight:700,color:"#0F172A",fontFamily:"'Playfair Display', serif"}}>{title}</h3><button onClick={onClose} style={{background:"none",border:"none",color:"#64748B",cursor:"pointer",padding:4}}><Icon name="close"/></button></div><div style={{padding:24}}>{children}</div></div></div>);
}
function Field({label,children}){
  return(<div style={{marginBottom:16}}><label style={{display:"block",fontSize:11,fontWeight:600,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>{label}</label>{children}</div>);
}
const inputStyle={width:"100%",background:"#F1F5F9",border:"1px solid #334155",borderRadius:8,color:"#0F172A",padding:"10px 12px",fontSize:14,boxSizing:"border-box",outline:"none",fontFamily:"inherit"};
const btnPrimary={padding:"12px",background:"#C2622D",border:"none",borderRadius:8,color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer",width:"100%",marginTop:8};
const btnDisabled={...btnPrimary,background:"#F1F5F9",color:"#64748B",cursor:"default"};

function ScoreBadge({score}){
  if(score===null||score===undefined)return null;
  const color=score>0?"#4ADE80":score<0?"#F87171":"#64748B";
  return <span style={{fontSize:11,fontWeight:700,color,background:`${color}22`,padding:"2px 7px",borderRadius:10}}>{score>0?`+${score}`:score}</span>;
}
function DaysSince({date}){
  if(!date)return <span style={{fontSize:11,color:"#64748B"}}>jamais cuisiné</span>;
  const days=Math.floor((new Date()-new Date(date))/86400000);
  const color=days>30?"#F59E0B":days>14?"#94A3B8":"#4ADE80";
  return <span style={{fontSize:11,color}}>il y a {days}j</span>;
}

// ── Recipe Detail Modal ───────────────────────────────────────────────────────
// Détecte les durées dans une étape
function detectTimer(text){
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

function playAlarm(){
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

function StepTimer({seconds,stepIdx}){
  const [remaining,setRemaining]=useState(seconds);
  const [running,setRunning]=useState(false);
  const [done,setDone]=useState(false);
  const intervalRef=useRef(null);
  useEffect(()=>{
    if(running&&remaining>0){
      intervalRef.current=setInterval(()=>{
        setRemaining(r=>{
          if(r<=1){clearInterval(intervalRef.current);setRunning(false);setDone(true);playAlarm();return 0;}
          return r-1;
        });
      },1000);
    }
    return()=>clearInterval(intervalRef.current);
  },[running]);
  const reset=()=>{setRemaining(seconds);setRunning(false);setDone(false);clearInterval(intervalRef.current);};
  const fmt=(s)=>{const h=Math.floor(s/3600);const m=Math.floor((s%3600)/60);const sec=s%60;return h>0?`${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`:`${m}:${String(sec).padStart(2,"0")}`;};
  const pct=((seconds-remaining)/seconds)*100;
  return(
    <div style={{marginTop:10,padding:"10px 14px",background:done?"#D1FAE5":running?"#FEF3C7":"#F1F5F9",borderRadius:10,border:`1px solid ${done?"#6EE7B7":running?"#FCD34D":"#E2E8F0"}`}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:20}}>{done?"✅":running?"⏱️":"⏱"}</span>
        <span style={{fontSize:20,fontWeight:700,fontFamily:"monospace",color:done?"#065F46":running?"#92400E":"#475569",flex:1}}>{fmt(remaining)}</span>
        {!done&&<button onClick={()=>setRunning(r=>!r)} style={{padding:"4px 12px",background:running?"#FCD34D":"#C2622D",border:"none",borderRadius:6,color:running?"#92400E":"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>{running?"Pause":"Démarrer"}</button>}
        <button onClick={reset} style={{padding:"4px 8px",background:"none",border:"1px solid #E2E8F0",borderRadius:6,color:"#94A3B8",fontSize:11,cursor:"pointer"}}>↺</button>
      </div>
      <div style={{marginTop:8,height:4,background:"#E2E8F0",borderRadius:2,overflow:"hidden"}}>
        <div style={{height:"100%",width:pct+"%",background:done?"#34D399":running?"#F59E0B":"#C2622D",transition:"width 1s linear",borderRadius:2}}/>
      </div>
      {done&&<div style={{fontSize:12,color:"#065F46",fontWeight:600,marginTop:6}}>⏰ Temps écoulé !</div>}
    </div>
  );
}

function CookingMode({recette,onClose}){
  const instructions=recette.instructions?recette.instructions.split(/\n|(?=\d+\.)\s*/).filter(s=>s.trim()):[];
  const [currentStep,setCurrentStep]=useState(0);
  const total=instructions.length;
  return(
    <div style={{position:"fixed",inset:0,zIndex:2000,background:"#FFFFFF",display:"flex",flexDirection:"column"}}>
      <div style={{padding:"16px 20px",borderBottom:"1px solid #E2E8F0",display:"flex",alignItems:"center",gap:12,background:"#FFFFFF",flexShrink:0}}>
        <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"#64748B",padding:4}}><Icon name="close" size={20}/></button>
        <div style={{flex:1}}>
          <div style={{fontSize:11,color:"#94A3B8",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em"}}>Mode cuisine</div>
          <div style={{fontSize:14,fontWeight:700,color:"#0F172A",fontFamily:"'Playfair Display',serif"}}>{recette.nom}</div>
        </div>
        <span style={{fontSize:13,fontWeight:600,color:"#C2622D"}}>{currentStep+1} / {total}</span>
      </div>
      <div style={{height:3,background:"#F1F5F9",flexShrink:0}}>
        <div style={{height:"100%",width:`${(currentStep/(total-1||1))*100}%`,background:"#C2622D",transition:"width 0.3s"}}/>
      </div>
      {recette.photo&&currentStep===0&&<img src={recette.photo} alt={recette.nom} style={{width:"100%",height:160,objectFit:"cover",flexShrink:0}} onError={e=>e.target.style.display="none"}/>}
      <div style={{flex:1,overflow:"auto",padding:"24px 20px"}}>
        <div style={{fontSize:11,fontWeight:700,color:"#C2622D",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:12}}>Étape {currentStep+1}</div>
        <p style={{fontSize:17,color:"#0F172A",lineHeight:1.7,margin:0,fontWeight:500}}>{instructions[currentStep]?.replace(/^\d+\.\s*/,"")}</p>
        {detectTimer(instructions[currentStep]||"")&&<StepTimer key={currentStep} seconds={detectTimer(instructions[currentStep])} stepIdx={currentStep}/>}
        {currentStep<total-1&&(
          <div style={{marginTop:24,padding:"12px 14px",background:"#F8FAFC",borderRadius:10,border:"1px solid #F1F5F9"}}>
            <div style={{fontSize:11,color:"#94A3B8",fontWeight:600,marginBottom:4}}>Étape suivante</div>
            <p style={{fontSize:13,color:"#94A3B8",margin:0,lineHeight:1.5}}>{instructions[currentStep+1]?.replace(/^\d+\.\s*/,"").substring(0,120)}{instructions[currentStep+1]?.length>120?"…":""}</p>
          </div>
        )}
        {currentStep===total-1&&(
          <div style={{marginTop:24,padding:"20px",background:"#F0FDF4",borderRadius:12,textAlign:"center"}}>
            <div style={{fontSize:32,marginBottom:8}}>🎉</div>
            <div style={{fontSize:16,fontWeight:700,color:"#065F46"}}>Recette terminée !</div>
          </div>
        )}
      </div>
      <div style={{padding:"16px 20px",borderTop:"1px solid #E2E8F0",display:"flex",gap:12,background:"#FFFFFF",flexShrink:0}}>
        <button onClick={()=>setCurrentStep(s=>Math.max(0,s-1))} disabled={currentStep===0}
          style={{flex:1,padding:"12px",background:"#F1F5F9",border:"none",borderRadius:10,color:currentStep===0?"#CBD5E1":"#475569",fontWeight:600,fontSize:14,cursor:currentStep===0?"not-allowed":"pointer"}}>← Précédent</button>
        {currentStep<total-1
          ?<button onClick={()=>setCurrentStep(s=>s+1)} style={{flex:2,padding:"12px",background:"#C2622D",border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>Étape suivante →</button>
          :<button onClick={onClose} style={{flex:2,padding:"12px",background:"#065F46",border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>✓ Terminer</button>
        }
      </div>
    </div>
  );
}

function RecipeDetailModal({recette,onClose,toast,onAddToCourses,onAddToPlanning}){
  const basePortion=recette.portions||DEFAULT_PORTIONS;
  const [portions,setPortions]=useState(basePortion);
  const [selectedIngredients,setSelectedIngredients]=useState(null);
  const [cookingMode,setCookingMode]=useState(false); // null = not in ingredient select mode
  const score=(recette.likes||0)-(recette.dislikes||0);

  const parsedIngredients=parseIngredients(recette.ingredients);
  const scaled=scaleIngredients(parsedIngredients,basePortion,portions);

  const instructions=recette.instructions
    ?recette.instructions.split(/\n|(?=\d+\.)\s*/).filter(s=>s.trim())
    :[];

  const handleAddToCourses=()=>{
    const selected=scaled.map((ing,i)=>({...ing,selected:true,idx:i}));
    setSelectedIngredients(selected);
  };

  if(cookingMode) return <CookingMode recette={recette} onClose={()=>setCookingMode(false)}/>;

  if(selectedIngredients){
    return(
      <Modal title="Ajouter aux courses" onClose={()=>setSelectedIngredients(null)} wide>
        <p style={{color:"#64748B",fontSize:13,margin:"0 0 16px"}}>Déselectionne les ingrédients déjà disponibles :</p>
        <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:20}}>
          {selectedIngredients.map((ing,i)=>(
            <div key={i} onClick={()=>setSelectedIngredients(prev=>prev.map((x,j)=>j===i?{...x,selected:!x.selected}:x))}
              style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:8,cursor:"pointer",opacity:ing.selected?1:0.4}}>
              <div style={{width:20,height:20,borderRadius:5,border:`2px solid ${ing.selected?"#C2622D":"#334155"}`,background:ing.selected?"#C2622D":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {ing.selected&&<Icon name="check" size={12}/>}
              </div>
              <span style={{flex:1,fontSize:14,color:"#0F172A"}}>{ing.name}</span>
              <span style={{fontSize:12,color:"#64748B"}}>{ing.displayQty||ing.qty||""} {ing.unit}</span>
            </div>
          ))}
        </div>
        <button onClick={async()=>{
          const toAdd=selectedIngredients.filter(i=>i.selected);
          const semaine=new Date().toLocaleDateString("fr-FR",{day:"numeric",month:"short"});
          for(const ing of toAdd){
            const qty=`${ing.displayQty||ing.qty||""} ${ing.unit}`.trim();
            await notionCreate(DB_COURSES,{"Article":nTitle(ing.name),"Catégorie":nSel(guessCategory(ing.name)),"Quantité":nText(qty),"Acheté":nCheck(false),"Semaine":nText(`Sem. du ${semaine}`),"Recette":nText(recette.nom)});
          }
          setCache("courses",null);
          toast(`${toAdd.length} ingrédients ajoutés aux courses ✓`);
          setSelectedIngredients(null);
          onClose();
        }} style={btnPrimary}>Ajouter {selectedIngredients.filter(i=>i.selected).length} ingrédients aux courses</button>
      </Modal>
    );
  }

  return(
    <Modal title={recette.nom} onClose={onClose} full>
      {recette.photo&&<img src={recette.photo} alt={recette.nom} style={{width:"100%",height:220,objectFit:"cover",borderRadius:10,marginBottom:16}} onError={e=>e.target.style.display="none"}/>}

      {/* Header info */}
      <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
        {recette.categorie&&<span style={{fontSize:12,padding:"4px 10px",borderRadius:6,background:"#F1F5F9",color:"#64748B"}}>{recette.categorie}</span>}
        {recette.temps>0&&<span style={{fontSize:12,padding:"4px 10px",borderRadius:6,background:"#F1F5F9",color:"#64748B"}}>⏱ {recette.temps} min</span>}
        <ScoreBadge score={score}/>
        {recette.fois_cuisinee>0&&<span style={{fontSize:12,color:"#64748B"}}>🍳 {recette.fois_cuisinee}x</span>}
        <DaysSince date={recette.derniere_cuisson}/>
        {recette.sourceUrl&&<a href={recette.sourceUrl} target="_blank" rel="noreferrer" style={{display:"flex",alignItems:"center",gap:4,fontSize:12,color:"#C2622D",textDecoration:"none"}}><Icon name="external" size={12}/> Recette originale</a>}
      </div>

      {/* Portions adjuster */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20,padding:"12px 16px",background:"#F1F5F9",borderRadius:10}}>
        <Icon name="people" size={16}/>
        <span style={{fontSize:13,color:"#64748B",flex:1}}>Portions</span>
        <button onClick={()=>setPortions(p=>Math.max(1,p-1))} style={{width:28,height:28,borderRadius:"50%",background:"#E2E8F0",border:"none",color:"#0F172A",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
        <span style={{fontSize:16,fontWeight:700,color:"#0F172A",minWidth:24,textAlign:"center"}}>{portions}</span>
        <button onClick={()=>setPortions(p=>p+1)} style={{width:28,height:28,borderRadius:"50%",background:"#E2E8F0",border:"none",color:"#0F172A",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24}}>
        {/* Ingredients */}
        <div>
          <h5 style={{color:"#C2622D",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:12,marginTop:0}}>Ingrédients</h5>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {scaled.map((ing,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #E2E8F0"}}>
                <span style={{fontSize:13,color:"#0F172A"}}>{ing.name}</span>
                <span style={{fontSize:13,color:"#64748B",marginLeft:8,whiteSpace:"nowrap"}}>{ing.scalable?(ing.displayQty||ing.qty):""} {ing.unit}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Instructions */}
        <div>
          <h5 style={{color:"#C2622D",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:12,marginTop:0}}>Instructions</h5>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {instructions.map((step,i)=>(
              <div key={i} style={{display:"flex",gap:10}}>
                <span style={{fontSize:11,fontWeight:700,color:"#C2622D",minWidth:20,marginTop:2}}>{i+1}.</span>
                <span style={{fontSize:13,color:"#475569",lineHeight:1.6}}>{step.replace(/^\d+\.\s*/,"")}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{display:"flex",gap:8,marginTop:24,borderTop:"1px solid #E2E8F0",paddingTop:16,flexWrap:"wrap"}}>
        <button onClick={()=>setCookingMode(true)} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px",background:"#C2622D",border:"none",borderRadius:8,color:"#fff",cursor:"pointer",fontWeight:700,fontSize:13}}>
          🍳 Cuisiner
        </button>
        <button onClick={handleAddToCourses} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:8,color:"#64748B",cursor:"pointer",fontWeight:600,fontSize:13}}>
          <Icon name="cart" size={15}/> Courses
        </button>
        <button onClick={()=>onAddToPlanning(recette,portions,"queue")} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px",background:"#FFFFFF",border:"1px solid #C2622D",borderRadius:8,color:"#C2622D",cursor:"pointer",fontWeight:600,fontSize:13}}>
          <Icon name="queue" size={15}/> File d'attente
        </button>
        <button onClick={()=>onAddToPlanning(recette,portions,"date")} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px",background:"#C2622D",border:"none",borderRadius:8,color:"#fff",cursor:"pointer",fontWeight:600,fontSize:13}}>
          <Icon name="calendar" size={15}/> Planifier
        </button>
      </div>
    </Modal>
  );
}

// ── Add to Planning Modal ─────────────────────────────────────────────────────
function AddToPlanningModal({recette,portions,mode,onClose,toast}){
  const [date,setDate]=useState(new Date().toISOString().split("T")[0]);
  const [moment,setMoment]=useState("Dîner");
  const [saving,setSaving]=useState(false);

  const save=async()=>{
    setSaving(true);
    const isQueue=mode==="queue";
    // For queue: use next monday
    let targetDate=date;
    if(isQueue){
      const now=new Date();
      const day=now.getDay();
      const nextMonday=new Date(now);
      nextMonday.setDate(now.getDate()+(day===0?1:8-day));
      targetDate=nextMonday.toISOString().split("T")[0];
    }
    await notionCreate(DB_PLANNING,{
      "Repas":nTitle(recette.nom),
      "Date":nDate(targetDate),
      "Moment":nSel(moment),
      "Recette":nText(recette.nom),
      "Recette ID":nText(recette.id),
      "Portions":nNum(portions),
      "File d'attente":nCheck(isQueue),
    });
    setCache("planning",null);
    toast(isQueue?`"${recette.nom}" ajouté à la file d'attente ✓`:`"${recette.nom}" planifié ✓`);
    setSaving(false);
    onClose();
  };

  return(
    <Modal title={mode==="queue"?"File d'attente":"Planifier"} onClose={onClose}>
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:"#F1F5F9",borderRadius:10,marginBottom:16}}>
        {recette.photo?(<img src={recette.photo} alt="" style={{width:"100%",height:120,objectFit:"cover",borderRadius:"10px 10px 0 0",display:"block",marginBottom:0}} onError={e=>{e.target.style.display="none";}}/>):(<div style={{width:"100%",height:80,borderRadius:"10px 10px 0 0",background:"#F1F5F9",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32}}>{recette.categorie==="Dessert"?"🍰":recette.categorie==="Petit-déjeuner"?"🥐":recette.categorie==="Soupe"?"🍲":"🍽️"}</div>)}
        <div>
          <div style={{fontSize:14,fontWeight:700,color:"#0F172A"}}>{recette.nom}</div>
          <div style={{fontSize:12,color:"#64748B"}}>{portions} portions</div>
        </div>
      </div>
      {mode==="date"&&(
        <Field label="Date">
          <input style={inputStyle} type="date" value={date} onChange={e=>setDate(e.target.value)}/>
        </Field>
      )}
      {mode==="queue"&&(
        <p style={{color:"#64748B",fontSize:13,margin:"0 0 16px"}}>Cette recette sera ajoutée à la file d'attente de la semaine prochaine.</p>
      )}
      <Field label="Moment">
        <select style={inputStyle} value={moment} onChange={e=>setMoment(e.target.value)}>
          {MOMENTS.map(m=><option key={m}>{m}</option>)}
        </select>
      </Field>
      <button onClick={save} disabled={saving} style={btnPrimary}>{saving?"Enregistrement...":mode==="queue"?"Ajouter à la file":"Planifier"}</button>
    </Modal>
  );
}

// ── Recipe Form ───────────────────────────────────────────────────────────────
function RecipeForm({form,setForm,saving,onSave,analyzing}){
  const isReady=form.nom&&!analyzing&&!saving;
  return(
    <>
      <Field label="Nom"><input style={inputStyle} value={form.nom} onChange={e=>setForm(f=>({...f,nom:e.target.value}))} placeholder="Ex: Poulet rôti aux herbes"/></Field>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Field label="Catégorie">
          <select style={inputStyle} value={form.categorie} onChange={e=>setForm(f=>({...f,categorie:e.target.value}))}>
            {["Déjeuner","Dîner","Dessert","Sauce & Marinade"].map(c=><option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Note">
          <select style={inputStyle} value={form.note} onChange={e=>setForm(f=>({...f,note:e.target.value}))}>
            {["*","**","***","****","*****"].map(n=><option key={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Temps (min)"><input style={inputStyle} type="number" value={form.temps} onChange={e=>setForm(f=>({...f,temps:e.target.value}))} placeholder="30"/></Field>
        <Field label="Portions"><input style={inputStyle} type="number" value={form.portions} onChange={e=>setForm(f=>({...f,portions:e.target.value}))}/></Field>
      </div>
      <Field label="URL source (optionnel)"><input style={inputStyle} value={form.sourceUrl||""} onChange={e=>setForm(f=>({...f,sourceUrl:e.target.value}))} placeholder="https://marmiton.org/..."/></Field>
      <Field label="URL photo (optionnel)"><input style={inputStyle} value={form.photoUrl||""} onChange={e=>setForm(f=>({...f,photoUrl:e.target.value}))} placeholder="https://..."/></Field>
      <Field label="Ingrédients (un par ligne)"><textarea style={{...inputStyle,minHeight:100,resize:"vertical"}} value={form.ingredients} onChange={e=>setForm(f=>({...f,ingredients:e.target.value}))} placeholder={"200g poulet\n2 gousses d'ail\n1 citron"}/></Field>
      <Field label="Instructions"><textarea style={{...inputStyle,minHeight:100,resize:"vertical"}} value={form.instructions} onChange={e=>setForm(f=>({...f,instructions:e.target.value}))} placeholder="1. Préchauffer le four..."/></Field>
      <button onClick={onSave} disabled={!isReady} style={isReady?btnPrimary:btnDisabled}>{saving?"Enregistrement...":analyzing?"Analyse...":"Sauvegarder"}</button>
    </>
  );
}

// ── Add Recipe Modal ──────────────────────────────────────────────────────────
const METHODS=[
  {id:"manual",label:"Saisie manuelle",icon:"edit",color:"#C2622D"},
  {id:"photo",label:"Photo",icon:"camera",color:"#F59E0B"},
  {id:"url",label:"URL",icon:"link",color:"#10B981"},
  {id:"ai",label:"Générer avec l'IA",icon:"sparkle",color:"#EC4899"},
  {id:"ingredients",label:"Par ingrédients",icon:"chef",color:"#14B8A6"},
];

function AddRecipeModal({onClose,onSaved}){
  const [method,setMethod]=useState(null);
  const [form,setForm]=useState({...EMPTY_FORM});
  const [saving,setSaving]=useState(false);
  const [analyzing,setAnalyzing]=useState(false);
  const [photoPreview,setPhotoPreview]=useState(null);
  const [url,setUrl]=useState("");
  const [prompt,setPrompt]=useState("");
  const fileInputRef=useRef(null);

  const handlePhotoFile=async(file)=>{
    if(!file||!file.type.startsWith("image/"))return;
    setPhotoPreview(URL.createObjectURL(file));
    setAnalyzing(true);
    const reader=new FileReader();
    reader.onload=async(e)=>{
      const base64=e.target.result.split(",")[1];
      const result=await claudeVision(RECIPE_JSON_PROMPT,base64,file.type);
      if(result)setForm(f=>({...f,...result,tags:Array.isArray(result.tags)?result.tags:f.tags,photoUrl:f.photoUrl}));
      setAnalyzing(false);
    };
    reader.readAsDataURL(file);
  };

  const fetchFromUrl=async()=>{
    if(!url)return;
    setAnalyzing(true);
    const result=await claudeJSON("Tu es un expert en recettes. Retourne UNIQUEMENT un JSON valide, sans backticks.",`Visite cette URL et extrais la recette en français avec mesures métriques, ingrédients un par ligne: ${url}\n\n${RECIPE_JSON_PROMPT}`,true);
    if(result)setForm(f=>({...f,...result,tags:Array.isArray(result.tags)?result.tags:f.tags,sourceUrl:url}));
    setAnalyzing(false);
  };

  const generateFromPrompt=async()=>{
    if(!prompt)return;
    setAnalyzing(true);
    const isIng=method==="ingredients";
    const result=await claudeJSON("Tu es un chef cuisinier créatif français. Retourne UNIQUEMENT un JSON valide, sans backticks.",isIng?`L'utilisateur a ces ingrédients: "${prompt}". Propose une recette créative.\n\n${RECIPE_JSON_PROMPT}`:`Génère une recette pour: "${prompt}"\n\n${RECIPE_JSON_PROMPT}`);
    if(result)setForm(f=>({...f,...result,tags:Array.isArray(result.tags)?result.tags:f.tags}));
    setAnalyzing(false);
  };

  const save=async()=>{
    setSaving(true);
    await notionCreate(DB_RECETTES,{
      "Nom":nTitle(form.nom),"Catégorie":nSel(form.categorie),"Temps de préparation":nNum(form.temps),
      "Portions":nNum(form.portions||DEFAULT_PORTIONS),"Ingrédients":nText(form.ingredients),
      "Instructions":nText(form.instructions),"Note":nSel(form.note),
      "Likes":nNum(0),"Dislikes":nNum(0),"Fois cuisinée":nNum(0),
      ...(form.photoUrl?{"Photo":nUrl(form.photoUrl)}:{}),
      ...(form.sourceUrl?{"Source":nUrl(form.sourceUrl)}:{}),
    });
    setSaving(false);
    setCache("recettes",null);
    onSaved("Recette ajoutée ✓");
    onClose();
  };

  if(!method){
    return(<Modal title="Nouvelle recette" onClose={onClose}><p style={{color:"#64748B",fontSize:13,marginBottom:20,marginTop:0}}>Comment veux-tu ajouter cette recette ?</p><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>{METHODS.map(m=>(<button key={m.id} onClick={()=>setMethod(m.id)} style={{padding:"18px 12px",background:"#F1F5F9",border:"1px solid #E2E8F0",borderRadius:12,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:8}} onMouseEnter={e=>{e.currentTarget.style.borderColor=m.color;e.currentTarget.style.background=`${m.color}11`;}} onMouseLeave={e=>{e.currentTarget.style.borderColor="#1E293B";e.currentTarget.style.background="#0A0F1E";}}><div style={{width:40,height:40,borderRadius:"50%",background:`${m.color}22`,display:"flex",alignItems:"center",justifyContent:"center",color:m.color}}><Icon name={m.icon} size={18}/></div><span style={{fontSize:12,fontWeight:600,color:"#0F172A",textAlign:"center"}}>{m.label}</span></button>))}</div></Modal>);
  }

  const backBtn=<button onClick={()=>setMethod(null)} style={{background:"none",border:"none",color:"#C2622D",fontSize:12,cursor:"pointer",marginBottom:16,padding:0}}>← Changer de méthode</button>;

  if(method==="photo"){
    return(<Modal title="Recette depuis une photo" onClose={onClose} wide>{backBtn}<div onClick={()=>fileInputRef.current?.click()} onDrop={e=>{e.preventDefault();handlePhotoFile(e.dataTransfer.files[0]);}} onDragOver={e=>e.preventDefault()} style={{marginBottom:20,borderRadius:12,overflow:"hidden",cursor:"pointer",border:`2px dashed ${photoPreview?"#F59E0B":"#1E293B"}`,background:"#F1F5F9"}}><input ref={fileInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>handlePhotoFile(e.target.files[0])}/>{photoPreview?(<div style={{position:"relative"}}><img src={photoPreview} alt="preview" style={{width:"100%",height:180,objectFit:"cover",display:"block"}}/>{analyzing&&<div style={{position:"absolute",inset:0,background:"rgba(2,6,23,0.8)",display:"flex",alignItems:"center",justifyContent:"center",gap:12}}><div style={{animation:"spin 1s linear infinite",color:"#F59E0B"}}><Icon name="loader" size={24}/></div><span style={{color:"#FDE68A",fontSize:13,fontWeight:600}}>Analyse...</span></div>}{!analyzing&&<div style={{position:"absolute",bottom:8,left:8,background:"#4ADE80",borderRadius:20,padding:"4px 12px",fontSize:11,fontWeight:700,color:"#022c22"}}>✓ Recette reconnue</div>}</div>):(<div style={{padding:32,display:"flex",flexDirection:"column",alignItems:"center",gap:8,textAlign:"center"}}><div style={{width:48,height:48,borderRadius:"50%",background:"#F1F5F9",display:"flex",alignItems:"center",justifyContent:"center",color:"#F59E0B"}}><Icon name="camera" size={22}/></div><div style={{fontSize:13,fontWeight:600,color:"#64748B"}}>Photo du plat ou livre de recette</div></div>)}</div>{(photoPreview&&!analyzing)&&<RecipeForm form={form} setForm={setForm} saving={saving} onSave={save} analyzing={analyzing}/>}</Modal>);
  }
  if(method==="url"){
    return(<Modal title="Recette depuis une URL" onClose={onClose} wide>{backBtn}<Field label="URL de la recette"><div style={{display:"flex",gap:8}}><input style={{...inputStyle,flex:1}} value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://www.marmiton.org/..."/><button onClick={fetchFromUrl} disabled={!url||analyzing} style={{padding:"10px 16px",background:url&&!analyzing?"#10B981":"#1E293B",border:"none",borderRadius:8,color:url&&!analyzing?"#fff":"#475569",fontWeight:600,fontSize:13,cursor:url&&!analyzing?"pointer":"default",whiteSpace:"nowrap"}}>{analyzing?<span style={{animation:"spin 1s linear infinite",display:"inline-block"}}><Icon name="loader" size={14}/></span>:"Extraire"}</button></div></Field>{form.nom&&<RecipeForm form={form} setForm={setForm} saving={saving} onSave={save} analyzing={analyzing}/>}</Modal>);
  }
  if(method==="ai"||method==="ingredients"){
    const color=method==="ai"?"#EC4899":"#14B8A6";
    return(<Modal title={method==="ai"?"Générer avec l'IA":"Recherche par ingrédients"} onClose={onClose} wide>{backBtn}<Field label={method==="ai"?"Décris la recette":"Quels ingrédients as-tu ?"}><div style={{display:"flex",flexDirection:"column",gap:8}}><textarea style={{...inputStyle,minHeight:80,resize:"vertical"}} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={method==="ai"?"Ex: pasta crémeuse au saumon fumé...":"Ex: j'ai des courgettes, du parmesan..."}/><button onClick={generateFromPrompt} disabled={!prompt||analyzing} style={{padding:"11px 16px",background:prompt&&!analyzing?color:"#1E293B",border:"none",borderRadius:8,color:prompt&&!analyzing?"#fff":"#475569",fontWeight:600,fontSize:13,cursor:prompt&&!analyzing?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>{analyzing?<><span style={{animation:"spin 1s linear infinite",display:"inline-block"}}><Icon name="loader" size={14}/></span>Génération...</>:<><Icon name="sparkle" size={14}/>Générer</>}</button></div></Field>{form.nom&&<RecipeForm form={form} setForm={setForm} saving={saving} onSave={save} analyzing={analyzing}/>}</Modal>);
  }
  return(<Modal title="Saisie manuelle" onClose={onClose} wide>{backBtn}<RecipeForm form={form} setForm={setForm} saving={saving} onSave={save} analyzing={false}/></Modal>);
}

// ── Recettes Tab ──────────────────────────────────────────────────────────────
function RecettesTab({toast}){
  const [recettes,setRecettes]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showAdd,setShowAdd]=useState(false);
  const [selected,setSelected]=useState(null);
  const [planningTarget,setPlanningTarget]=useState(null); // {recette, portions, mode}
  const [filter,setFilter]=useState("Toutes");
  const [sortBy,setSortBy]=useState("score");
  const [voting,setVoting]=useState(null);
  const [searchQuery,setSearchQuery]=useState("");

  const load=useCallback(async(force=false)=>{
    const cached=getCached("recettes");
    if(cached&&!force){setRecettes(cached);setLoading(false);return;}
    setLoading(true);
    try{const data=await notionQuery(DB_RECETTES);const parsed=(data.results||[]).map(parseRecette);setRecettes(parsed);setCache("recettes",parsed);}catch(e){console.error(e);}
    setLoading(false);
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
            style={{width:"100%",padding:"10px 14px 10px 36px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:10,fontSize:13,color:"#0F172A",outline:"none",fontFamily:"inherit"}}
          />
          <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#94A3B8",fontSize:14}}>🔍</span>
          {searchQuery&&<button onClick={()=>setSearchQuery("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#94A3B8",cursor:"pointer",fontSize:16,lineHeight:1}}>✕</button>}
        </div>
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,gap:12,flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {cats.map(c=>(<button key={c} onClick={()=>setFilter(c)} style={{padding:"6px 14px",borderRadius:20,fontSize:12,fontWeight:600,cursor:"pointer",border:"1px solid",borderColor:filter===c?"#C2622D":"#1E293B",background:filter===c?"#C2622D":"transparent",color:filter===c?"#fff":"#94A3B8"}}>{c}</button>))}
        </div>
        <div style={{display:"flex",gap:8}}>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{...inputStyle,width:"auto",fontSize:12,padding:"6px 10px"}}><option value="score">Score</option><option value="cuisinee">Plus cuisinée</option><option value="recent">À refaire</option></select>
          <button onClick={()=>load(true)} style={{padding:"8px 10px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:8,color:"#64748B",cursor:"pointer"}}><Icon name="refresh" size={14}/></button>
          <button onClick={async()=>{toast("Récupération des photos...");const res=await fetch('/api/sync-photos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});const data=await res.json();toast(`Photos: ${data.updated} mises à jour ✓`);load(true);}} title="Récupérer les photos Samsung Food" style={{padding:"8px 10px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:8,color:"#F59E0B",cursor:"pointer",fontSize:11,fontWeight:600}}>📷</button>
          <button onClick={()=>setShowAdd(true)} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 16px",background:"#C2622D",border:"none",borderRadius:8,color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer"}}><Icon name="plus" size={16}/>Nouvelle</button>
        </div>
      </div>

      {loading?<Spinner label="Chargement des recettes..."/>:(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))",gap:14}}>
          {sorted.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",padding:48,color:"#64748B"}}><div style={{fontSize:40,marginBottom:12}}>📖</div><div style={{fontSize:14}}>Aucune recette.</div></div>}
          {sorted.map((r,i)=>(
            <div key={i} style={{background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:12,overflow:"hidden",cursor:"pointer",transition:"border-color 0.15s,transform 0.15s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor="#C2622D";e.currentTarget.style.transform="translateY(-2px)";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="#1E293B";e.currentTarget.style.transform="translateY(0)";}}>
              {r.photo&&<img src={r.photo} alt={r.nom} style={{width:"100%",height:120,objectFit:"cover",display:"block"}} onError={e=>e.target.style.display="none"} onClick={()=>setSelected(r)}/>}
              <div style={{padding:14}} onClick={()=>setSelected(r)}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                  <h4 style={{margin:0,fontSize:13,fontWeight:700,color:"#0F172A",fontFamily:"'Playfair Display', serif",lineHeight:1.3,flex:1,marginRight:8}}>{r.nom||"Sans titre"}</h4>
                  <ScoreBadge score={score(r)}/>
                </div>
                {r.categorie&&<span style={{fontSize:11,fontWeight:600,padding:"3px 8px",borderRadius:4,background:"#F1F5F9",color:"#64748B"}}>{r.categorie}</span>}
                <div style={{marginTop:8,display:"flex",gap:10,fontSize:11,color:"#64748B",flexWrap:"wrap"}}>
                  {r.temps>0&&<span>⏱ {r.temps}min</span>}
                  {r.fois_cuisinee>0&&<span>🍳 {r.fois_cuisinee}x</span>}
                </div>
              </div>
              <div style={{display:"flex",gap:0,borderTop:"1px solid #E2E8F0"}} onClick={e=>e.stopPropagation()}>
                <button onClick={()=>vote(r,"up")} disabled={voting===r.id+"up"} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"8px",background:"transparent",border:"none",borderRight:"1px solid #E2E8F0",color:"#4ADE80",cursor:"pointer",fontSize:12,fontWeight:600}}><Icon name="thumb_up" size={12}/>{r.likes||0}</button>
                <button onClick={()=>vote(r,"down")} disabled={voting===r.id+"down"} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"8px",background:"transparent",border:"none",color:"#F87171",cursor:"pointer",fontSize:12,fontWeight:600}}><Icon name="thumb_down" size={12}/>{r.dislikes||0}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd&&<AddRecipeModal onClose={()=>setShowAdd(false)} onSaved={(msg)=>{toast(msg);load(true);}}/>}

      {selected&&!planningTarget&&(
        <RecipeDetailModal
          recette={selected}
          onClose={()=>setSelected(null)}
          toast={toast}
          onAddToCourses={()=>{}}
          onAddToPlanning={(r,p,mode)=>setPlanningTarget({recette:r,portions:p,mode})}
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

// ── Planning Tab ──────────────────────────────────────────────────────────────
function CoursesModal({onClose,coursesSelection,setCoursesSelection,recettes,groupMode,setGroupMode,toast}){
  const [generatingCourses,setGeneratingCourses]=useState(false);
  const btnSmall={padding:"3px 10px",fontSize:11,fontWeight:600,border:"1px solid #E2E8F0",borderRadius:6,background:"#FFFFFF",color:"#475569",cursor:"pointer"};

  const semaine=new Date().toLocaleDateString("fr-FR",{day:"numeric",month:"short"});

  // Construire liste aplatie d'ingrédients
  const buildIngredients=(selection)=>{
    const list=[];
    for(const meal of selection){
      const recetteNom=meal.recette||meal.repas;
      const recetteData=recettes.find(r=>r.id===meal.recette_id||r.nom===recetteNom);
      if(!recetteData?.ingredients)continue;
      const lines=recetteData.ingredients.split("\n").filter(l=>l.trim());
      for(const line of lines){
        const trimmed=line.replace(/^[-•*\d.]+\s*/,"").trim();
        if(!trimmed)continue;
        const parts=trimmed.match(/^([\d,./]+\s*(?:g|kg|ml|L|cl|càs|càc|cup|oz)?)?\s*(.+)/i);
        const qty=parts?.[1]?.trim()||"";
        const nom=parts?.[2]?.trim()||trimmed;
        list.push({nom,qty,recette:recetteNom,categorie:guessCategory(nom),semaine:`Sem. du ${semaine}`});
      }
    }
    return list;
  };

  const [ingsList,setIngsList]=useState(()=>buildIngredients(coursesSelection.filter(m=>m.selected)).map(i=>({...i,selected:true})));

  // Reconstruire quand la sélection recettes change
  const selRecettes=coursesSelection.filter(m=>m.selected);
  const allIngs=ingsList;
  const totalSel=ingsList.filter(i=>i.selected).length;

  // Grouper
  const grouped={};
  ingsList.forEach((ing,idx)=>{
    const key=groupMode==="recette"?ing.recette:ing.categorie;
    if(!grouped[key])grouped[key]=[];
    grouped[key].push({...ing,_idx:idx});
  });
  const groups=Object.entries(grouped);

  const toggleRecette=(i)=>{
    const recNom=coursesSelection[i].recette||coursesSelection[i].repas;
    const newSel=coursesSelection.map((x,j)=>j===i?{...x,selected:!x.selected}:x);
    setCoursesSelection(newSel);
    const newSelRecettes=newSel.filter(m=>m.selected);
    setIngsList(buildIngredients(newSelRecettes).map(ing=>({...ing,selected:true})));
  };

  const toggleIng=(idx)=>setIngsList(l=>l.map((x,i)=>i===idx?{...x,selected:!x.selected}:x));
  const toggleGroup=(idxs,val)=>setIngsList(l=>l.map((x,i)=>idxs.has(i)?{...x,selected:val}:x));
  const toggleAllIngs=(val)=>setIngsList(l=>l.map(x=>({...x,selected:val})));
  const toggleAllRecettes=(val)=>{
    const newSel=coursesSelection.map(x=>({...x,selected:val}));
    setCoursesSelection(newSel);
    setIngsList(buildIngredients(newSel.filter(m=>m.selected)).map(i=>({...i,selected:true})));
  };

  const doImport=async()=>{
    setGeneratingCourses(true);
    let ok=0;
    for(const ing of ingsList.filter(i=>i.selected)){
      try{
        await notionCreate(DB_COURSES,{
          "Article":nTitle(ing.nom),"Catégorie":nSel(ing.categorie),
          "Quantité":nText(ing.qty),"Acheté":nCheck(false),
          "Semaine":nText(ing.semaine),"Recette":nText(ing.recette),
        });
        ok++;
      }catch(e){console.error(e);}
    }
    setGeneratingCourses(false);
    setShowCoursesModal(false);
    toast(`${ok} articles ajoutés à la liste de courses ✓`);
    setCache("courses",null);
  };

  return(
    <Modal title="🛒 Générer la liste de courses" onClose={onClose} wide>
      <p style={{fontSize:13,color:"#64748B",marginBottom:16}}>File d'attente + repas planifiés sur 2 semaines. Décoche ce que tu as déjà.</p>

      {/* Toggle mode + actions globales */}
      <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:12,color:"#64748B"}}>Regrouper par :</span>
        <button onClick={()=>setGroupMode("recette")} style={{...btnSmall,background:groupMode==="recette"?"#C2622D":"#FFFFFF",color:groupMode==="recette"?"#fff":"#475569",borderColor:groupMode==="recette"?"#C2622D":"#E2E8F0"}}>🍽️ Recette</button>
        <button onClick={()=>setGroupMode("categorie")} style={{...btnSmall,background:groupMode==="categorie"?"#C2622D":"#FFFFFF",color:groupMode==="categorie"?"#fff":"#475569",borderColor:groupMode==="categorie"?"#C2622D":"#E2E8F0"}}>🏪 Catégorie</button>
        <div style={{marginLeft:"auto",display:"flex",gap:6}}>
          <button style={btnSmall} onClick={()=>toggleAllIngs(true)}>Tout cocher</button>
          <button style={btnSmall} onClick={()=>toggleAllIngs(false)}>Tout décocher</button>
        </div>
      </div>

      {/* Chips recettes */}
      <div style={{background:"#F8FAFC",border:"1px solid #E2E8F0",borderRadius:10,padding:12,marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <span style={{fontSize:12,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.06em"}}>Recettes incluses</span>
          <div style={{display:"flex",gap:6}}>
            <button style={btnSmall} onClick={()=>toggleAllRecettes(true)}>Tout cocher</button>
            <button style={btnSmall} onClick={()=>toggleAllRecettes(false)}>Tout décocher</button>
          </div>
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {coursesSelection.map((m,i)=>(
            <div key={i} onClick={()=>toggleRecette(i)}
              style={{display:"flex",alignItems:"center",gap:5,padding:"5px 10px",borderRadius:20,
                border:`1px solid ${m.selected?"#C2622D":"#E2E8F0"}`,
                background:m.selected?"rgba(194,98,45,0.08)":"#FFFFFF",
                cursor:"pointer",fontSize:12,fontWeight:500,color:m.selected?"#C2622D":"#64748B"}}>
              {m.selected&&<Icon name="check" size={10}/>}{m.recette||m.repas}
            </div>
          ))}
        </div>
      </div>

      {/* Ingrédients groupés */}
      {ingsList.length===0&&<p style={{fontSize:13,color:"#64748B",textAlign:"center",padding:"16px 0"}}>Aucun ingrédient trouvé — les recettes ont-elles des ingrédients renseignés ?</p>}
      {groups.map(([groupKey,items])=>(
        <div key={groupKey} style={{marginBottom:10,background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:10,overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 14px",background:"#F8FAFC",borderBottom:"1px solid #E2E8F0"}}>
            <span style={{fontSize:12,fontWeight:700,color:"#0F172A"}}>{groupKey}</span>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontSize:11,color:"#94A3B8"}}>{items.filter(i=>ingsList[i._idx]?.selected).length}/{items.length}</span>
              <button style={btnSmall} onClick={()=>toggleGroup(new Set(items.map(i=>i._idx)),true)}>Tout cocher</button>
              <button style={btnSmall} onClick={()=>toggleGroup(new Set(items.map(i=>i._idx)),false)}>Tout décocher</button>
            </div>
          </div>
          {items.map((ing,j)=>{
            const isSel=ingsList[ing._idx]?.selected!==false;
            return(
            <div key={j} onClick={()=>toggleIng(ing._idx)}
              style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px",
                borderBottom:j<items.length-1?"1px solid #F1F5F9":"none",cursor:"pointer",
                background:isSel?"#FFFFFF":"#FAFAFA",opacity:isSel?1:0.5}}>
              <div style={{width:16,height:16,borderRadius:3,border:`1.5px solid ${isSel?"#C2622D":"#CBD5E1"}`,
                background:isSel?"#C2622D":"#FFFFFF",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {isSel&&<Icon name="check" size={10}/>}
              </div>
              <span style={{flex:1,fontSize:13,color:"#0F172A",textDecoration:isSel?"none":"line-through"}}>{ing.nom}</span>
              {ing.qty&&<span style={{fontSize:12,color:"#94A3B8",marginRight:4}}>{ing.qty}</span>}
              {groupMode==="categorie"&&<span style={{fontSize:11,color:"#CBD5E1",fontStyle:"italic"}}>{ing.recette}</span>}
            </div>
            );
          })}
        </div>
      ))}

      <button disabled={generatingCourses||totalSel===0} onClick={doImport}
        style={totalSel>0&&!generatingCourses?{...btnPrimary,marginTop:8,width:"100%"}:{...btnDisabled,marginTop:8,width:"100%"}}>
        {generatingCourses?"Import en cours...":"Importer "+totalSel+" article"+(totalSel>1?"s":"")+" dans Notion"}
      </button>
    </Modal>
  );
}

function PlanningTab({toast}){
  const [planning,setPlanning]=useState([]);
  const [recettes,setRecettes]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showForm,setShowForm]=useState(false);
  const [weekOffset,setWeekOffset]=useState(0);
  const [dragItem,setDragItem]=useState(null);
  const [dragOver,setDragOver]=useState(null);
  const touchDragRef=useRef(null); // {item, ghost, startX, startY}

  // Cleanup global si touch annulé
  useEffect(()=>{
    const cleanup=()=>{
      if(touchDragRef.current?.ghost){
        try{touchDragRef.current.ghost.remove();}catch(e){}
        touchDragRef.current=null;
      }
      setDragItem(null);setDragOver(null);
    };
    window.addEventListener("touchcancel",cleanup);
    return()=>window.removeEventListener("touchcancel",cleanup);
  },[]);
  const [confirming,setConfirming]=useState(null);
  const [form,setForm]=useState({recetteQuery:"",recetteId:"",moment:"Dîner",portions:DEFAULT_PORTIONS,notes:"",date:"",queue:false});
  const [suggestions,setSuggestions]=useState([]);
  const [saving,setSaving]=useState(false);
  const [showCoursesModal,setShowCoursesModal]=useState(false);
  const [coursesSelection,setCoursesSelection]=useState([]);
  const [groupMode,setGroupMode]=useState("recette");
  const [selectedMealRecette,setSelectedMealRecette]=useState(null);

  const getWeekDates=(offset=0)=>{
    const now=new Date();const day=now.getDay();
    const monday=new Date(now);monday.setDate(now.getDate()-(day===0?6:day-1)+offset*7);
    return Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setDate(monday.getDate()+i);return d;});
  };
  const weekDates=getWeekDates(weekOffset);

  const load=useCallback(async(force=false)=>{
    const cachedP=getCached("planning");
    const cachedR=getCached("recettes");
    if(cachedP&&!force)setPlanning(cachedP);
    else{
      setLoading(true);
      try{const data=await notionQuery(DB_PLANNING);const parsed=(data.results||[]).map(parsePlanning);setPlanning(parsed);setCache("planning",parsed);}catch(e){console.error(e);}
    }
    if(cachedR&&!force)setRecettes(cachedR);
    else{
      try{const data=await notionQuery(DB_RECETTES);const parsed=(data.results||[]).map(parseRecette);setRecettes(parsed);setCache("recettes",parsed);}catch(e){console.error(e);}
    }
    setLoading(false);
  },[weekOffset]);

  useEffect(()=>{load();},[load]);

  // Autocomplete
  useEffect(()=>{
    if(!form.recetteQuery||form.recetteQuery.length<2){setSuggestions([]);return;}
    const q=form.recetteQuery.toLowerCase();
    setSuggestions(recettes.filter(r=>r.nom.toLowerCase().includes(q)).slice(0,6));
  },[form.recetteQuery,recettes]);

  const save=async()=>{
    setSaving(true);
    const targetDate=form.queue?(()=>{const now=new Date();const day=now.getDay();const nextMonday=new Date(now);nextMonday.setDate(now.getDate()+(day===0?1:8-day));return nextMonday.toISOString().split("T")[0];})():form.date;
    await notionCreate(DB_PLANNING,{
      "Repas":nTitle(form.recetteQuery),"Date":nDate(targetDate),"Moment":nSel(form.moment),
      "Recette":nText(form.recetteQuery),"Recette ID":nText(form.recetteId),
      "Portions":nNum(form.portions),"Notes":nText(form.notes),"File d'attente":nCheck(form.queue),
    });
    toast("Repas ajouté ✓");setSaving(false);setShowForm(false);
    setForm({recetteQuery:"",recetteId:"",moment:"Dîner",portions:DEFAULT_PORTIONS,notes:"",date:"",queue:false});
    setCache("planning",null);load(true);
  };

  const confirmCuisine=async(meal)=>{
    setConfirming(meal.id);
    const updated=planning.map(p=>p.id===meal.id?{...p,fait:true}:p);
    setPlanning(updated);setCache("planning",updated);
    notionUpdate(meal.id,{"Acheté":nCheck(true)});
    toast(`"${meal.recette}" cuisiné ✓`);setConfirming(null);
  };

  // Drag and drop
  const handleDrop=async(targetDate,targetMoment)=>{
    if(!dragItem)return;
    const updated=planning.map(p=>p.id===dragItem.id?{...p,date:targetDate,moment:targetMoment,queue:false}:p);
    setPlanning(updated);setCache("planning",updated);
    notionUpdate(dragItem.id,{"Date":nDate(targetDate),"Moment":nSel(targetMoment),"File d'attente":nCheck(false)});
    toast(`"${dragItem.recette}" déplacé ✓`);
    setDragItem(null);setDragOver(null);
  };

  const isToday=d=>d.toDateString()===new Date().toDateString();
  const isPast=d=>d<new Date()&&!isToday(d);
  const getMeals=date=>planning.filter(p=>p.date===date.toISOString().split("T")[0]&&!p.queue);
  const getQueue=()=>planning.filter(p=>p.queue||(p.date&&p.date>=weekDates[0].toISOString().split("T")[0]&&p.date<=weekDates[6].toISOString().split("T")[0]&&!planning.find(x=>x.id===p.id&&!p.queue)));
  const queueItems=planning.filter(p=>p.queue);
  const weekLabel=()=>({0:"Cette semaine",1:"Semaine prochaine","-1":"Semaine dernière"}[weekOffset]||`Sem. ${weekOffset>0?"+":""}${weekOffset}`);

  const MealChip=({meal,onViewRecette,onMoveToQueue})=>(

    <div draggable onDragStart={()=>setDragItem(meal)} onDragEnd={()=>setDragItem(null)}
      onTouchStart={(e)=>{
        const touch=e.touches[0];
        const ghost=e.currentTarget.cloneNode(true);
        ghost.style.cssText=`position:fixed;top:${touch.clientY-30}px;left:${touch.clientX-80}px;width:160px;opacity:0.85;z-index:9999;pointer-events:none;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.2);`;
        document.body.appendChild(ghost);
        touchDragRef.current={item:meal,ghost,startX:touch.clientX,startY:touch.clientY};
        setDragItem(meal);
      }}
      onTouchMove={(e)=>{
        if(!touchDragRef.current)return;
        e.preventDefault();
        const touch=e.touches[0];
        touchDragRef.current.ghost.style.top=touch.clientY-30+"px";
        touchDragRef.current.ghost.style.left=touch.clientX-80+"px";
        // Détecter la drop zone sous le doigt
        const el=document.elementFromPoint(touch.clientX,touch.clientY);
        const zone=el?.closest("[data-dropzone]");
        setDragOver(zone?.dataset.dropzone||null);
      }}
      onTouchEnd={(e)=>{
        if(!touchDragRef.current)return;
        const touch=e.changedTouches[0];
        const el=document.elementFromPoint(touch.clientX,touch.clientY);
        const zone=el?.closest("[data-dropzone]");
        if(zone){
          const key=zone.dataset.dropzone;
          if(key==="queue"){
            const updated=planning.map(p=>p.id===dragItem.id?{...p,queue:true}:p);
            setPlanning(updated);
            notionUpdate(dragItem.id,{"File d'attente":nCheck(true)});
            toast(`"${dragItem.recette}" remis en file d'attente ✓`);
          } else {
            handleDrop(key,"Dîner");
          }
        }
        touchDragRef.current.ghost.remove();
        touchDragRef.current=null;
        setDragItem(null);setDragOver(null);
      }}
      style={{borderRadius:6,overflow:"hidden",marginBottom:4,opacity:dragItem?.id===meal.id?0.4:1,cursor:"grab",touchAction:"none"}}>
      <div style={{padding:"4px 7px",fontSize:11,fontWeight:600,background:`${MOMENT_COLORS[meal.moment]||"#64748B"}22`,color:MOMENT_COLORS[meal.moment]||"#94A3B8",lineHeight:1.3,textDecoration:meal.fait?"line-through":"none",opacity:meal.fait?0.5:1,display:"flex",alignItems:"center",gap:4}}>
        <Icon name="drag" size={8}/>
        <span style={{flex:1,cursor:"pointer"}} onClick={(e)=>{e.stopPropagation();onViewRecette&&onViewRecette(meal);}}>{meal.recette||meal.repas}</span>
      </div>
      <div style={{display:"flex",gap:2}}>
        <button onClick={(e)=>{e.stopPropagation();const updated=setPlanning?setPlanning:null;/* handled via prop */onMoveToQueue&&onMoveToQueue(meal);}} style={{flex:1,padding:"2px",background:"#F1F5F9",border:"none",color:"#94A3B8",fontSize:9,fontWeight:600,cursor:"pointer"}}>↩ File</button>
        {!meal.fait&&<button onClick={()=>confirmCuisine(meal)} disabled={confirming===meal.id} style={{flex:1,padding:"2px",background:"#F1F5F9",border:"none",color:"#94A3B8",fontSize:9,fontWeight:700,cursor:"pointer"}}>✓ Cuisiné</button>}
        {meal.fait&&<div style={{flex:1,padding:"2px 7px",background:"#D1FAE5",fontSize:9,color:"#065F46",fontWeight:700,textAlign:"center"}}>✓ fait</div>}
      </div>
    </div>
  );

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>setWeekOffset(w=>w-1)} style={{background:"#F1F5F9",border:"none",borderRadius:6,color:"#64748B",cursor:"pointer",padding:"6px 10px",transform:"rotate(180deg)"}}><Icon name="arrow" size={16}/></button>
          <span style={{fontSize:14,fontWeight:700,color:"#0F172A"}}>{weekLabel()}</span>
          <button onClick={()=>setWeekOffset(w=>w+1)} style={{background:"#F1F5F9",border:"none",borderRadius:6,color:"#64748B",cursor:"pointer",padding:"6px 10px"}}><Icon name="arrow" size={16}/></button>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>load(true)} style={{padding:"8px 10px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:8,color:"#64748B",cursor:"pointer"}}><Icon name="refresh" size={14}/></button>
          <button onClick={()=>{
            const today=new Date();today.setHours(0,0,0,0);
            const twoWeeksLater=new Date(today);twoWeeksLater.setDate(today.getDate()+14);
            const todayStr=today.toISOString().split("T")[0];
            const limitStr=twoWeeksLater.toISOString().split("T")[0];
            const planned=planning.filter(p=>!p.queue&&p.date&&p.date>=todayStr&&p.date<=limitStr);
            const meals=[...queueItems,...planned];
            const unique=[];const seen=new Set();
            meals.forEach(m=>{const k=m.recette||m.repas;if(k&&!seen.has(k)){seen.add(k);unique.push(m);}});
            setCoursesSelection(unique.map(m=>({...m,selected:true})));
            setShowCoursesModal(true);
          }} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 12px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:8,color:"#64748B",cursor:"pointer",fontSize:13,fontWeight:600}}>
            <Icon name="cart" size={15}/>Courses
          </button>
          <button onClick={()=>setShowForm(true)} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 16px",background:"#C2622D",border:"none",borderRadius:8,color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer"}}><Icon name="plus" size={16}/>Ajouter</button>
        </div>
      </div>

      {loading?<Spinner label="Chargement..."/>:(
        <div>
          {/* Week grid */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6,marginBottom:16}}>
            {weekDates.map((date,i)=>{
              const meals=getMeals(date);const today=isToday(date);const past=isPast(date);
              const dropKey=date.toISOString().split("T")[0];
              return(
                <div key={i}
                  onDragOver={e=>{e.preventDefault();setDragOver(dropKey);}}
                  onDragLeave={()=>setDragOver(null)}
                  onDrop={()=>handleDrop(dropKey,"Dîner")}
                  data-dropzone={dropKey}
                  style={{background:dragOver===dropKey?"#FEF3C7":today?"#FFF7ED":"#FFFFFF",border:`1px solid ${dragOver===dropKey?"#C2622D":today?"#C2622D":"#E2E8F0"}`,borderRadius:10,padding:8,minHeight:120,opacity:past?0.75:1,transition:"all 0.15s"}}>
                  <div style={{marginBottom:6}}>
                    <div style={{fontSize:10,fontWeight:600,color:today?"#F4A57A":"#64748B",textTransform:"uppercase"}}>{DAYS[i].slice(0,3)}</div>
                    <div style={{fontSize:17,fontWeight:800,color:today?"#C2622D":"#F8FAFC",fontFamily:"'Playfair Display', serif"}}>{date.getDate()}</div>
                  </div>
                  {meals.length===0&&<div style={{fontSize:10,color:"#94A3B8",textAlign:"center",paddingTop:8}}>—</div>}
                  {meals.map((m,j)=><MealChip key={j} meal={m}
  onViewRecette={(meal)=>{const r=recettes.find(x=>x.id===meal.recette_id||x.nom===(meal.recette||meal.repas));if(r)setSelectedMealRecette(r);}}
  onMoveToQueue={(meal)=>{
    const updated=planning.map(p=>p.id===meal.id?{...p,queue:true,date:null}:p);
    setPlanning(updated);
    notionUpdate(meal.id,{"File d'attente":nCheck(true),"Date":nDate(null)});
    toast(`"${meal.recette||meal.repas}" remis en file d'attente ✓`);
  }}
/>)}
                </div>
              );
            })}
          </div>

          {/* Queue */}
          <div style={{background:"#F1F5F9",border:"1px solid #E2E8F0",borderRadius:12,padding:16}}
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
              <Icon name="queue" size={14}/>
              <span style={{fontSize:12,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.08em"}}>File d'attente</span>
              <span style={{fontSize:11,color:"#64748B",marginLeft:"auto"}}>Glisser vers un jour</span>
            </div>
            {queueItems.length===0&&<div style={{fontSize:12,color:"#94A3B8",textAlign:"center",padding:"8px 0"}}>Vide — glisse ici pour mettre en attente</div>}
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
                      handleDrop(zone.dataset.dropzone,"Dîner");
                    }
                    touchDragRef.current.ghost.remove();
                    touchDragRef.current=null;
                    setDragItem(null);setDragOver(null);
                  }}
                  style={{padding:"6px 12px",background:`${MOMENT_COLORS[m.moment]||"#64748B"}22`,border:`1px solid ${MOMENT_COLORS[m.moment]||"#64748B"}44`,borderRadius:20,fontSize:12,fontWeight:600,color:MOMENT_COLORS[m.moment]||"#94A3B8",cursor:"grab",display:"flex",alignItems:"center",gap:6,opacity:dragItem?.id===m.id?0.4:1,touchAction:"none"}}>
                  <Icon name="drag" size={10}/>{m.recette||m.repas}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedMealRecette&&(
        <RecipeDetailModal
          recette={selectedMealRecette}
          onClose={()=>setSelectedMealRecette(null)}
          toast={toast}
          onAddToCourses={()=>{}}
          onAddToPlanning={()=>{}}
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
              <input style={inputStyle} value={form.recetteQuery} onChange={e=>setForm(f=>({...f,recetteQuery:e.target.value,recetteId:""}))} placeholder="Rechercher une recette..."/>
              {suggestions.length>0&&(
                <div style={{position:"absolute",top:"100%",left:0,right:0,background:"#F1F5F9",border:"1px solid #334155",borderRadius:8,zIndex:100,marginTop:4,overflow:"hidden"}}>
                  {suggestions.map((r,i)=>(
                    <div key={i} onClick={()=>{setForm(f=>({...f,recetteQuery:r.nom,recetteId:r.id}));setSuggestions([]);}}
                      style={{padding:"10px 14px",cursor:"pointer",fontSize:13,color:"#0F172A",display:"flex",alignItems:"center",gap:10,borderBottom:"1px solid #334155"}}
                      onMouseEnter={e=>e.currentTarget.style.background="#334155"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      {r.photo&&<img src={r.photo} alt="" style={{width:32,height:32,objectFit:"cover",borderRadius:4}}/>}
                      <div>
                        <div style={{fontWeight:600}}>{r.nom}</div>
                        <div style={{fontSize:11,color:"#64748B"}}>{r.categorie} · {r.portions||DEFAULT_PORTIONS} p.</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Field>
          <div style={{display:"flex",gap:8,marginBottom:16}}>
            <button onClick={()=>setForm(f=>({...f,queue:false}))} style={{flex:1,padding:"8px",borderRadius:8,border:"1px solid",borderColor:!form.queue?"#C2622D":"#1E293B",background:!form.queue?"#312E81":"transparent",color:!form.queue?"#F4A57A":"#64748B",cursor:"pointer",fontSize:12,fontWeight:600}}>📅 Date précise</button>
            <button onClick={()=>setForm(f=>({...f,queue:true}))} style={{flex:1,padding:"8px",borderRadius:8,border:"1px solid",borderColor:form.queue?"#C2622D":"#1E293B",background:form.queue?"#312E81":"transparent",color:form.queue?"#F4A57A":"#64748B",cursor:"pointer",fontSize:12,fontWeight:600}}>⏳ File d'attente</button>
          </div>
          {!form.queue&&<Field label="Date"><input style={inputStyle} type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></Field>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Field label="Moment"><select style={inputStyle} value={form.moment} onChange={e=>setForm(f=>({...f,moment:e.target.value}))}>{MOMENTS.map(m=><option key={m}>{m}</option>)}</select></Field>
            <Field label="Portions"><input style={inputStyle} type="number" value={form.portions} onChange={e=>setForm(f=>({...f,portions:e.target.value}))}/></Field>
          </div>
          <button onClick={save} disabled={saving||!form.recetteQuery||((!form.queue&&!form.date))} style={form.recetteQuery&&(form.queue||form.date)?btnPrimary:btnDisabled}>{saving?"Enregistrement...":"Ajouter"}</button>
        </Modal>
      )}
    </div>
  );
}

// ── Courses Tab ───────────────────────────────────────────────────────────────
function CoursesTab({toast}){
  const [courses,setCourses]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showForm,setShowForm]=useState(false);
  const [sortBy,setSortBy]=useState("categorie"); // "categorie" | "recette"
  const [form,setForm]=useState({article:"",categorie:"Épicerie",quantite:"",semaine:"",recette:""});
  const [saving,setSaving]=useState(false);
  const [showCoursesModal,setShowCoursesModal]=useState(false);
  const [coursesSelection,setCoursesSelection]=useState([]);
  const [generatingCourses,setGeneratingCourses]=useState(false);

  const load=useCallback(async(force=false)=>{
    const cached=getCached("courses");
    if(cached&&!force){setCourses(cached);setLoading(false);return;}
    setLoading(true);
    try{const data=await notionQuery(DB_COURSES);const parsed=(data.results||[]).map(parseCourse);setCourses(parsed);setCache("courses",parsed);}catch(e){console.error(e);}
    setLoading(false);
  },[]);

  useEffect(()=>{load();},[load]);

  const toggleAchete=async(item)=>{
    const newVal=!item.achete;
    const updated=courses.map(c=>c.id===item.id?{...c,achete:newVal}:c);
    setCourses(updated);setCache("courses",updated);
    notionUpdate(item.id,{"Acheté":nCheck(newVal)});
  };

  const addItem=async()=>{
    setSaving(true);
    await notionCreate(DB_COURSES,{"Article":nTitle(form.article),"Catégorie":nSel(form.categorie),"Quantité":nText(form.quantite),"Acheté":nCheck(false),"Semaine":nText(form.semaine),"Recette":nText(form.recette)});
    toast("Article ajouté ✓");setSaving(false);setShowForm(false);
    setForm({article:"",categorie:"Épicerie",quantite:"",semaine:"",recette:""});
    setCache("courses",null);load(true);
  };

  // Group and merge quantities
  const grouped=sortBy==="categorie"
    ?courses.reduce((acc,c)=>{const k=c.categorie||"Autre";if(!acc[k])acc[k]=[];acc[k].push(c);return acc;},{})
    :courses.reduce((acc,c)=>{const k=c.recette||"Sans recette";if(!acc[k])acc[k]=[];acc[k].push(c);return acc;},{});

  const total=courses.length;const done=courses.filter(c=>c.achete).length;

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {total>0&&<><div style={{background:"#F1F5F9",borderRadius:20,height:6,width:120,overflow:"hidden"}}><div style={{background:"#4ADE80",height:"100%",width:`${(done/total)*100}%`,borderRadius:20,transition:"width 0.3s"}}/></div><span style={{fontSize:12,color:"#64748B"}}>{done}/{total}</span></>}
        </div>
        <div style={{display:"flex",gap:8}}>
          <div style={{display:"flex",background:"#F1F5F9",borderRadius:8,overflow:"hidden"}}>
            <button onClick={()=>setSortBy("categorie")} style={{padding:"7px 12px",background:sortBy==="categorie"?"#C2622D":"transparent",border:"none",color:sortBy==="categorie"?"#fff":"#64748B",cursor:"pointer",fontSize:11,fontWeight:600}}>Par rayon</button>
            <button onClick={()=>setSortBy("recette")} style={{padding:"7px 12px",background:sortBy==="recette"?"#C2622D":"transparent",border:"none",color:sortBy==="recette"?"#fff":"#64748B",cursor:"pointer",fontSize:11,fontWeight:600}}>Par recette</button>
          </div>
          <button onClick={()=>load(true)} style={{padding:"8px 10px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:8,color:"#64748B",cursor:"pointer"}}><Icon name="refresh" size={14}/></button>
          <button onClick={()=>setShowForm(true)} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",background:"#C2622D",border:"none",borderRadius:8,color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer"}}><Icon name="plus" size={16}/>Ajouter</button>
        </div>
      </div>

      {loading?<Spinner label="Chargement des courses..."/>:(
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          {Object.keys(grouped).length===0&&<div style={{textAlign:"center",padding:48,color:"#64748B"}}><div style={{fontSize:40,marginBottom:12}}>🛒</div><div style={{fontSize:14}}>Liste vide.</div></div>}
          {Object.entries(grouped).map(([key,items])=>(
            <div key={key}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                {sortBy==="categorie"&&<div style={{width:10,height:10,borderRadius:"50%",background:CAT_COLORS[key]||"#6B7280"}}/>}
                <span style={{fontSize:11,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.1em"}}>{key}</span>
                <span style={{fontSize:10,color:"#64748B"}}>({items.filter(i=>!i.achete).length} restants)</span>
              </div>
              {items.map((item,j)=>(
                <div key={j} onClick={()=>toggleAchete(item)} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:8,cursor:"pointer",opacity:item.achete?0.5:1,marginBottom:4,transition:"opacity 0.2s"}}>
                  <div style={{width:20,height:20,borderRadius:5,border:`2px solid ${item.achete?"#4ADE80":"#334155"}`,background:item.achete?"#4ADE80":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    {item.achete&&<Icon name="check" size={12}/>}
                  </div>
                  <span style={{flex:1,fontSize:14,color:"#0F172A",textDecoration:item.achete?"line-through":"none"}}>{item.article}</span>
                  <span style={{fontSize:12,color:"#64748B"}}>{item.quantite}</span>
                  {sortBy==="categorie"&&item.recette&&<span style={{fontSize:10,color:"#64748B",background:"#F1F5F9",padding:"2px 6px",borderRadius:10}}>{item.recette}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {showForm&&(
        <Modal title="Ajouter un article" onClose={()=>setShowForm(false)}>
          <Field label="Article"><input style={inputStyle} value={form.article} onChange={e=>setForm(f=>({...f,article:e.target.value}))} placeholder="Ex: Tomates"/></Field>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Field label="Catégorie"><select style={inputStyle} value={form.categorie} onChange={e=>setForm(f=>({...f,categorie:e.target.value}))}>{Object.keys(CAT_COLORS).map(c=><option key={c}>{c}</option>)}</select></Field>
            <Field label="Quantité"><input style={inputStyle} value={form.quantite} onChange={e=>setForm(f=>({...f,quantite:e.target.value}))} placeholder="500g..."/></Field>
          </div>
          <Field label="Recette (optionnel)"><input style={inputStyle} value={form.recette} onChange={e=>setForm(f=>({...f,recette:e.target.value}))} placeholder="Ex: Poulet rôti"/></Field>
          <button onClick={addItem} disabled={saving||!form.article} style={form.article?btnPrimary:btnDisabled}>{saving?"Ajout...":"Ajouter"}</button>
        </Modal>
      )}
    </div>
  );
}

// ── Discovery Tab ─────────────────────────────────────────────────────────────
function DiscoveryTab({toast}){
  const [prompt,setPrompt]=useState("");
  const [cards,setCards]=useState([]);
  const [current,setCurrent]=useState(0);
  const [loading,setLoading]=useState(false);
  const [importing,setImporting]=useState(false);
  const [done,setDone]=useState(false);
  const [liked,setLiked]=useState([]);
  const [dragX,setDragX]=useState(0);
  const [dragging,setDragging]=useState(false);
  const startX=useRef(null);
  const cardRef=useRef(null);

  const inputStyle={width:"100%",padding:"12px 16px",background:"#FFFFFF",border:"1px solid #E2E8F0",borderRadius:10,color:"#0F172A",fontSize:15,fontFamily:"inherit",outline:"none"};
  const btnPrimary={padding:"12px 24px",background:"#C2622D",border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer",fontFamily:"inherit",width:"100%"};
  const btnDisabled={...btnPrimary,opacity:0.4,cursor:"not-allowed"};

  async function search(){
    if(!prompt.trim())return;
    setLoading(true);setCards([]);setCurrent(0);setLiked([]);setDone(false);
    try{
      const query=`recette ${prompt}`;
      const res=await fetch("/api/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query})});
      const data=await res.json();
      const EMOJIS=["🍽️","🥗","🍲","🥘","🍜","🥩","🐟","🥦","🍋","🫐"];
      const arr=(data.results||[]).slice(0,9).map((r,i)=>({
        titre:(r.titre||"").replace(/[-|]\s*(Marmiton|CuisineAZ|750g|Chef Simon|Cuisine AZ|Recette)\s*$/gi,"").trim(),
        description:r.description,
        url:r.url,
        source:r.source,
        categorie:r.categorie||"Dîner",
        temps:r.temps||null,
        difficulte:r.difficulte||null,
        emoji:r.emoji||EMOJIS[i%EMOJIS.length],
      }));
      setCards(arr);
    }catch(e){console.error(e);}
    setLoading(false);
  }

  function swipe(dir){
    if(current>=cards.length)return;
    if(dir==="right")setLiked(l=>[...l,cards[current]]);
    setCurrent(c=>c+1);
    setDragX(0);
  }

  // Touch/mouse drag
  function onPointerDown(e){
    startX.current=e.clientX??e.touches?.[0]?.clientX;
    setDragging(true);
  }
  function onPointerMove(e){
    if(!dragging||startX.current==null)return;
    const x=(e.clientX??e.touches?.[0]?.clientX)-startX.current;
    setDragX(x);
  }
  function onPointerUp(){
    if(Math.abs(dragX)>80)swipe(dragX>0?"right":"left");
    else setDragX(0);
    setDragging(false);startX.current=null;
  }

  async function importLiked(){
    if(!liked.length)return;
    setImporting(true);
    let ok=0;
    for(const card of liked){
      try{
        const recipe=await claudeJSON(
          "Tu es un expert en recettes. Retourne UNIQUEMENT un JSON valide, sans backticks.",
          `Visite cette URL et extrais la recette complète en français avec mesures métriques, ingrédients un par ligne: ${card.url}\n\n${RECIPE_JSON_PROMPT}`,
          true
        );
        if(recipe?.nom){
          await notionCreate(DB_RECETTES,{
            "Nom":nTitle(recipe.nom),"Catégorie":nSel(recipe.categorie||card.categorie),
            "Temps de préparation":nNum(recipe.temps||card.temps),"Portions":nNum(recipe.portions||4),
            "Ingrédients":nText(recipe.ingredients||""),"Instructions":nText(recipe.instructions||""),
            "Note":nSel(recipe.note||"***"),"Likes":nNum(0),"Dislikes":nNum(0),"Fois cuisinée":nNum(0),
            "Source":nText(card.url||""),
          });
          ok++;
        }
      }catch(e){console.error(e);}
    }
    setImporting(false);setDone(true);
    toast(`${ok} recette${ok>1?"s":""} importée${ok>1?"s":""} dans Notion ✓`);
  }

  const card=cards[current];
  const isLast=current>=cards.length&&cards.length>0;
  const rotation=dragX/20;
  const likeOpacity=Math.min(1,dragX/60);
  const skipOpacity=Math.min(1,-dragX/60);

  return(
    <div style={{maxWidth:480,margin:"0 auto",paddingTop:16}}>
      {/* Prompt */}
      <div style={{marginBottom:24}}>
        <p style={{color:"#64748B",fontSize:14,marginBottom:12,marginTop:0}}>Décris ce que tu veux cuisiner — occasion, contraintes, saison, nombre de repas…</p>
        <textarea
          value={prompt} onChange={e=>setPrompt(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();search();}}}
          placeholder="Ex: 5 repas légers pour une semaine de canicule, pas de viande rouge"
          rows={3}
          style={{...inputStyle,resize:"vertical",lineHeight:1.5}}
        />
        <button onClick={search} disabled={loading||!prompt.trim()} style={{...(loading||!prompt.trim()?btnDisabled:btnPrimary),marginTop:10}}>
          {loading?"Recherche en cours…":"✨ Trouver des recettes"}
        </button>
      </div>

      {/* Swipe area */}
      {cards.length>0&&!isLast&&(
        <div style={{position:"relative",height:400}}>
          {/* Progress */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{color:"#64748B",fontSize:13}}>{current+1} / {cards.length}</span>
            <div style={{display:"flex",gap:4}}>
              {cards.map((_,i)=>(
                <div key={i} style={{width:20,height:3,borderRadius:2,background:i<current?"#C2622D":i===current?"#F8FAFC":"#1E293B"}}/>
              ))}
            </div>
            <span style={{color:"#C2622D",fontSize:13,fontWeight:600}}>❤️ {liked.length}</span>
          </div>

          {/* Card stack hint */}
          {current+1<cards.length&&(
            <div style={{position:"absolute",top:12,left:"50%",transform:"translateX(-50%)",width:"92%",height:380,background:"#FFFFFF",borderRadius:20,border:"1px solid #E2E8F0"}}/>
          )}

          {/* Main card */}
          <div
            ref={cardRef}
            onMouseDown={onPointerDown} onMouseMove={onPointerMove} onMouseUp={onPointerUp} onMouseLeave={onPointerUp}
            onTouchStart={onPointerDown} onTouchMove={onPointerMove} onTouchEnd={onPointerUp}
            style={{
              position:"absolute",top:0,left:0,right:0,
              background:"linear-gradient(145deg,#0F172A,#1E293B)",
              border:"1px solid #334155",borderRadius:20,padding:28,
              transform:`translateX(${dragX}px) rotate(${rotation}deg)`,
              transition:dragging?"none":"transform 0.3s ease",
              cursor:"grab",userSelect:"none",
              boxShadow:"0 20px 60px rgba(0,0,0,0.5)",
              height:380,display:"flex",flexDirection:"column",justifyContent:"space-between"
            }}
          >
            {/* Like/Skip overlay */}
            {dragX>20&&(
              <div style={{position:"absolute",top:24,right:24,padding:"8px 16px",border:"3px solid #4ADE80",borderRadius:8,color:"#4ADE80",fontWeight:800,fontSize:18,opacity:likeOpacity,transform:"rotate(-15deg)"}}>❤️ OUI</div>
            )}
            {dragX<-20&&(
              <div style={{position:"absolute",top:24,left:24,padding:"8px 16px",border:"3px solid #F87171",borderRadius:8,color:"#F87171",fontWeight:800,fontSize:18,opacity:skipOpacity,transform:"rotate(15deg)"}}>✕ SKIP</div>
            )}

            <div>
              <div style={{fontSize:48,marginBottom:12,textAlign:"center"}}>{card.emoji||"🍽️"}</div>
              <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                <span style={{padding:"3px 10px",background:"#F1F5F9",borderRadius:20,fontSize:12,color:"#64748B"}}>{card.categorie}</span>
                <span style={{padding:"3px 10px",background:"#F1F5F9",borderRadius:20,fontSize:12,color:"#64748B"}}>⏱ {card.temps} min</span>
                <span style={{padding:"3px 10px",background:"#F1F5F9",borderRadius:20,fontSize:12,color:"#64748B"}}>{card.difficulte}</span>
              </div>
              <h2 style={{margin:"0 0 10px",fontSize:22,fontWeight:700,fontFamily:"'Playfair Display',serif",color:"#0F172A",lineHeight:1.3}}>{card.titre}</h2>
              <p style={{margin:0,color:"#64748B",fontSize:14,lineHeight:1.6}}>{card.description}</p>
            </div>
            {card.url&&(
              <a href={card.url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{color:"#C2622D",fontSize:12,textDecoration:"none",marginTop:8}}>🔗 Voir la source</a>
            )}
          </div>

          {/* Action buttons */}
          <div style={{display:"flex",gap:16,marginTop:400,paddingTop:16,justifyContent:"center"}}>
            <button onClick={()=>swipe("left")} style={{width:64,height:64,borderRadius:"50%",background:"#F1F5F9",border:"2px solid #F87171",color:"#F87171",fontSize:24,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            <button onClick={()=>swipe("right")} style={{width:64,height:64,borderRadius:"50%",background:"#F1F5F9",border:"2px solid #4ADE80",color:"#4ADE80",fontSize:24,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>❤️</button>
          </div>
        </div>
      )}

      {/* End screen */}
      {isLast&&(
        <div style={{textAlign:"center",padding:40,background:"#FFFFFF",borderRadius:20,border:"1px solid #E2E8F0"}}>
          <div style={{fontSize:48,marginBottom:16}}>🎉</div>
          <h3 style={{margin:"0 0 8px",color:"#0F172A",fontSize:20}}>Tu as vu toutes les recettes !</h3>
          <p style={{color:"#64748B",marginBottom:24}}>{liked.length} recette{liked.length>1?"s":""} sélectionnée{liked.length>1?"s":""}</p>
          {liked.length>0&&(
            <>
              <div style={{marginBottom:20,textAlign:"left"}}>
                {liked.map((c,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"#F1F5F9",borderRadius:10,marginBottom:8}}>
                    <span style={{fontSize:20}}>{c.emoji||"🍽️"}</span>
                    <span style={{color:"#0F172A",fontSize:14,fontWeight:500}}>{c.titre}</span>
                  </div>
                ))}
              </div>
              <button onClick={importLiked} disabled={importing||done} style={importing||done?btnDisabled:btnPrimary}>
                {done?"✓ Importées dans Notion !":importing?`Import en cours… (${liked.length} recettes)`:`⬆️ Importer ${liked.length} recette${liked.length>1?"s":""} dans Notion`}
              </button>
            </>
          )}
          <button onClick={()=>{setCards([]);setCurrent(0);setLiked([]);setDone(false);setPrompt("");}} style={{marginTop:12,padding:"10px 20px",background:"transparent",border:"1px solid #334155",borderRadius:10,color:"#64748B",cursor:"pointer",fontFamily:"inherit",fontSize:14}}>
            Nouvelle recherche
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading&&cards.length===0&&!isLast&&(
        <div style={{textAlign:"center",padding:60,color:"#94A3B8"}}>
          <div style={{fontSize:48,marginBottom:12}}>✨</div>
          <p style={{margin:0,fontSize:15}}>Décris ce que tu veux cuisiner ci-dessus</p>
        </div>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App(){
  const [tab,setTab]=useState("recettes");
  const [toastMsg,setToastMsg]=useState(null);
  const toast=msg=>setToastMsg(msg);
  const tabs=[{id:"recettes",label:"Recettes",icon:"book"},{id:"planning",label:"Planning",icon:"calendar"},{id:"courses",label:"Courses",icon:"cart"},{id:"discovery",label:"✨",icon:"sparkle"}];

  return(
    <div style={{minHeight:"100vh",background:"#F8FAFC",color:"#0F172A",fontFamily:"'DM Sans', system-ui, sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap');
        *{box-sizing:border-box;}
        @keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
        ::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:#0F172A;}::-webkit-scrollbar-thumb{background:#334155;border-radius:4px;}
        select option{background:#1E293B;}
      `}</style>
      <div style={{borderBottom:"1px solid #0F172A",padding:"0 24px",background:"#F8FAFC",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:980,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"16px 0"}}>
            <span style={{fontSize:22}}>🍽️</span>
            <span style={{fontSize:17,fontWeight:800,fontFamily:"'Playfair Display', serif",background:"linear-gradient(135deg, #F8FAFC, #94A3B8)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Meal Planner</span>
          </div>
          <nav style={{display:"flex",gap:2,overflowX:"auto",WebkitOverflowScrolling:"touch",scrollbarWidth:"none",msOverflowStyle:"none",paddingBottom:2}}>
            {tabs.map(t=>(<button key={t.id} onClick={()=>setTab(t.id)} style={{display:"flex",alignItems:"center",gap:7,padding:"8px 10px",borderRadius:8,whiteSpace:"nowrap",flexShrink:0,fontSize:12,background:tab===t.id?"#C2622D":"transparent",border:"none",color:tab===t.id?"#FFFFFF":"#64748B",fontWeight:tab===t.id?700:500,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}><Icon name={t.icon} size={15}/>{t.label}</button>))}
          </nav>
        </div>
      </div>
      <div style={{maxWidth:980,margin:"0 auto",padding:"28px 24px"}}>
        {tab==="recettes"&&<RecettesTab toast={toast}/>}
        {tab==="planning"&&<PlanningTab toast={toast}/>}
        {tab==="courses"&&<CoursesTab toast={toast}/>}
        {tab==="discovery"&&<DiscoveryTab toast={toast}/>}
      </div>
      {toastMsg&&<Toast message={toastMsg} onClose={()=>setToastMsg(null)}/>}
    </div>
  );
}
