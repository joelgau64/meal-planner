import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { PlanningTab } from "./features/planning/PlanningTab";
// Planning = écran d'ouverture, chargé tout de suite. Les autres onglets sont chargés
// à la première visite (code séparé → démarrage plus léger).
const RecettesTab=lazy(()=>import("./features/recettes/RecettesTab").then(m=>({default:m.RecettesTab})));
const CoursesTab=lazy(()=>import("./features/courses/CoursesTab").then(m=>({default:m.CoursesTab})));
const FrigoTab=lazy(()=>import("./features/frigo/FrigoTab").then(m=>({default:m.FrigoTab})));
const DiscoveryTab=lazy(()=>import("./features/discovery/DiscoveryTab").then(m=>({default:m.DiscoveryTab})));
import { errorListeners } from "./lib/errors";
import { ErrorPanel } from "./ui/ErrorPanel";
import { Icon } from "./ui/Icon";
import { Spinner, Toast } from "./ui/primitives";

export default function App(){
  const [tab,setTab]=useState("planning");
  const [frigoCookTarget,setFrigoCookTarget]=useState(null);
  const [toastMsg,setToastMsg]=useState(null);
  const [showErrorPanel,setShowErrorPanel]=useState(false);
  const [errorCount,setErrorCount]=useState(0);
  const closeToast=useCallback(()=>setToastMsg(null),[]);
  const toast=useCallback(msg=>setToastMsg(msg),[]); // référence stable → pas de re-render en cascade des onglets

  // Garder l'écran allumé dans toute l'app (Wake Lock API)
  useEffect(()=>{
    let wakeLock=null;
    let released=false;
    const acquire=async()=>{
      if(!("wakeLock" in navigator))return;
      try{
        wakeLock=await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release",()=>{wakeLock=null;});
      }catch(e){/* refusé (batterie faible, onglet caché) — silencieux */}
    };
    const onVisibility=()=>{
      if(document.visibilityState==="visible"&&!released) acquire();
    };
    acquire();
    document.addEventListener("visibilitychange",onVisibility);
    return()=>{
      released=true;
      document.removeEventListener("visibilitychange",onVisibility);
      if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null;}
    };
  },[]);

  // Surveiller les nouvelles erreurs
  useEffect(()=>{
    const fn=n=>setErrorCount(n);
    errorListeners.add(fn);
    return()=>{errorListeners.delete(fn);};
  },[]);
  const tabs=[
    {id:"planning",  label:"Planning",  icon:"calendar"},
    {id:"recettes",  label:"Recettes",  icon:"book"},
    {id:"courses",   label:"Courses",   icon:"cart"},
    {id:"frigo",     label:"Frigo",     icon:"fridge"},
    {id:"discovery", label:"Découvrir", icon:"compass"},
  ];

  const TAB_TITLES = {
    recettes:  "Mes recettes",
    planning:  "Planning",
    courses:   "Liste de courses",
    frigo:     "Mon frigo",
    discovery: "Découvrir",
  };

  return(
    <div style={{minHeight:"100vh",background:"var(--bg)",color:"var(--text)",fontFamily:"'DM Sans', system-ui, sans-serif",paddingBottom:"calc(64px + env(safe-area-inset-bottom))"}}>

      {/* ── Header ── */}
      <div className="app-header" style={{padding:"0 20px",paddingTop:"env(safe-area-inset-top)",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:980,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:56}}>
          <span className="brand" style={{fontSize:16,fontWeight:700,letterSpacing:"-0.02em",color:"var(--text)"}}>Meal Planner<span style={{color:"var(--accent)"}}>.</span></span>

          {/* Nav desktop */}
          <nav className="top-nav" style={{display:"flex",gap:2}}>
            {tabs.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)}
                aria-current={tab===t.id?"page":undefined}
                style={{display:"flex",alignItems:"center",gap:7,padding:"8px 14px",borderRadius:999,border:"none",
                  background:tab===t.id?"var(--text)":"transparent",
                  color:tab===t.id?"#FFFFFF":"var(--muted)",
                  fontWeight:600,fontSize:13,cursor:"pointer",fontFamily:"inherit",transition:"background .15s,color .15s"}}>
                <Icon name={t.icon} size={15}/>{t.label}
              </button>
            ))}
          </nav>

          {/* Titre page courante sur mobile */}
          <span className="app-header-title" style={{display:"none",fontSize:24,fontWeight:700,letterSpacing:"-0.025em",color:"var(--text)"}}>
            {TAB_TITLES[tab]}
          </span>

          {/* Bouton erreurs */}
          {errorCount>0&&(
            <button onClick={()=>setShowErrorPanel(true)}
              style={{padding:"4px 8px",background:"#FEF2F2",border:"1px solid transparent",borderRadius:10,color:"var(--danger)",fontSize:11,cursor:"pointer",fontWeight:700}}>
              ⚠️ {errorCount}
            </button>
          )}
        </div>
      </div>

      {/* ── Contenu ── */}
      <div className="app-content tab-content" key={tab} style={{maxWidth:980,margin:"0 auto",padding:"20px 20px",paddingBottom:"calc(20px + env(safe-area-inset-bottom))"}}>
        <Suspense fallback={<Spinner/>}>
        {tab==="recettes"  &&<RecettesTab  toast={toast}/>}
        {tab==="planning"  &&<PlanningTab  toast={toast}/>}
        {tab==="courses"   &&<CoursesTab   toast={toast}/>}
        {tab==="frigo"     &&<FrigoTab     toast={toast} onCookWith={(item)=>{setFrigoCookTarget(item);setTab("discovery");}}/>}
        {tab==="discovery" &&<DiscoveryTab toast={toast} frigoCookTarget={frigoCookTarget} clearFrigoTarget={()=>setFrigoCookTarget(null)}/>}
        </Suspense>
      </div>

      {/* ── Bottom tab bar (mobile only) ── */}
      <nav className="bottom-nav" style={{
        position:"fixed",bottom:0,left:0,right:0,zIndex:200,
        background:"rgba(255,255,255,0.88)",backdropFilter:"saturate(180%) blur(16px)",WebkitBackdropFilter:"saturate(180%) blur(16px)",
        borderTop:"1px solid rgba(28,25,23,0.06)",
        display:"flex",
        paddingBottom:"env(safe-area-inset-bottom)",
      }}>
        {tabs.map(t=>{
          const active=tab===t.id;
          return(
            <button key={t.id} onClick={()=>setTab(t.id)} aria-label={t.label} aria-current={active?"page":undefined} style={{
              flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
              gap:4,padding:"10px 4px 8px",border:"none",background:"transparent",
              color:active?"var(--accent)":"var(--subtle)",cursor:"pointer",fontFamily:"inherit",
              transition:"color 0.15s",
            }}>
              <span style={{display:"flex",padding:"4px 16px",borderRadius:999,background:active?"var(--accent-soft)":"transparent",transition:"background .2s"}}><Icon name={t.icon} size={21}/></span>
              <span style={{fontSize:11,fontWeight:active?700:500,color:active?"var(--text)":"var(--subtle)"}}>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {toastMsg&&<Toast key={toastMsg} message={toastMsg} onClose={closeToast}/>}
      {showErrorPanel&&<ErrorPanel onClose={()=>{setShowErrorPanel(false);setErrorCount(0);}}/>}
    </div>
  );
}
