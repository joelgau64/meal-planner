import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

// ── UI Primitives ─────────────────────────────────────────────────────────────
// Indicateur de chargement unique de l'app : anneau fin, segment terracotta.
// <Spinner/> = bloc centré (chargement d'un écran) ; <InlineSpinner/> = dans un bouton,
// prend la couleur du texte du bouton.
export function Spinner({label="Chargement…"}){
  return(<div role="status" aria-live="polite" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:14,padding:"56px 20px",color:"var(--muted)"}}><span className="spinner" style={{width:28,height:28}}/>{label&&<span style={{fontSize:14}}>{label}</span>}</div>);
}
export function InlineSpinner({size=14}){
  return <span className="spinner inline" aria-hidden="true" style={{width:size,height:size,borderWidth:2}}/>;
}
// Un message commençant par ❌, ⚠️ ou "Erreur" s'affiche en rouge, sans coche verte, et reste plus longtemps.
export function Toast({message,onClose}){
  const isError=/^(❌|⚠️|Erreur|Échec|Impossible)/i.test(String(message));
  useEffect(()=>{const t=setTimeout(onClose,isError?6000:3000);return()=>clearTimeout(t);},[onClose,message,isError]);
  return(<div role="status" aria-live="polite" onClick={onClose} style={{position:"fixed",bottom:"calc(76px + env(safe-area-inset-bottom))",left:"50%",transform:"translateX(-50%)",background:isError?"#7F1D1D":"var(--text)",color:"#FFFFFF",padding:"12px 18px",borderRadius:14,fontSize:13,fontWeight:500,zIndex:1000,boxShadow:"0 8px 32px rgba(0,0,0,0.25)",display:"flex",alignItems:"center",gap:10,maxWidth:"min(92vw,480px)",lineHeight:1.4}}>{!isError&&<span style={{color:"#4ADE80",flexShrink:0}}><Icon name="check" size={16}/></span>}{message}</div>);
}
export function Modal({title,onClose,children,wide,full}){
  const closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{
    const onKey=e=>{if(e.key==="Escape")closeRef.current?.();};
    const prev=document.body.style.overflow;
    document.body.style.overflow="hidden"; // le fond ne défile plus sous la modale
    document.addEventListener("keydown",onKey);
    return()=>{document.body.style.overflow=prev;document.removeEventListener("keydown",onKey);};
  },[]);
  return(
    <div role="dialog" aria-modal="true" aria-label={typeof title==="string"?title:undefined} style={{position:"fixed",inset:0,background:"rgba(28,25,23,0.4)",backdropFilter:"blur(2px)",WebkitBackdropFilter:"blur(2px)",zIndex:500,display:"flex",alignItems:"flex-end",justifyContent:"center",overscrollBehavior:"contain"}} onClick={onClose}>
      <div className="modal-inner" onClick={e=>e.stopPropagation()}
        style={{background:"var(--surface)",borderRadius:"24px 24px 0 0",width:"100%",boxShadow:"0 -8px 40px rgba(28,25,23,0.12)",maxWidth:full?900:wide?680:560,maxHeight:"92vh",overflow:"auto",paddingBottom:"env(safe-area-inset-bottom)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 20px",borderBottom:"1px solid var(--surface-2)",position:"sticky",top:0,background:"var(--surface)",zIndex:10}}>
          <div style={{width:40,height:4,borderRadius:2,background:"var(--border)",margin:"0 auto 0 auto",position:"absolute",left:"50%",transform:"translateX(-50%)",top:8}}/>
          <h3 style={{margin:0,fontSize:17,fontWeight:700,color:"var(--text)",letterSpacing:"-0.02em"}}>{title}</h3>
          <button onClick={onClose} aria-label="Fermer" style={{background:"var(--surface-2)",border:"none",color:"var(--muted)",cursor:"pointer",padding:10,borderRadius:10,display:"flex"}}><Icon name="close" size={18}/></button>
        </div>
        <div style={{padding:"16px 20px"}}>{children}</div>
      </div>
    </div>
  );
}
export function Field({label,children}){
  return(<div style={{marginBottom:16}}><label style={{display:"block",fontSize:13,fontWeight:600,color:"var(--text-2)",marginBottom:6}}>{label}</label>{children}</div>);
}
export const inputStyle={width:"100%",background:"var(--surface)",border:"1px solid #E2DED9",borderRadius:12,color:"var(--text)",padding:"12px 14px",fontSize:14,boxSizing:"border-box",outline:"none",fontFamily:"inherit"};
export const btnPrimary={padding:"14px",background:"var(--accent)",border:"none",borderRadius:14,color:"#fff",fontWeight:600,fontSize:15,cursor:"pointer",width:"100%",marginTop:8,boxShadow:"0 1px 2px rgba(194,98,45,0.3)"};
export const btnDisabled={...btnPrimary,background:"var(--surface-2)",color:"var(--muted)",cursor:"default"};

// Vignette recette : hauteur fixe (grille alignée). Sans photo ou photo cassée :
// aplat teinté + initiale du plat, plutôt qu'un trou.
export const THUMB_TINTS=[["#FBEDE4","#C2622D"],["#EEF2E6","#4D6B2F"],["#F3ECE3","#8A5A2B"],["#E9EEF1","#3F5C6E"],["#F5E9EC","#9B3D52"]];
export function RecipeThumb({recette,onClick,height=128}){
  const [broken,setBroken]=useState(false);
  const nom=recette.nom||"?";
  const [bg,fg]=THUMB_TINTS[[...nom].reduce((a,c)=>a+c.charCodeAt(0),0)%THUMB_TINTS.length];
  if(recette.photo&&!broken)return(<img src={recette.photo} alt="" loading="lazy" decoding="async" onClick={onClick} onError={()=>setBroken(true)} style={{width:"100%",height,objectFit:"cover",display:"block",background:bg}}/>);
  return(<div onClick={onClick} aria-hidden="true" style={{height,background:bg,color:fg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:Math.round(height*0.42),fontWeight:700,letterSpacing:"-0.04em",opacity:0.9}}>{nom.trim().charAt(0).toUpperCase()}</div>);
}
export function ScoreBadge({score}){
  if(score===null||score===undefined)return null;
  const color=score>0?"#4ADE80":score<0?"#F87171":"#78716C";
  return <span style={{fontSize:11,fontWeight:700,color,background:`${color}22`,padding:"2px 7px",borderRadius:10}}>{score>0?`+${score}`:score}</span>;
}
export function DaysSince({date}){
  if(!date)return <span style={{fontSize:11,color:"var(--muted)"}}>jamais cuisiné</span>;
  const days=Math.floor((new Date()-new Date(date))/86400000);
  const color=days>30?"#F59E0B":days>14?"#A8A29E":"#4ADE80";
  return <span style={{fontSize:11,color}}>il y a {days}j</span>;
}
