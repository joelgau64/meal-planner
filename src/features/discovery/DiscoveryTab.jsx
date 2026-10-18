import { useEffect, useRef, useState } from "react";
import { RecipeDetailModal } from "../recettes/RecipeDetailModal";
import { peekCached } from "../../lib/cache";
import { loadWithCache } from "../../lib/data";
import { localISO } from "../../lib/dates";
import { lierArticleARecette, delierArticle, repasPourRecette } from "../../lib/liens";
import { fmtJour, suggererRecettes } from "../../lib/frigo";
import { RECIPE_JSON_PROMPT, extractRecipe, withTimeout } from "../../lib/claude";
import { DB_RECETTES } from "../../lib/constants";
import { logError } from "../../lib/errors";
import { nNum, nSel, nText, nTitle, nUrl, notionCreate } from "../../lib/notion";
import { Icon } from "../../ui/Icon";

// ── Discovery Tab ─────────────────────────────────────────────────────────────
export function DiscoveryTab({toast,frigoCookTarget,clearFrigoTarget}){
  const [prompt,setPrompt]=useState("");
  const [cards,setCards]=useState([]);
  const [current,setCurrent]=useState(0);
  const [loading,setLoading]=useState(false);
  const [done,setDone]=useState(false);
  const [liked,setLiked]=useState([]);
  const [importStatus,setImportStatus]=useState({}); // {cardTitre: 'loading'|'done'|'error'}
  const [dragX,setDragX]=useState(0);
  const [dragging,setDragging]=useState(false);
  const [detail,setDetail]=useState(null); // {card,loading,data,error}
  const [localMatches,setLocalMatches]=useState([]); // recettes perso correspondant au frigo
  const [frigoContext,setFrigoContext]=useState(null); // {article,forme} d'où vient la recherche
  const [selectedLocal,setSelectedLocal]=useState(null); // recette perso ouverte en détail
  const [planning,setPlanning]=useState(()=>peekCached("planning")||[]);
  const [liant,setLiant]=useState(null);
  const [toutesLocales,setToutesLocales]=useState(false); // id de la recette en cours de liaison
  useEffect(()=>{if(frigoCookTarget)loadWithCache("planning",{onCached:setPlanning,onFresh:setPlanning,onError:e=>logError("discoveryPlanningLoad",e)});},[frigoCookTarget]);

  // Lie l'article du frigo d'où vient la recherche à une de ses recettes (comme dans la fiche Frigo).
  const lier=async r=>{
    if(!frigoContext?.id)return;
    setLiant(r.id);
    try{
      const {entry,cree}=await lierArticleARecette(frigoContext.id,r,localISO(new Date()));
      setPlanning(peekCached("planning")||[]);
      setFrigoContext(c=>({...c,planningId:entry.id}));
      const apres=entry.date&&!entry.queue&&frigoContext.peremption&&entry.date>frigoContext.peremption;
      toast(apres?`⚠️ "${r.nom}" lié, mais prévu le ${fmtJour(entry.date)} : ${frigoContext.article} périmé le ${fmtJour(frigoContext.peremption)}`
        :`🔗 "${r.nom}" lié à ${frigoContext.article}${cree?" · ajouté à la file d'attente":entry.queue||!entry.date?" · déjà en file":" · prévu "+fmtJour(entry.date)}`);
    }catch(e){logError("discoveryLier",e);toast("❌ Lien impossible : "+e.message);}
    setLiant(null);
  };
  const delier=async()=>{
    try{await delierArticle(frigoContext.id);setFrigoContext(c=>({...c,planningId:""}));toast("Lien retiré");}
    catch(e){logError("discoveryDelier",e);toast("❌ "+e.message);}
  };
  const startX=useRef(null);
  const movedRef=useRef(false);
  const cardRef=useRef(null);
  const EMOJIS=["🍽️","🥗","🍲","🥘","🍜","🥩","🐟","🥦","🍋","🫐"];
  const decodeEntities=(s)=>{
    if(!s)return s;
    const t=document.createElement("textarea");t.innerHTML=s;return t.value;
  };

  const inputStyle={width:"100%",padding:"12px 16px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,color:"var(--text)",fontSize:15,fontFamily:"inherit",outline:"none"};
  const btnP={padding:"12px 24px",background:"#C2622D",border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer",fontFamily:"inherit",width:"100%"};
  const btnD={...btnP,opacity:0.4,cursor:"not-allowed"};

  async function search(queryOverride){
    // queryOverride peut être un event (onClick) — n'accepter qu'une string.
    const override=(typeof queryOverride==="string")?queryOverride:"";
    const q=(override||prompt).trim();
    if(!q)return;
    setLoading(true);setCards([]);setCurrent(0);setLiked([]);setDone(false);
    try{
      const res=await fetch("/api/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:`recette ${q}`})});
      const data=await res.json();
      const arr=(data.results||[]).slice(0,9).map((r,i)=>({
        titre:decodeEntities((r.titre||"").replace(/[-|]\s*(Marmiton|CuisineAZ|750g|Chef Simon|Cuisine AZ|Recette)\s*$/gi,"").trim()),
        description:decodeEntities(r.description),url:r.url,source:r.source,origin:r._origin||"ai",
        categorie:r.categorie||"Dîner",temps:r.temps||null,difficulte:r.difficulte||null,
        emoji:r.emoji||EMOJIS[i%EMOJIS.length],
        image:r.image||null,spoonacularId:r.spoonacularId||null,note:r.note??null,noteCount:r.noteCount??null,
      }));
      // Affichage progressif simulant le streaming
      for(let i=0;i<arr.length;i++){
        await new Promise(r=>setTimeout(r,150));
        setCards(prev=>[...prev,arr[i]]);
      }
    }catch(e){console.error(e);}
    setLoading(false);
  }

  // Déclenché quand on arrive depuis le Frigo ("Cuisiner avec")
  // CASCADE : 1) tes recettes qui matchent la protéine  2) sinon/en complément, Découverte web
  useEffect(()=>{
    if(!frigoCookTarget)return;
    const forme=(frigoCookTarget.forme&&frigoCookTarget.forme!=="Autre")?frigoCookTarget.forme.toLowerCase():"";
    const q=`${forme} ${frigoCookTarget.article}`.trim();
    setPrompt(q);
    setFrigoContext({id:frigoCookTarget.id,article:frigoCookTarget.article,forme:frigoCookTarget.forme,peremption:frigoCookTarget.peremption,planningId:frigoCookTarget.planningId||""});

    // 1) Chercher dans TES recettes (cache) : match sur nom + ingrédients
    const mesRecettes=peekCached("recettes")||[]; // peek : getCached renvoyait null après 2 min → aucune suggestion
    // Même moteur que les suggestions du Frigo : pluriels, équivalences (Knack → Francfort/hot-dog,
    // gigot → agneau…), l'animal pèse plus que le morceau ; la forme sert de départage.
    const matches=suggererRecettes(`${frigoCookTarget.article} ${forme}`,mesRecettes,50).map(x=>x.recette);
    setLocalMatches(matches);

    // 2) Lancer AUSSI la recherche web en fallback/complément.
    //    Si tu as des recettes perso, elles s'affichent en haut ; sinon la Découverte prend le relais.
    search(q);
    clearFrigoTarget&&clearFrigoTarget();
    // eslint-disable-next-line
  },[frigoCookTarget]);

  // Import en arrière-plan : Spoonacular (0 crédit) → Claude fallback
  function importCardBg(card){
    setImportStatus(s=>({...s,[card.titre]:"loading"}));

    const doImport=(recipe)=>{
      if(!recipe?.nom){
        logError("importCardBg",new Error("Recette invalide"),{card:card.titre});
        setImportStatus(s=>({...s,[card.titre]:"error"}));return;
      }
      notionCreate(DB_RECETTES,{
        "Nom":nTitle(recipe.nom),"Catégorie":nSel(recipe.categorie||card.categorie),
        "Temps de préparation":nNum(recipe.temps||card.temps),"Portions":nNum(recipe.portions||4),
        "Ingrédients":nText(recipe.ingredients||""),"Instructions":nText(recipe.instructions||""),
        "Note":nSel(recipe.note||""),"Likes":nNum(0),"Dislikes":nNum(0),"Fois cuisinée":nNum(0),
        ...((card.url&&card.url.startsWith("http"))?{"Source":nUrl(card.url)}:{}),
        ...((recipe.photo||recipe.image||card.image)?{"Photo":nUrl(recipe.photo||recipe.image||card.image)}:{}),
      }).then(r=>{
        if(!r||r.object==="error"){
          logError("importCardBg",new Error(r?.message||"Échec de l'enregistrement Notion"),{card:card.titre});
          setImportStatus(s=>({...s,[card.titre]:"error"}));
          toast("\""+card.titre+"\" — échec de l'enregistrement ✕");
          return;
        }
        setImportStatus(s=>({...s,[card.titre]:r.object==="skip"?"skip":"done"}));
        const page=r.object==="skip"?r.existing:r;
        if(frigoContext&&page?.id)setLocalMatches(m=>m.some(x=>x.id===page.id)?m:[{id:page.id,nom:recipe.nom,portions:recipe.portions||4,temps:recipe.temps||card.temps,nouvelle:true},...m]);
        toast(r.object==="skip"?"\""+card.titre+"\" déjà dans vos recettes":"\""+card.titre+"\" ajoutée ✓");
      }).catch(e=>{logError("importCardBg",e,{card:card.titre});setImportStatus(s=>({...s,[card.titre]:"error"}));toast("\""+card.titre+"\" — échec de l'enregistrement ✕");});
    };

    // Spoonacular : recette complète sans Claude
    if(card.spoonacularId){
      fetch("/api/spoonacular-recipe?id="+card.spoonacularId)
        .then(r=>r.json())
        .then(recipe=>{ if(recipe?.nom) doImport(recipe); else claudeFallback(); })
        .catch(()=>claudeFallback());
    } else { claudeFallback(); }

    function claudeFallback(){
      const fallbackPrompt=card.url?null:`Génère une recette pour: "${card.titre}". Description: ${card.description}. Ingrédients un par ligne.\n\n${RECIPE_JSON_PROMPT}`;
      withTimeout(extractRecipe(card.url,fallbackPrompt),25000,"Extraction trop longue")
        .then(recipe=>{
          if(recipe?.nom){ doImport(recipe); return; }
          // Extraction échouée mais l'utilisateur a liké : on enregistre au minimum la carte
          // (titre, description, lien) pour ne jamais perdre le like.
          doImport({
            nom:card.titre,
            categorie:card.categorie||"Dîner",
            temps:card.temps||null,
            portions:4,
            ingredients:"",
            instructions:card.description?`(Recette à compléter)\n\n${card.description}`:"(Recette à compléter — voir la source)",
            image:card.image||null,
          });
        })
        .catch(e=>{
          logError("importCardBg",e,{card:card.titre});
          // Même en cas de timeout, on sauvegarde la version minimale plutôt que de perdre le like
          doImport({
            nom:card.titre,categorie:card.categorie||"Dîner",temps:card.temps||null,portions:4,
            ingredients:"",instructions:card.description?`(Recette à compléter)\n\n${card.description}`:"(Recette à compléter — voir la source)",
            image:card.image||null,
          });
        });
    }
  }


  // Voir la fiche complète d'une carte, sans l'enregistrer dans Notion
  function openDetail(c){
    setDetail({card:c,loading:true,data:null,error:false});
    const finish=(data)=>setDetail(d=>(d&&d.card===c?{card:c,loading:false,data,error:!data?.nom&&!data?.ingredients}:d));
    const fallback=()=>{
      const fallbackPrompt=c.url?null:`Génère une recette pour: "${c.titre}". Description: ${c.description}. Ingrédients un par ligne.\n\n${RECIPE_JSON_PROMPT}`;
      extractRecipe(c.url,fallbackPrompt)
        .then(finish)
        .catch(e=>{logError("openDetail",e,{card:c.titre});setDetail(d=>(d&&d.card===c?{card:c,loading:false,data:null,error:true}:d));});
    };
    if(c.spoonacularId){
      fetch("/api/spoonacular-recipe?id="+c.spoonacularId).then(r=>r.json())
        .then(recipe=>{ if(recipe?.nom) finish(recipe); else fallback(); })
        .catch(fallback);
    } else fallback();
  }

  // Passer à la carte suivante/précédente sans enregistrer de décision (like/skip)
  function goTo(delta){
    setCurrent(c=>Math.max(0,Math.min(cards.length,c+delta)));
    setDragX(0);
  }

  function swipe(dir){
    if(current>=cards.length)return;
    const card=cards[current];
    if(dir==="right"){
      setLiked(l=>[...l,card]);
      importCardBg(card); // non-bloquant
    }
    setCurrent(c=>c+1);setDragX(0);
  }

    function onPointerDown(e){startX.current=e.clientX??e.touches?.[0]?.clientX;movedRef.current=false;setDragging(true);}
  function onPointerMove(e){
    if(!dragging||startX.current==null)return;
    const dx=(e.clientX??e.touches?.[0]?.clientX)-startX.current;
    if(Math.abs(dx)>8)movedRef.current=true;
    setDragX(dx);
  }
  function onPointerUp(){
    if(Math.abs(dragX)>80)swipe(dragX>0?"right":"left");
    else setDragX(0);
    setDragging(false);startX.current=null;
  }
  function onCardClick(){
    if(!movedRef.current&&card)openDetail(card);
  }

  const card=cards[current];
  const isLast=current>=cards.length&&cards.length>0;
  const rotation=dragX/20;
  const likeOpacity=Math.min(1,dragX/60);
  const skipOpacity=Math.min(1,-dragX/60);

  return(
    <div style={{maxWidth:540,margin:"0 auto",paddingTop:16}}>
      {/* Prompt */}
      <div style={{marginBottom:24}}>
        <p style={{color:"var(--muted)",fontSize:14,marginBottom:12,marginTop:0}}>Décris ce que tu veux cuisiner — occasion, contraintes, saison, nombre de repas…</p>
        <textarea value={prompt} onChange={e=>setPrompt(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();search();}}}
          placeholder="Ex: 5 repas légers pour une semaine de canicule, pas de viande rouge"
          rows={3} style={{...inputStyle,resize:"vertical",lineHeight:1.5}}/>
        <button onClick={()=>search()} disabled={loading||!prompt.trim()} style={{...(loading||!prompt.trim()?btnD:btnP),marginTop:10}}>
          {loading?"Recherche en cours… ("+cards.length+" trouvées)":"Trouver des recettes"}
        </button>
        {cards.length>0&&!loading&&(
          <p style={{textAlign:"center",fontSize:12,color:"var(--subtle)",margin:"8px 0 0"}}>
            {cards.length} recette{cards.length>1?"s":""} trouvée{cards.length>1?"s":""} · {current} vue{current>1?"s":""}
          </p>
        )}
      </div>

      {/* CASCADE : tes recettes qui utilisent cet ingrédient (priorité sur la Découverte web) */}
      {frigoContext&&localMatches.length>0&&(
        <div className="card" style={{marginBottom:20,padding:"16px"}}>
          <div style={{fontSize:13,fontWeight:700,color:"var(--success)",marginBottom:4}}>
            Tes recettes avec {frigoContext.article}{frigoContext.forme&&frigoContext.forme!=="Autre"?` (${frigoContext.forme.toLowerCase()})`:""}
          </div>
          <p style={{fontSize:12,color:"var(--success)",margin:"0 0 10px"}}>Tu sais déjà faire {localMatches.length===1?"ce plat":"ces plats"} — pas besoin de chercher ailleurs.</p>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {(()=>{const today=localISO(new Date());
              // Repas déjà au planning / en file d'abord : ce sont les liens les plus pertinents.
              return localMatches.map(r=>({r,prevu:repasPourRecette(r,planning,today)}))
                .sort((a,b)=>(b.prevu?1:0)-(a.prevu?1:0)).slice(0,toutesLocales?undefined:6);})().map(({r,prevu})=>{
              const lie=planning.find(p=>p.id===frigoContext.planningId);
              const estLiee=!!lie&&(lie.recette_id===r.id||(lie.recette||lie.repas)===r.nom);
              return(
              <div key={r.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 8px 8px 12px",background:estLiee?"var(--accent-soft)":"var(--bg)",borderRadius:12}}>
                <button onClick={()=>setSelectedLocal(r)} style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",alignItems:"flex-start",gap:2,background:"none",border:"none",cursor:"pointer",textAlign:"left",padding:0,fontFamily:"inherit"}}>
                  <span style={{fontSize:14,fontWeight:600,color:"var(--text)"}}>{r.nom}{r.nouvelle&&<span style={{fontSize:11,fontWeight:600,color:"var(--success)"}}> · ajoutée</span>}</span>
                  <span style={{fontSize:11,color:"var(--subtle)"}}>{prevu&&<b style={{color:"var(--accent)"}}>{prevu.queue||!prevu.date?"En file":"Prévu "+fmtJour(prevu.date)}{r.temps||(!r.derniere_cuisson&&!r.nouvelle)?" · ":""}</b>}{r.temps?`${r.temps} min`:""}{!r.derniere_cuisson&&!r.nouvelle?(r.temps?" · ":"")+"jamais cuisinée":""}</span>
                </button>
                {frigoContext.id&&(estLiee
                  ?<button onClick={delier} style={{border:"none",borderRadius:999,padding:"7px 12px",fontSize:12,fontWeight:700,background:"var(--accent)",color:"#fff",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>✓ Liée</button>
                  :<button onClick={()=>lier(r)} disabled={!!liant} style={{border:"1px solid var(--accent)",borderRadius:999,padding:"6px 12px",fontSize:12,fontWeight:700,background:"transparent",color:"var(--accent)",cursor:liant?"wait":"pointer",fontFamily:"inherit",whiteSpace:"nowrap",opacity:liant&&liant!==r.id?0.5:1}}>{liant===r.id?"…":"🔗 Lier"}</button>)}
              </div>);
            })}
          </div>
          {localMatches.length>6&&<button onClick={()=>setToutesLocales(t=>!t)} style={{background:"none",border:"none",color:"var(--accent)",fontSize:12,fontWeight:600,cursor:"pointer",padding:"8px 2px 0",fontFamily:"inherit"}}>{toutesLocales?"Réduire":`Voir les ${localMatches.length-6} autres`}</button>}
          {(()=>{const lie=planning.find(p=>p.id===frigoContext.planningId);if(!lie)return null;
            const apres=!lie.queue&&lie.date&&frigoContext.peremption&&lie.date>frigoContext.peremption;
            return <p style={{fontSize:12,fontWeight:600,margin:"10px 0 0",color:apres?"#DC2626":"var(--text-2)"}}>
              {apres?"⚠️ ":"🔗 "}{frigoContext.article} → {lie.recette||lie.repas}{lie.queue||!lie.date?" · en file d'attente":" · prévu "+fmtJour(lie.date)}
              {apres&&<span style={{fontWeight:400}}> — après la péremption ({fmtJour(frigoContext.peremption)})</span>}
            </p>;})()}
          <p style={{fontSize:11,color:"var(--subtle)",margin:"10px 0 0",textAlign:"center"}}>↓ ou découvre de nouvelles idées ci-dessous</p>
        </div>
      )}
      {frigoContext&&localMatches.length===0&&!loading&&(
        <div style={{marginBottom:16,background:"var(--accent-soft)",border:"1px solid transparent",borderRadius:14,padding:"12px 14px",fontSize:13,color:"var(--accent)"}}>
          Aucune recette perso avec {frigoContext.article} — voici des idées à découvrir.
        </div>
      )}

      {/* Skeleton pendant chargement initial */}
      {loading&&cards.length===0&&(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {[300,200,250].map((w,i)=><div key={i} className="sk" style={{height:20,width:w}}/>)}
          <div className="sk" style={{height:360,borderRadius:24,marginTop:8}}/>
        </div>
      )}

      {/* Swipe */}
      {cards.length>0&&!isLast&&card&&(
        <div style={{position:"relative",height:440}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{color:"var(--muted)",fontSize:13}}>{current+1} / {cards.length}</span>
            <div style={{display:"flex",gap:4}}>{cards.map((_,i)=>(
              <div key={i} style={{width:18,height:3,borderRadius:2,background:i<current?"var(--accent)":i===current?"var(--text)":"var(--border)"}}/>
            ))}</div>
            <span style={{color:"var(--accent)",fontSize:13,fontWeight:600}}>♥ {liked.length}</span>
          </div>

          {current+1<cards.length&&(
            <div style={{position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",width:"94%",height:420,background:"var(--bg)",borderRadius:24,border:"1px solid var(--border)"}}/>
          )}

          <div ref={cardRef}
            onMouseDown={onPointerDown} onMouseMove={onPointerMove} onMouseUp={onPointerUp} onMouseLeave={onPointerUp}
            onTouchStart={onPointerDown} onTouchMove={onPointerMove} onTouchEnd={onPointerUp}
            onClick={onCardClick}
            style={{position:"absolute",top:0,left:0,right:0,height:420,
              background:"var(--surface)",border:"none",borderRadius:24,padding:20,
              transform:"translateX("+dragX+"px) rotate("+rotation+"deg)",
              transition:dragging?"none":"transform 0.3s ease",
              cursor:"grab",userSelect:"none",touchAction:"none",
              boxShadow:"0 12px 40px rgba(28,25,23,0.10),0 0 0 1px rgba(28,25,23,0.05)",
              display:"flex",flexDirection:"column",justifyContent:"space-between"
            }}>
            {dragX>20&&<div style={{position:"absolute",top:20,right:20,padding:"6px 14px",border:"2px solid #16A34A",borderRadius:10,color:"var(--success)",fontWeight:800,fontSize:15,opacity:likeOpacity,transform:"rotate(-12deg)",background:"rgba(240,253,244,.95)"}}>J’aime</div>}
            {dragX<-20&&<div style={{position:"absolute",top:20,left:20,padding:"6px 14px",border:"2px solid #DC2626",borderRadius:10,color:"var(--danger)",fontWeight:800,fontSize:15,opacity:skipOpacity,transform:"rotate(12deg)",background:"rgba(254,242,242,.95)"}}>Passer</div>}

            <div>
              {card.image
                ?<img src={card.image} alt={card.titre} style={{width:"100%",height:120,objectFit:"cover",borderRadius:14,marginBottom:10}} onError={e=>e.target.style.display="none"}/>
                :<div style={{fontSize:44,marginBottom:10,textAlign:"center"}}>{card.emoji||"🍽️"}</div>
              }
              <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
                {card.categorie&&<span style={{padding:"3px 10px",background:"var(--accent-soft)",borderRadius:999,fontSize:12,color:"var(--accent)",fontWeight:600 }}>{card.categorie}</span>}
                {card.temps&&<span style={{padding:"3px 10px",background:"var(--surface-2)",borderRadius:999,fontSize:12,color:"var(--text-2)"}}>{card.temps} min</span>}
                {card.difficulte&&<span style={{padding:"3px 10px",background:"var(--surface-2)",borderRadius:999,fontSize:12,color:"var(--text-2)"}}>{card.difficulte}</span>}
                {card.origin!=="ai"&&card.source&&<span style={{padding:"3px 10px",background:"#ECFDF5",borderRadius:999,fontSize:12,color:"#059669",fontWeight:600}}>{card.source}</span>}
                {card.note!=null&&<span style={{padding:"3px 10px",background:"#FEFCE8",borderRadius:999,fontSize:12,color:"#CA8A04",fontWeight:600 }}>⭐ {(card.note/20).toFixed(1)}/5{card.noteCount?` (${card.noteCount})`:""}</span>}
              </div>
              <h2 style={{margin:"0 0 10px",fontSize:20,fontWeight:700,letterSpacing:"-0.02em",color:"var(--text)",lineHeight:1.3}}>{card.titre}</h2>
              <p style={{margin:0,color:"var(--muted)",fontSize:13,lineHeight:1.6}}>{card.description}</p>
            </div>
            {card.origin==="ai"
              ? <span style={{fontSize:12,color:"#7C3AED",fontWeight:600,background:"#F5F3FF",padding:"4px 10px",borderRadius:10,alignSelf:"flex-start"}}>✨ Générée par IA</span>
              : card.url
                ? <a href={card.url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{color:"var(--accent)",fontSize:12,textDecoration:"none",fontWeight:600}}>🔗 {card.source||"Voir la source"}</a>
                : <span style={{fontSize:12,color:"var(--subtle)"}}>{card.source||""}</span>
            }
          </div>

          <div style={{display:"flex",gap:16,marginTop:432,justifyContent:"center"}}>
            <button onClick={()=>swipe("left")} style={{width:60,height:60,borderRadius:"50%",background:"#FEF2F2",border:"2px solid #FECACA",color:"var(--danger)",fontSize:22,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            <button onClick={()=>swipe("right")} style={{width:60,height:60,borderRadius:"50%",background:"#F0FDF4",border:"2px solid #BBF7D0",color:"var(--success)",fontSize:22,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>❤️</button>
          </div>
          <div style={{display:"flex",justifyContent:"center",gap:24,marginTop:14}}>
            <button onClick={()=>goTo(-1)} disabled={current===0} style={{background:"none",border:"none",color:current===0?"#D6D3D1":"var(--muted)",fontSize:13,cursor:current===0?"default":"pointer",fontFamily:"inherit",padding:0}}>‹ Précédente</button>
            <button onClick={()=>goTo(1)} style={{background:"none",border:"none",color:"var(--muted)",fontSize:13,cursor:"pointer",fontFamily:"inherit",padding:0}}>Suivante sans choisir ›</button>
          </div>
        </div>
      )}

      {/* End screen */}
      {isLast&&(
        <div style={{textAlign:"center",padding:32,background:"var(--surface)",borderRadius:999,border:"1px solid var(--border)"}}>
          <div style={{fontSize:44,marginBottom:14}}>🎉</div>
          <h3 style={{margin:"0 0 8px",color:"var(--text)",fontSize:20}}>Tu as vu toutes les recettes !</h3>
          <p style={{color:"var(--muted)",marginBottom:20}}>{liked.length} recette{liked.length>1?"s":""} sélectionnée{liked.length>1?"s":""}</p>
          {liked.length>0&&(
            <>
              <div style={{marginBottom:20,textAlign:"left"}}>
                {liked.map((c,i)=>{
                  const status=importStatus[c.titre];
                  return(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"var(--bg)",borderRadius:10,marginBottom:8,border:"1px solid var(--border)"}}>
                    <span style={{fontSize:18}}>{c.emoji||"🍽️"}</span>
                    <span style={{color:"var(--text)",fontSize:13,fontWeight:500,flex:1}}>{c.titre}</span>
                    {status==="loading"&&<span style={{fontSize:12,color:"#F59E0B"}}>⏳…</span>}
                    {status==="done"&&<span style={{fontSize:12,color:"var(--success)",fontWeight:600}}>✓</span>}
                    {status==="error"&&<button onClick={()=>importCardBg(c)} style={{fontSize:11,color:"var(--danger)",background:"#FEF2F2",border:"1px solid transparent",borderRadius:10,padding:"2px 8px",cursor:"pointer",fontFamily:"inherit"}}>✕ réessayer</button>}
                    {!status&&<span style={{fontSize:11,color:"var(--subtle)"}}>{c.categorie}</span>}
                  </div>
                  );
                })}
              </div>

            </>
          )}
          <button onClick={()=>{setCards([]);setCurrent(0);setLiked([]);setDone(false);setPrompt("");}}
            style={{marginTop:12,padding:"10px 20px",background:"transparent",border:"1px solid var(--border)",borderRadius:10,color:"var(--muted)",cursor:"pointer",fontFamily:"inherit",fontSize:14,width:"100%"}}>
            Nouvelle recherche
          </button>
        </div>
      )}

      {!loading&&cards.length===0&&!isLast&&(
        <div style={{textAlign:"center",padding:48}}>
          <div style={{width:56,height:56,borderRadius:999,background:"var(--surface-2)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px",color:"var(--subtle)"}}><Icon name="compass" size={24}/></div>
          <p style={{margin:0,fontSize:15,color:"var(--muted)"}}>Décris ce que tu veux cuisiner ci-dessus</p>
        </div>
      )}

      {/* Fiche détaillée — consultation seule, aucune décision enregistrée */}
      {detail&&(
        <div onClick={()=>setDetail(null)} style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(28,25,23,0.6)",display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
          <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:540,maxHeight:"85vh",overflowY:"auto",background:"#FFFDF9",borderRadius:"24px 24px 0 0",padding:24}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,gap:12}}>
              <h2 style={{margin:0,letterSpacing:"-0.02em",fontSize:20,color:"var(--text)",lineHeight:1.3}}>{detail.card.titre}</h2>
              <button onClick={()=>setDetail(null)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"var(--subtle)",flexShrink:0}}>✕</button>
            </div>
            <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
              {detail.card.categorie&&<span style={{padding:"3px 10px",background:"var(--accent-soft)",borderRadius:999,fontSize:12,color:"var(--accent)",fontWeight:600 }}>{detail.card.categorie}</span>}
              {detail.card.note!=null&&<span style={{padding:"3px 10px",background:"#FEFCE8",borderRadius:999,fontSize:12,color:"#CA8A04",fontWeight:600 }}>⭐ {(detail.card.note/20).toFixed(1)}/5{detail.card.noteCount?` (${detail.card.noteCount} avis)`:""}</span>}
            </div>
            {(detail.data?.photo||detail.data?.image||detail.card.image)&&<img src={detail.data?.photo||detail.data?.image||detail.card.image} alt={detail.card.titre} style={{width:"100%",maxHeight:200,objectFit:"cover",borderRadius:14,marginBottom:14}} onError={e=>e.target.style.display="none"}/>}
            {detail.loading&&<p style={{color:"var(--subtle)",fontSize:14,textAlign:"center",padding:"20px 0"}}>Chargement de la recette…</p>}
            {!detail.loading&&detail.error&&<p style={{color:"var(--danger)",fontSize:14,textAlign:"center",padding:"12px 0"}}>Impossible de charger cette recette pour le moment.</p>}
            {!detail.loading&&!detail.error&&detail.data&&(
              <>
                <div style={{display:"flex",gap:16,marginBottom:14,fontSize:13,color:"var(--muted)"}}>
                  {detail.data.temps&&<span>⏱ {detail.data.temps} min</span>}
                  {detail.data.portions&&<span>🍽 {detail.data.portions} portions</span>}
                </div>
                <h4 style={{margin:"0 0 8px",fontSize:14,color:"var(--text)"}}>Ingrédients</h4>
                <pre style={{whiteSpace:"pre-wrap",fontFamily:"inherit",fontSize:13,color:"#44403C",background:"var(--bg)",padding:12,borderRadius:10,margin:"0 0 16px"}}>{detail.data.ingredients||"—"}</pre>
                <h4 style={{margin:"0 0 8px",fontSize:14,color:"var(--text)"}}>Instructions</h4>
                <pre style={{whiteSpace:"pre-wrap",fontFamily:"inherit",fontSize:13,color:"#44403C",margin:0}}>{detail.data.instructions||"—"}</pre>
              </>
            )}
            <div style={{display:"flex",gap:10,marginTop:22}}>
              <button onClick={()=>setDetail(null)} style={{flex:1,padding:"12px",background:"var(--surface-2)",border:"none",borderRadius:10,color:"var(--text-2)",fontWeight:600,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Continuer à parcourir</button>
              <button onClick={()=>{swipe("left");setDetail(null);}} style={{padding:"12px 18px",background:"#FEF2F2",border:"2px solid #FECACA",borderRadius:10,color:"var(--danger)",fontWeight:700,cursor:"pointer",fontSize:18}}>✕</button>
              <button onClick={()=>{swipe("right");setDetail(null);}} style={{padding:"12px 18px",background:"#F0FDF4",border:"2px solid #BBF7D0",borderRadius:10,color:"var(--success)",fontWeight:700,cursor:"pointer",fontSize:18}}>❤️</button>
            </div>
          </div>
        </div>
      )}
      {selectedLocal&&(
        <RecipeDetailModal
          recette={selectedLocal}
          onClose={()=>setSelectedLocal(null)}
          toast={toast}
          onAddToCourses={()=>{}}
          onAddToPlanning={()=>{}}
        />
      )}
    </div>
  );
}
