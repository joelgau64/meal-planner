import { fetchAndCache, loadWithCache } from "../../lib/data";
import { buildIndex } from "../../lib/dictionnaire";
import { planCleanup } from "../../lib/nettoyage";
import { useCallback, useEffect, useMemo, useState } from "react";
import { peekCached, setCache } from "../../lib/cache";
import { CAT_COLORS, DB_COURSES } from "../../lib/constants";
import { logError } from "../../lib/errors";
import { guessCategory } from "../../lib/ingredients";
import { nCheck, nSel, nText, nTitle, notionCreate, notionUpdate } from "../../lib/notion";
import { Icon } from "../../ui/Icon";
import { Field, Modal, Spinner, btnDisabled, btnPrimary, inputStyle } from "../../ui/primitives";

// ── Courses Tab ───────────────────────────────────────────────────────────────
export function CoursesTab({toast}){
  const [courses,setCourses]=useState(()=>peekCached("courses")||[]);
  const [loading,setLoading]=useState(()=>!peekCached("courses"));
  const [showForm,setShowForm]=useState(false);
  const [sortBy,setSortBy]=useState("categorie"); // "categorie" | "recette"
  const [form,setForm]=useState({article:"",categorie:"Épicerie",quantite:"",semaine:"",recette:""});
  const [categorieTouched,setCategorieTouched]=useState(false); // true dès que l'utilisateur choisit la catégorie à la main
  const [saving,setSaving]=useState(false);
  const [editItem,setEditItem]=useState(null); // ligne en cours d'édition
  const [editCatTouched,setEditCatTouched]=useState(false);
  const [suggestions,setSuggestions]=useState([]); // autocomplétion sur l'historique
  const [quick,setQuick]=useState(""); // saisie rapide en tête de liste
  const [quickSaving,setQuickSaving]=useState(false);
  const [showBought,setShowBought]=useState(false);
  const [cleanPlan,setCleanPlan]=useState(null); // aperçu du nettoyage avant application
  const [cleaning,setCleaning]=useState(false);

  // Historique normalisé des articles déjà utilisés (pour normer l'orthographe).
  // On garde la 1re orthographe rencontrée par forme normalisée.
  const articleHistory=useMemo(()=>{
    const norm=s=>(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();
    const seen=new Map();
    for(const c of courses){
      const k=norm(c.article);
      if(k&&!seen.has(k))seen.set(k,{article:c.article,categorie:c.categorie});
    }
    return[...seen.values()];
  },[courses]);

  const updateSuggestions=(val)=>{
    const norm=s=>(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();
    const q=norm(val);
    if(q.length<1){setSuggestions([]);return;}
    setSuggestions(articleHistory.filter(h=>norm(h.article).includes(q)).slice(0,6));
  };

  const load=useCallback(async(force=false,silent=false)=>{
    const {needSpinner,promise}=loadWithCache("courses",{force,onCached:setCourses,onFresh:setCourses,onError:e=>toast("❌ Courses non chargées : "+e.message)});
    if(needSpinner&&!silent)setLoading(true);else setLoading(false);
    await promise;
    setLoading(false);
  },[toast]);

  useEffect(()=>{load();},[load]);

  const toggleAchete=async(item)=>{
    const newVal=!item.achete;
    const updated=courses.map(c=>c.id===item.id?{...c,achete:newVal}:c);
    setCourses(updated);setCache("courses",updated);
    notionUpdate(item.id,{"Acheté":nCheck(newVal)});
  };

  const saveEditCourse=async()=>{
    if(!editItem?.article)return;
    const updated=courses.map(c=>c.id===editItem.id?{...editItem}:c);
    setCourses(updated);setCache("courses",updated);
    try{
      await notionUpdate(editItem.id,{
        "Article":nTitle(editItem.article),
        "Catégorie":nSel(editItem.categorie),
        "Quantité":nText(editItem.quantite||""),
      });
      toast("Article modifié ✓");
    }catch(e){logError("courseEdit",e,{item:editItem.article});toast("Erreur");}
    setEditItem(null);setEditCatTouched(false);
  };

  const deleteAchetes=async()=>{
    const toDelete=courses.filter(c=>c.achete);
    if(!toDelete.length)return;
    const updated=courses.filter(c=>!c.achete);
    setCourses(updated);setCache("courses",updated);
    // Archiver dans Notion en parallèle
    await Promise.all(toDelete.map(c=>
      fetch(`/api/notion?path=/v1/pages/${c.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({archived:true})})
    ));
    toast(toDelete.length+" article"+(toDelete.length>1?"s":"")+" supprimé"+(toDelete.length>1?"s":"")+" ✓");
  };

  // ── Nettoyage de la liste via le dictionnaire d'ingrédients ────────────────
  const prepareCleanup=async()=>{
    setCleaning(true);
    try{
      const dict=await fetchAndCache("ingredients"); // version fraîche
      const plan=planCleanup(courses.filter(c=>!c.achete),buildIndex(dict));
      if(!plan.ops.length)toast("Liste déjà propre ✓");else setCleanPlan(plan);
    }catch(e){logError("cleanupPlan",e);toast("❌ Dictionnaire indisponible : "+e.message);}
    setCleaning(false);
  };
  const applyCleanup=async()=>{
    const plan=cleanPlan;setCleanPlan(null);setCleaning(true);
    let fails=0;
    const ok=r=>{if(!r||r.object==="error")fails++;};
    for(const op of plan.ops){
      try{
        if(op.type==="update"){
          ok(await notionUpdate(op.id,{"Article":nTitle(op.fields.article),"Catégorie":nSel(op.fields.categorie),"Quantité":nText(op.fields.quantite),"Recette":nText(op.fields.recette)}));
        }else if(op.type==="check"){
          ok(await notionUpdate(op.id,{"Acheté":nCheck(true)}));
        }else if(op.type==="create"){
          ok(await notionCreate(DB_COURSES,{"Article":nTitle(op.fields.article),"Catégorie":nSel(op.fields.categorie),"Quantité":nText(op.fields.quantite),"Recette":nText(op.fields.recette),"Semaine":nText(op.fields.semaine),"Acheté":nCheck(!!op.gardeManger)}));
        }else if(op.type==="archive"){
          const r=await fetch(`/api/notion?path=/v1/pages/${op.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({archived:true})});
          if(!r.ok)fails++;
        }
      }catch(e){fails++;logError("cleanupApply",e,{op:op.type});}
    }
    setCleaning(false);
    setCache("courses",null);await load(true,true);
    toast(fails?`⚠️ Nettoyage terminé avec ${fails} erreur${fails>1?"s":""}`:"Liste nettoyée ✓");
  };

  const addItem=async()=>{
    setSaving(true);
    await notionCreate(DB_COURSES,{"Article":nTitle(form.article),"Catégorie":nSel(form.categorie),"Quantité":nText(form.quantite),"Semaine":nText(form.semaine),"Recette":nText(form.recette)});
    toast("Article ajouté ✓");setSaving(false);setShowForm(false);
    setForm({article:"",categorie:"Épicerie",quantite:"",semaine:"",recette:""});
    setCategorieTouched(false);
    setCache("courses",null);load(true,true);
  };

  const quickAdd=async()=>{
    const article=quick.trim();
    if(!article||quickSaving)return;
    const norm=x=>(x||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();
    const known=articleHistory.find(h=>norm(h.article)===norm(article));
    const categorie=known?.categorie||guessCategory(article);
    setQuickSaving(true);
    const r=await notionCreate(DB_COURSES,{"Article":nTitle(known?.article||article),"Catégorie":nSel(categorie),"Quantité":nText(""),"Semaine":nText(""),"Recette":nText("")});
    setQuickSaving(false);
    if(r?.object==="error"){toast("❌ Ajout impossible : "+(r.message||"erreur"));return;}
    setQuick("");setSuggestions([]);
    setCache("courses",null);load(true,true);
  };
  // À acheter : groupés par rayon ou par recette. Achetés : à part, en bas, repliés.
  const toBuy=courses.filter(c=>!c.achete);
  const bought=courses.filter(c=>c.achete);
  const groupKey=c=>sortBy==="categorie"?(c.categorie||"Autre"):(c.recette||"Sans recette");
  const grouped=toBuy.reduce((acc,c)=>{const k=groupKey(c);(acc[k]=acc[k]||[]).push(c);return acc;},{});
  // ordre des rayons = ordre de CAT_COLORS (parcours du magasin), le reste à la fin
  const CAT_ORDER=Object.keys(CAT_COLORS);
  const groupEntries=Object.entries(grouped).sort(([a],[b])=>sortBy!=="categorie"?a.localeCompare(b,"fr"):((CAT_ORDER.indexOf(a)+1||99)-(CAT_ORDER.indexOf(b)+1||99)));

  const total=courses.length;const done=courses.filter(c=>c.achete).length;

  // fonction de rendu (pas un composant) : évite de recréer le type à chaque rendu
  const renderRow=item=>(
    <div key={item.id} className="course-row" onClick={()=>toggleAchete(item)} role="checkbox" aria-checked={item.achete}
      style={{display:"flex",alignItems:"center",gap:12,padding:"12px 8px 12px 14px",cursor:"pointer",minHeight:56}}>
      <span style={{width:24,height:24,borderRadius:999,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",border:item.achete?"none":"2px solid #D6D3D1",background:item.achete?"var(--success)":"transparent",color:"#fff",transition:"all .15s"}}>
        {item.achete&&<Icon name="check" size={14}/>}
      </span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:16,color:item.achete?"var(--subtle)":"var(--text)",textDecoration:item.achete?"line-through":"none",lineHeight:1.3}}>{item.article}</div>
        {sortBy==="categorie"&&item.recette&&<div style={{fontSize:12,color:"var(--subtle)",marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.recette}</div>}
      </div>
      {item.quantite&&<span style={{fontSize:14,color:"var(--muted)",whiteSpace:"nowrap",fontVariantNumeric:"tabular-nums"}}>{item.quantite}</span>}
      <button onClick={e=>{e.stopPropagation();setEditItem({...item});setEditCatTouched(false);}} aria-label={`Modifier ${item.article}`} className="icon-btn" style={{color:"#C9C4BE"}}><Icon name="edit" size={16}/></button>
    </div>
  );
  return(
    <div>
      {/* En-tête : reste à acheter + progression */}
      <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:12,marginBottom:14}}>
        <div>
          <div style={{fontSize:28,fontWeight:700,letterSpacing:"-0.03em",color:"var(--text)",lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{toBuy.length}<span style={{fontSize:15,fontWeight:500,color:"var(--muted)",letterSpacing:0,marginLeft:6}}>à acheter</span></div>
          {total>0&&<div style={{background:"var(--border)",borderRadius:999,height:4,width:160,overflow:"hidden",marginTop:10}}><div style={{background:"var(--success)",height:"100%",width:`${(done/total)*100}%`,borderRadius:999,transition:"width 0.3s"}}/></div>}
        </div>
        <div style={{display:"flex",gap:4,alignItems:"center"}}>
          <div role="tablist" style={{display:"flex",background:"var(--border)",borderRadius:999,padding:3}}>
            {[["categorie","Rayon"],["recette","Recette"]].map(([k,l])=>(
              <button key={k} role="tab" aria-selected={sortBy===k} onClick={()=>setSortBy(k)} style={{padding:"6px 12px",background:sortBy===k?"#FFFFFF":"transparent",boxShadow:sortBy===k?"0 1px 2px rgba(28,25,23,0.12)":"none",border:"none",borderRadius:999,color:sortBy===k?"var(--text)":"var(--muted)",cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit"}}>{l}</button>
            ))}
          </div>
          <button onClick={prepareCleanup} disabled={cleaning||!toBuy.length} aria-label="Nettoyer la liste" title="Nettoyer la liste (dictionnaire)" className="icon-btn" style={{opacity:cleaning||!toBuy.length?0.4:1}}><Icon name="sparkle" size={17}/></button>
          <button onClick={()=>load(true)} aria-label="Actualiser" className="icon-btn"><Icon name="refresh" size={17}/></button>
        </div>
      </div>

      {/* Saisie rapide */}
      <div style={{position:"relative",marginBottom:18}}>
        <div style={{display:"flex",alignItems:"center",gap:8,background:"var(--surface)",borderRadius:14,boxShadow:"0 0 0 1px rgba(28,25,23,0.08)",padding:"4px 4px 4px 14px"}}>
          <span style={{color:"var(--subtle)",display:"flex"}}><Icon name="plus" size={18}/></span>
          <input value={quick} onChange={e=>{setQuick(e.target.value);updateSuggestions(e.target.value);}} onKeyDown={e=>{if(e.key==="Enter")quickAdd();if(e.key==="Escape"){setQuick("");setSuggestions([]);}}}
            placeholder="Ajouter un article…" autoComplete="off" enterKeyHint="done" aria-label="Ajouter un article"
            style={{flex:1,minWidth:0,border:"none",outline:"none",boxShadow:"none",background:"transparent",fontSize:16,padding:"10px 0",color:"var(--text)",fontFamily:"inherit"}}/>
          {quick.trim()
            ?<button onClick={quickAdd} disabled={quickSaving} style={{height:40,padding:"0 16px",background:"var(--accent)",border:"none",borderRadius:10,color:"#fff",fontWeight:600,fontSize:14,cursor:"pointer",opacity:quickSaving?0.6:1,fontFamily:"inherit"}}>{quickSaving?"…":"Ajouter"}</button>
            :<button onClick={()=>setShowForm(true)} aria-label="Ajout détaillé (quantité, recette)" title="Ajout détaillé" className="icon-btn"><Icon name="edit" size={16}/></button>}
        </div>
        {quick&&suggestions.length>0&&(
          <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:20,background:"var(--surface)",borderRadius:14,marginTop:6,boxShadow:"0 8px 24px rgba(28,25,23,0.12),0 0 0 1px rgba(28,25,23,0.06)",overflow:"hidden"}}>
            {suggestions.map((sg,k)=>(
              <button key={k} onClick={()=>{setQuick(sg.article);setSuggestions([]);}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,width:"100%",padding:"12px 14px",background:"none",border:"none",borderTop:k?"1px solid var(--surface-2)":"none",cursor:"pointer",textAlign:"left",fontSize:15,color:"var(--text)",fontFamily:"inherit"}}>
                <span>{sg.article}</span><span style={{fontSize:12,color:"var(--subtle)"}}>{sg.categorie}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {cleanPlan&&(
        <Modal title="✨ Nettoyer la liste" onClose={()=>setCleanPlan(null)}>
          <p style={{fontSize:13,color:"var(--muted)",marginBottom:12,lineHeight:1.5}}>
            {cleanPlan.summary.update} renommé{cleanPlan.summary.update>1?"s":""} ou corrigé{cleanPlan.summary.update>1?"s":""} · {cleanPlan.summary.create} créé{cleanPlan.summary.create>1?"s":""} par éclatement · {cleanPlan.summary.archive} supprimé{cleanPlan.summary.archive>1?"s":""} (doublons fusionnés) · {cleanPlan.summary.check} du garde-manger mis dans le caddie.
          </p>
          <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:16,maxHeight:"50vh",overflow:"auto"}}>
            {cleanPlan.ops.map((op,i)=>(
              <div key={i} style={{fontSize:13,display:"flex",gap:8,alignItems:"baseline",padding:"4px 0",borderBottom:"1px solid var(--surface-2)"}}>
                <span style={{width:18,flexShrink:0}}>{{update:"✏️",create:"➕",archive:"🗑️",check:"🏠"}[op.type]}</span>
                <span style={{color:"var(--text)"}}>
                  {op.type==="update"&&<>{op.before!==op.after?<><s style={{color:"var(--subtle)"}}>{op.before}</s> → {op.after}</>:op.after}{op.fields.quantite&&<span style={{color:"var(--muted)"}}> · {op.fields.quantite}</span>}</>}
                  {op.type==="create"&&<>{op.after} <span style={{color:"var(--muted)"}}>(de « {op.before} »)</span></>}
                  {op.type==="archive"&&<><s style={{color:"var(--subtle)"}}>{op.before}</s> <span style={{color:"var(--muted)"}}>({op.reason})</span></>}
                  {op.type==="check"&&<>{op.before} <span style={{color:"var(--muted)"}}>→ caddie</span></>}
                </span>
              </div>
            ))}
          </div>
          <button onClick={applyCleanup} style={{...btnPrimary,width:"100%"}}>Appliquer</button>
        </Modal>
      )}

      {loading?<Spinner label="Chargement des courses…"/>:(
        <div style={{display:"flex",flexDirection:"column",gap:18}}>
          {total===0&&<div style={{textAlign:"center",padding:"48px 16px",color:"var(--muted)"}}><div style={{width:56,height:56,borderRadius:999,background:"var(--surface-2)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px",color:"var(--subtle)"}}><Icon name="cart" size={24}/></div><div style={{fontSize:15,fontWeight:600,color:"var(--text)"}}>Liste vide</div><div style={{fontSize:13,marginTop:4}}>Ajoute un article ci-dessus, ou génère la liste depuis le Planning.</div></div>}
          {total>0&&toBuy.length===0&&<div style={{textAlign:"center",padding:"24px 16px",color:"var(--success)",fontWeight:600,fontSize:15}}>Tout est dans le caddie ✓</div>}
          {groupEntries.map(([key,items])=>(
            <section key={key}>
              <div style={{display:"flex",alignItems:"center",gap:8,margin:"0 4px 8px"}}>
                {sortBy==="categorie"&&<span style={{width:8,height:8,borderRadius:999,background:CAT_COLORS[key]||"var(--subtle)"}}/>}
                <span style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>{key}</span>
                <span style={{fontSize:13,color:"var(--subtle)"}}>{items.length}</span>
              </div>
              <div className="card list-card" style={{overflow:"hidden"}}>
                {items.map(item=>renderRow(item))}
              </div>
            </section>
          ))}
          {bought.length>0&&(
            <section>
              <div style={{display:"flex",alignItems:"center",gap:8,margin:"0 4px 8px"}}>
                <button onClick={()=>setShowBought(v=>!v)} aria-expanded={showBought} style={{display:"flex",alignItems:"center",gap:6,background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:"inherit"}}>
                  <span style={{display:"flex",color:"var(--subtle)",transform:showBought?"rotate(90deg)":"none",transition:"transform .15s"}}><Icon name="arrow" size={14}/></span>
                  <span style={{fontSize:14,fontWeight:700,color:"var(--muted)"}}>Dans le caddie</span>
                  <span style={{fontSize:13,color:"var(--subtle)"}}>{bought.length}</span>
                </button>
                <button onClick={deleteAchetes} style={{marginLeft:"auto",fontSize:13,fontWeight:600,color:"var(--danger)",background:"none",border:"none",cursor:"pointer",padding:"6px 4px",fontFamily:"inherit"}}>Vider</button>
              </div>
              {showBought&&<div className="card list-card" style={{overflow:"hidden"}}>{bought.map(item=>renderRow(item))}</div>}
            </section>
          )}
        </div>
      )}

      {showForm&&(
        <Modal title="Ajouter un article" onClose={()=>setShowForm(false)}>
          <Field label="Article">
            <div style={{position:"relative"}}>
              <input style={inputStyle} value={form.article} onChange={e=>{
                const val=e.target.value;
                setForm(f=>({...f,article:val,categorie:categorieTouched?f.categorie:guessCategory(val)}));
                updateSuggestions(val);
              }} placeholder="Ex: Tomates" autoComplete="off"/>
              {suggestions.length>0&&(
                <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:10,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,marginTop:4,boxShadow:"0 4px 12px rgba(0,0,0,0.08)",overflow:"hidden"}}>
                  {suggestions.map((s,i)=>(
                    <button key={i} onClick={()=>{setForm(f=>({...f,article:s.article,categorie:categorieTouched?f.categorie:s.categorie}));setSuggestions([]);}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,width:"100%",padding:"10px 12px",background:"none",border:"none",borderBottom:i<suggestions.length-1?"1px solid var(--surface-2)":"none",cursor:"pointer",textAlign:"left",fontSize:14,color:"var(--text)"}}>
                      <span>{s.article}</span>
                      <span style={{fontSize:11,color:"var(--subtle)"}}>{s.categorie}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Field label="Catégorie"><select style={inputStyle} value={form.categorie} onChange={e=>{setCategorieTouched(true);setForm(f=>({...f,categorie:e.target.value}));}}>{Object.keys(CAT_COLORS).map(c=><option key={c}>{c}</option>)}</select></Field>
            <Field label="Quantité"><input style={inputStyle} value={form.quantite} onChange={e=>setForm(f=>({...f,quantite:e.target.value}))} placeholder="500g..."/></Field>
          </div>
          <Field label="Recette (optionnel)"><input style={inputStyle} value={form.recette} onChange={e=>setForm(f=>({...f,recette:e.target.value}))} placeholder="Ex: Poulet rôti"/></Field>
          <button onClick={addItem} disabled={saving||!form.article} style={form.article?btnPrimary:btnDisabled}>{saving?"Ajout…":"Ajouter"}</button>
        </Modal>
      )}

      {editItem&&(
        <Modal title="Modifier l'article" onClose={()=>{setEditItem(null);setEditCatTouched(false);}}>
          <Field label="Article"><input style={inputStyle} value={editItem.article} onChange={e=>{
            const val=e.target.value;
            setEditItem(d=>({...d,article:val,categorie:editCatTouched?d.categorie:guessCategory(val)}));
          }} placeholder="Ex: Tomates"/></Field>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Field label="Catégorie"><select style={inputStyle} value={editItem.categorie} onChange={e=>{setEditCatTouched(true);setEditItem(d=>({...d,categorie:e.target.value}));}}>{Object.keys(CAT_COLORS).map(c=><option key={c}>{c}</option>)}</select></Field>
            <Field label="Quantité"><input style={inputStyle} value={editItem.quantite||""} onChange={e=>setEditItem(d=>({...d,quantite:e.target.value}))} placeholder="500g..."/></Field>
          </div>
          <button onClick={saveEditCourse} disabled={!editItem.article} style={editItem.article?btnPrimary:btnDisabled}>Enregistrer</button>
        </Modal>
      )}
    </div>
  );
}
