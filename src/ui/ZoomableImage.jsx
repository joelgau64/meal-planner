// Visionneuse de photo intégrée : pincer / molette / double-tap pour zoomer, glisser pour se déplacer.
// Le transform est appliqué directement au DOM (pas de re-render à chaque mouvement de doigt).
import { useCallback, useEffect, useRef, useState } from "react";

const MIN=1, MAX=6, STEP=1.6, DOUBLE_TAP_MS=300;

export function ZoomableImage({src,alt="",height="clamp(220px, 42vh, 420px)"}){
  const boxRef=useRef(null);
  const imgRef=useRef(null);
  const t=useRef({s:1,x:0,y:0});
  const pointers=useRef(new Map());
  const gesture=useRef(null);
  const lastTap=useRef({time:0,x:0,y:0});
  const [zoomed,setZoomed]=useState(false);

  // Applique (et borne) le transform : l'image ne peut pas sortir du cadre.
  const apply=useCallback((s,x,y,animate=false)=>{
    const box=boxRef.current,img=imgRef.current;
    if(!box||!img)return;
    s=Math.min(MAX,Math.max(MIN,s));
    // Bornes calculées sur la zone réellement occupée par la photo (hors bandes noires du "contain").
    const W=box.clientWidth,H=box.clientHeight,nw=img.naturalWidth||W,nh=img.naturalHeight||H;
    const fit=Math.min(W/nw,H/nh),dw=nw*fit*s,dh=nh*fit*s;
    const mx=Math.max(0,(dw-W)/2), my=Math.max(0,(dh-H)/2);
    x=Math.min(mx,Math.max(-mx,x)); y=Math.min(my,Math.max(-my,y));
    t.current={s,x,y};
    img.style.transition=animate?"transform .2s ease":"none";
    img.style.transform=`translate(${x}px,${y}px) scale(${s})`;
    setZoomed(s>1.01);
  },[]);

  // Point relatif au centre du cadre (repère du transform).
  const rel=useCallback((cx,cy)=>{
    const r=boxRef.current.getBoundingClientRect();
    return{x:cx-r.left-r.width/2,y:cy-r.top-r.height/2};
  },[]);

  // Zoome vers s2 en gardant fixe le point p (sous le doigt / la souris).
  const zoomAt=useCallback((s2,p,animate)=>{
    const {s,x,y}=t.current;
    s2=Math.min(MAX,Math.max(MIN,s2));
    apply(s2,p.x-(p.x-x)*s2/s,p.y-(p.y-y)*s2/s,animate);
  },[apply]);

  useEffect(()=>{apply(1,0,0);},[src,apply]);

  // Molette (desktop) — écouteur non passif pour bloquer le scroll de la fiche.
  useEffect(()=>{
    const box=boxRef.current;if(!box)return;
    const onWheel=e=>{e.preventDefault();zoomAt(t.current.s*Math.exp(-e.deltaY*0.0015),rel(e.clientX,e.clientY));};
    box.addEventListener("wheel",onWheel,{passive:false});
    return()=>box.removeEventListener("wheel",onWheel);
  },[zoomAt,rel]);

  const startGesture=()=>{
    const pts=[...pointers.current.values()];
    const {s,x,y}=t.current;
    if(pts.length>=2){
      const [a,b]=pts;
      gesture.current={type:"pinch",d0:Math.hypot(a.x-b.x,a.y-b.y)||1,mid0:rel((a.x+b.x)/2,(a.y+b.y)/2),s0:s,x0:x,y0:y};
    }else if(pts.length===1){
      gesture.current={type:"pan",p0:pts[0],x0:x,y0:y};
    }else gesture.current=null;
  };

  const onPointerDown=e=>{
    boxRef.current.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.current.size===1){
      const now=Date.now(),lt=lastTap.current;
      if(now-lt.time<DOUBLE_TAP_MS&&Math.hypot(e.clientX-lt.x,e.clientY-lt.y)<30){
        // Double-tap : zoom x2.5 sur le point touché, ou retour à la vue entière.
        if(t.current.s>1.01)apply(1,0,0,true);else zoomAt(2.5,rel(e.clientX,e.clientY),true);
        lastTap.current={time:0,x:0,y:0};
      }else lastTap.current={time:now,x:e.clientX,y:e.clientY};
    }
    startGesture();
  };

  const onPointerMove=e=>{
    if(!pointers.current.has(e.pointerId))return;
    pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const g=gesture.current;if(!g)return;
    if(g.type==="pinch"){
      const [a,b]=[...pointers.current.values()];
      const s2=Math.min(MAX,Math.max(MIN,g.s0*Math.hypot(a.x-b.x,a.y-b.y)/g.d0));
      const mid=rel((a.x+b.x)/2,(a.y+b.y)/2);
      apply(s2,mid.x-(g.mid0.x-g.x0)*s2/g.s0,mid.y-(g.mid0.y-g.y0)*s2/g.s0);
    }else if(g.type==="pan"&&t.current.s>1.01){
      apply(t.current.s,g.x0+e.clientX-g.p0.x,g.y0+e.clientY-g.p0.y);
    }
  };

  const onPointerUp=e=>{
    pointers.current.delete(e.pointerId);
    startGesture(); // un doigt restant reprend le déplacement sans saut
  };

  const btn={width:34,height:34,borderRadius:999,border:"none",background:"rgba(28,25,23,0.72)",color:"#fff",fontSize:18,fontWeight:600,lineHeight:1,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"};
  const center=()=>({x:0,y:0});

  return(
    <div ref={boxRef}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      style={{position:"relative",height,borderRadius:14,overflow:"hidden",background:"#1C1917",touchAction:"none",userSelect:"none",WebkitUserSelect:"none",cursor:zoomed?"grab":"zoom-in"}}>
      <img ref={imgRef} src={src} alt={alt} draggable={false}
        style={{width:"100%",height:"100%",objectFit:"contain",display:"block",transformOrigin:"center center",willChange:"transform",pointerEvents:"none"}}/>
      {!zoomed&&<span style={{position:"absolute",top:8,left:8,background:"rgba(28,25,23,0.72)",color:"#fff",fontSize:11,fontWeight:600,padding:"3px 8px",borderRadius:999,pointerEvents:"none"}}>Pince ou double-tape pour zoomer</span>}
      <div style={{position:"absolute",right:8,bottom:8,display:"flex",gap:6}} onPointerDown={e=>e.stopPropagation()}>
        {zoomed&&<button type="button" style={{...btn,width:"auto",padding:"0 10px",fontSize:12}} onClick={()=>apply(1,0,0,true)} aria-label="Voir la photo entière">Ajuster</button>}
        <button type="button" style={btn} onClick={()=>zoomAt(t.current.s/STEP,center(),true)} aria-label="Dézoomer" disabled={!zoomed}>−</button>
        <button type="button" style={btn} onClick={()=>zoomAt(t.current.s*STEP,center(),true)} aria-label="Zoomer">+</button>
      </div>
    </div>
  );
}
