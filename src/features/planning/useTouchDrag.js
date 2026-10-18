// Glisser-déposer tactile du planning : appui long → la carte « décolle » et suit le doigt.
//
// Pourquoi des écouteurs natifs : React attache touchmove en mode passif, donc
// e.preventDefault() y est ignoré → la page défilait à la place de la carte.
// Ici, une fois le glisser lancé, on écoute window avec {passive:false} pour bloquer le défilement,
// et on fait défiler la page nous-mêmes quand le doigt approche du haut/bas de l'écran.
import { useCallback, useEffect, useRef } from "react";

const LONG_PRESS_MS=350;   // délai d'appui avant de « décoller » la carte
const MOVE_TOLERANCE=10;   // au-delà, avant le délai, c'est un défilement normal
const EDGE_TOP=90, EDGE_BOTTOM=130; // zones de défilement auto (bas : barre de navigation)
const MAX_SPEED=22;        // px par image

// L'app défile dans un conteneur interne, pas dans window : on remonte jusqu'au premier ancêtre qui défile.
function scrollerOf(node){
  for(let el=node?.parentElement;el;el=el.parentElement){
    const oy=getComputedStyle(el).overflowY;
    if((oy==="auto"||oy==="scroll")&&el.scrollHeight>el.clientHeight)return el;
  }
  return document.scrollingElement||document.documentElement;
}

export const isCoarsePointer=()=>typeof window!=="undefined"&&window.matchMedia?.("(pointer: coarse)").matches;

export function useTouchDrag({onDragStart,onOver,onDrop,onDragEnd}){
  const cb=useRef({});
  useEffect(()=>{cb.current={onDragStart,onOver,onDrop,onDragEnd};});
  const st=useRef(null);

  const zoneAt=(x,y)=>document.elementFromPoint(x,y)?.closest("[data-dropzone]")?.dataset.dropzone||null;

  const detach=useCallback(()=>{
    const s=st.current;if(!s)return;
    clearTimeout(s.timer);cancelAnimationFrame(s.raf);
    window.removeEventListener("touchmove",s.onMove);
    window.removeEventListener("touchend",s.onEnd);
    window.removeEventListener("touchcancel",s.onCancel);
    if(s.ghost)s.ghost.remove();
    if(s.dragging)cb.current.onDragEnd?.();
    st.current=null;
  },[]);

  useEffect(()=>detach,[detach]); // nettoyage si on quitte l'onglet en plein glisser

  const updateOver=s=>{
    const z=zoneAt(s.x,s.y);
    if(z!==s.over){s.over=z;cb.current.onOver?.(z);}
  };

  const autoScroll=s=>{
    const h=window.innerHeight;let v=0;
    if(s.y<EDGE_TOP)v=-MAX_SPEED*(1-s.y/EDGE_TOP);
    else if(s.y>h-EDGE_BOTTOM)v=MAX_SPEED*(1-(h-s.y)/EDGE_BOTTOM);
    if(v){s.scroller.scrollTop+=v;updateOver(s);}
    s.raf=requestAnimationFrame(()=>autoScroll(s));
  };

  const begin=s=>{
    s.dragging=true;
    s.scroller=scrollerOf(s.node);
    navigator.vibrate?.(15);
    const r=s.node.getBoundingClientRect();
    const w=Math.min(r.width,260);
    s.dx=Math.min(s.x-r.left,w-20);s.dy=s.y-r.top;
    const g=s.node.cloneNode(true);
    g.style.cssText=`position:fixed;left:${s.x-s.dx}px;top:${s.y-s.dy}px;width:${w}px;opacity:0.94;z-index:9999;pointer-events:none;background:#fff;border-radius:14px;box-shadow:0 12px 32px rgba(28,25,23,0.22);transform:scale(1.03);`;
    document.body.appendChild(g);s.ghost=g;
    cb.current.onDragStart?.(s.item);
    updateOver(s);
    s.raf=requestAnimationFrame(()=>autoScroll(s));
  };

  // À brancher sur onTouchStart de l'élément déplaçable.
  const startTouch=useCallback((e,item)=>{
    if(e.touches.length!==1)return;
    detach();
    const t=e.touches[0];
    const s={item,node:e.currentTarget,x:t.clientX,y:t.clientY,x0:t.clientX,y0:t.clientY,dragging:false,over:null};
    s.onMove=ev=>{
      const p=ev.touches[0];if(!p)return;
      s.x=p.clientX;s.y=p.clientY;
      if(!s.dragging){
        // Le doigt bouge avant l'appui long : c'est un défilement, on laisse faire le navigateur.
        if(Math.hypot(s.x-s.x0,s.y-s.y0)>MOVE_TOLERANCE)detach();
        return;
      }
      ev.preventDefault(); // possible car l'écouteur est non passif
      s.ghost.style.left=s.x-s.dx+"px";s.ghost.style.top=s.y-s.dy+"px";
      updateOver(s);
    };
    s.onEnd=ev=>{
      if(s.dragging){
        const z=zoneAt(s.x,s.y);
        // Avale le « click » synthétique qui suit le lâcher (sinon la fiche recette s'ouvre).
        const swallow=c=>{c.stopPropagation();c.preventDefault();};
        window.addEventListener("click",swallow,{capture:true,once:true});
        setTimeout(()=>window.removeEventListener("click",swallow,{capture:true}),400);
        ev.preventDefault?.();
        const item=s.item;detach();
        if(z)cb.current.onDrop?.(z,item);
      }else detach();
    };
    s.onCancel=()=>detach();
    s.timer=setTimeout(()=>begin(s),LONG_PRESS_MS);
    window.addEventListener("touchmove",s.onMove,{passive:false});
    window.addEventListener("touchend",s.onEnd,{passive:false});
    window.addEventListener("touchcancel",s.onCancel);
    st.current=s;
  },[detach]);

  return startTouch;
}
