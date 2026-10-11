import { useState } from "react";
import { CookingMode } from "../cooking/CookingMode";
import { RecipeForm } from "./AddRecipeModal";
import { setCache } from "../../lib/cache";
import { DB_COURSES, DEFAULT_PORTIONS } from "../../lib/constants";
import { logError } from "../../lib/errors";
import { guessCategory, parseIngredients, scaleIngredients } from "../../lib/ingredients";
import { nNum, nSel, nText, nTitle, nUrl, notionCreate, notionUpdate } from "../../lib/notion";
import { Icon } from "../../ui/Icon";
import { DaysSince, Modal, ScoreBadge, btnPrimary } from "../../ui/primitives";

export function RecipeDetailModal({recette,onClose,toast,onAddToCourses,onAddToPlanning,onDelete,onUpdate,planningEntry,onCancelPlanning,onRequeuePlanning,onCookComplete:onCookCompleteParent}){
  const [confirmDelete,setConfirmDelete]=useState(false);
  const [deleting,setDeleting]=useState(false);
  const [photoCandidates,setPhotoCandidates]=useState(null); // null=fermé, []=recherche vide
  const [photoSearching,setPhotoSearching]=useState(false);
  const [localPhoto,setLocalPhoto]=useState(recette.photo||"");
  const [photoBroken,setPhotoBroken]=useState(false);
  const basePortion=recette.portions||DEFAULT_PORTIONS;
  const [portions,setPortions]=useState(basePortion);
  const [selectedIngredients,setSelectedIngredients]=useState(null);
  const [cookingMode,setCookingMode]=useState(false);
  const [currentNote,setCurrentNote]=useState(recette.note||"");
  const [savingNote,setSavingNote]=useState(false);
  const [commentaires,setCommentaires]=useState(recette.commentaires||"");
  const [savingComment,setSavingComment]=useState(false);
  const [commentTimer,setCommentTimer]=useState(null);
  const [editing,setEditing]=useState(false);
  const [editForm,setEditForm]=useState(null);
  const [savingEdit,setSavingEdit]=useState(false);
  const score=(recette.likes||0)-(recette.dislikes||0);

  const startEdit=()=>{
    setEditForm({
      nom:recette.nom||"",categorie:recette.categorie||"Dîner",temps:recette.temps||"",
      portions:recette.portions||DEFAULT_PORTIONS,ingredients:recette.ingredients||"",
      instructions:recette.instructions||"",note:recette.note||"***",
      photoUrl:recette.photo||"",sourceUrl:recette.sourceUrl||"",
    });
    setEditing(true);
  };

  const saveEdit=async()=>{
    if(!editForm?.nom)return;
    setSavingEdit(true);
    const r=await notionUpdate(recette.id,{
      "Nom":nTitle(editForm.nom),"Catégorie":nSel(editForm.categorie),"Temps de préparation":nNum(editForm.temps),
      "Portions":nNum(editForm.portions||DEFAULT_PORTIONS),"Ingrédients":nText(editForm.ingredients),
      "Instructions":nText(editForm.instructions),"Note":nSel(editForm.note),
      "Photo":nUrl(editForm.photoUrl||""),"Source":nUrl(editForm.sourceUrl||""),
    });
    setSavingEdit(false);
    if(!r||r.object==="error"){
      logError("RecipeDetailModal.saveEdit",new Error(r?.message||"Échec de la mise à jour Notion"),{id:recette.id});
      toast("Erreur : modifications non enregistrées ✕");
      return;
    }
    setCache("recettes",null);
    const updated={...recette,nom:editForm.nom,categorie:editForm.categorie,temps:Number(editForm.temps)||0,
      portions:Number(editForm.portions)||DEFAULT_PORTIONS,ingredients:editForm.ingredients,instructions:editForm.instructions,
      note:editForm.note,photo:editForm.photoUrl||null,sourceUrl:editForm.sourceUrl||""};
    onUpdate?.(updated);
    setEditing(false);
    toast("Recette modifiée ✓");
  };

  const parsedIngredients=parseIngredients(recette.ingredients);
  const scaled=scaleIngredients(parsedIngredients,basePortion,portions);

  const instructions=recette.instructions
    ?recette.instructions.split(/\n|\s+(?=\d{1,2}[.)]\s)/).filter(s=>s.trim()) // coupe sur "2. " précédé d'un espace, pas sur "1h15."
    :[];

  const handleAddToCourses=()=>{
    const selected=scaled.map((ing,i)=>({...ing,selected:true,idx:i}));
    setSelectedIngredients(selected);
  };

  if(cookingMode) return <CookingMode recette={recette} scaled={scaled} portions={portions} onClose={()=>setCookingMode(false)} planningEntry={planningEntry} toast={toast} onCookComplete={()=>{onCookCompleteParent&&onCookCompleteParent();onClose&&onClose();}}/>;

  if(editing){
    return(
      <Modal title={"Modifier : "+recette.nom} onClose={()=>setEditing(false)} wide>
        <RecipeForm form={editForm} setForm={setEditForm} saving={savingEdit} onSave={saveEdit} analyzing={false}/>
        <button onClick={()=>setEditing(false)} disabled={savingEdit} style={{width:"100%",marginTop:8,padding:"10px",background:"transparent",border:"1px solid var(--border)",borderRadius:10,color:"var(--muted)",cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Annuler</button>
      </Modal>
    );
  }

  if(selectedIngredients){
    return(
      <Modal title="Ajouter aux courses" onClose={()=>setSelectedIngredients(null)} wide>
        <p style={{color:"var(--muted)",fontSize:13,margin:"0 0 16px"}}>Déselectionne les ingrédients déjà disponibles :</p>
        <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:20}}>
          {selectedIngredients.map((ing,i)=>(
            <div key={i} onClick={()=>setSelectedIngredients(prev=>prev.map((x,j)=>j===i?{...x,selected:!x.selected}:x))}
              style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,cursor:"pointer",opacity:ing.selected?1:0.4}}>
              <div style={{width:20,height:20,borderRadius:10,border:`2px solid ${ing.selected?"var(--accent)":"#44403C"}`,background:ing.selected?"var(--accent)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {ing.selected&&<Icon name="check" size={12}/>}
              </div>
              <span style={{flex:1,fontSize:14,color:"var(--text)"}}>{ing.name}</span>
              <span style={{fontSize:12,color:"var(--muted)"}}>{ing.displayQty||ing.qty||""} {ing.unit}</span>
            </div>
          ))}
        </div>
        <button onClick={async()=>{
          const toAdd=selectedIngredients.filter(i=>i.selected);
          const semaine=new Date().toLocaleDateString("fr-FR",{day:"numeric",month:"short"});
          for(const ing of toAdd){
            const qty=`${ing.displayQty||ing.qty||""} ${ing.unit}`.trim();
            await notionCreate(DB_COURSES,{"Article":nTitle(ing.name),"Catégorie":nSel(guessCategory(ing.name)),"Quantité":nText(qty),"Semaine":nText(`Sem. du ${semaine}`),"Recette":nText(recette.nom)});
          }
          setCache("courses",null);
          toast(`${toAdd.length} ingrédients ajoutés aux courses ✓`);
          setSelectedIngredients(null);
          onClose();
        }} style={btnPrimary}>Ajouter {selectedIngredients.filter(i=>i.selected).length} ingrédients aux courses</button>
      </Modal>
    );
  }

  const searchPhoto=async()=>{
    setPhotoSearching(true);setPhotoCandidates(null);
    try{
      const r=await fetch("/api/recipe-image?q="+encodeURIComponent(recette.nom));
      const d=await r.json();
      setPhotoCandidates(d.candidates||[]);
    }catch(e){logError("searchPhoto",e,{recette:recette.nom});setPhotoCandidates([]);}
    setPhotoSearching(false);
  };
  const approvePhoto=async(url)=>{
    setLocalPhoto(url);setPhotoCandidates(null);
    try{
      await notionUpdate(recette.id,{"Photo":nUrl(url)});
      toast("Photo ajoutée ✓");
      onUpdate&&onUpdate({...recette,photo:url});
    }catch(e){logError("approvePhoto",e,{recette:recette.nom});toast("Erreur enregistrement photo");}
  };

  return(
    <Modal title={recette.nom} onClose={onClose} full>
      {(localPhoto&&!photoBroken)
        ?<div style={{position:"relative",marginBottom:16}}>
           <img src={localPhoto} alt={recette.nom} style={{width:"100%",height:240,objectFit:"cover",borderRadius:16,display:"block"}} onError={()=>setPhotoBroken(true)}/>
           <button onClick={searchPhoto} disabled={photoSearching} title="Changer la photo" style={{position:"absolute",bottom:8,right:8,background:"rgba(28,25,23,0.75)",color:"#fff",border:"none",borderRadius:999,padding:"6px 12px",fontSize:11,fontWeight:600,cursor:"pointer"}}>{photoSearching?"…":"Changer la photo"}</button>
         </div>
        :<button onClick={searchPhoto} disabled={photoSearching} style={{width:"100%",padding:"14px",marginBottom:16,background:"var(--accent-soft)",border:"1.5px dashed #E8C4AE",borderRadius:10,color:"var(--accent)",fontWeight:600,fontSize:13,cursor:"pointer"}}>{photoSearching?"Recherche d'images…":(localPhoto&&photoBroken)?"⚠️ Photo cassée — en trouver une autre":"Trouver une photo pour cette recette"}</button>
      }

      {photoCandidates!==null&&(
        <div style={{position:"fixed",inset:0,zIndex:2700,background:"rgba(28,25,23,0.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setPhotoCandidates(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:"var(--surface)",borderRadius:14,maxWidth:560,width:"100%",maxHeight:"85vh",overflow:"auto",padding:18}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <h3 style={{margin:0,fontSize:16,fontWeight:700,letterSpacing:"-0.02em"}}>Choisis une photo</h3>
              <button onClick={()=>setPhotoCandidates(null)} aria-label="Fermer" className="icon-btn"><Icon name="close" size={18}/></button>
            </div>
            <p style={{fontSize:12,color:"var(--muted)",margin:"0 0 12px"}}>Résultats web pour « {recette.nom} ». Tape une image pour l'utiliser.</p>
            {photoCandidates.length===0?(
              <div style={{textAlign:"center",padding:"24px",color:"var(--subtle)",fontSize:13}}>Aucune image trouvée. Réessaie ou ajoute une photo manuellement via Modifier.</div>
            ):(
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:8}}>
                {photoCandidates.map((c,i)=>(
                  <button key={i} onClick={()=>approvePhoto(c.url)} style={{padding:0,border:"1px solid var(--border)",borderRadius:10,overflow:"hidden",cursor:"pointer",background:"var(--bg)",aspectRatio:"4/3"}}>
                    <img src={c.thumb} alt={c.title} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}} onError={e=>{e.target.parentElement.style.display="none";}}/>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Header info */}
      <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        {recette.categorie&&<span style={{fontSize:12,padding:"4px 10px",borderRadius:10,background:"var(--surface-2)",color:"var(--muted)"}}>{recette.categorie}</span>}
        {recette.temps>0&&<span style={{fontSize:12,padding:"4px 10px",borderRadius:10,background:"var(--surface-2)",color:"var(--muted)"}}>⏱ {recette.temps} min</span>}
        <ScoreBadge score={score}/>
        {recette.fois_cuisinee>0&&<span style={{fontSize:12,color:"var(--muted)"}}>{recette.fois_cuisinee}× cuisinée</span>}
        <DaysSince date={recette.derniere_cuisson}/>
        {recette.sourceUrl&&<a href={recette.sourceUrl} target="_blank" rel="noreferrer" style={{display:"flex",alignItems:"center",gap:4,fontSize:12,color:"var(--accent)",textDecoration:"none"}}><Icon name="external" size={12}/> Recette originale</a>}
      </div>

      {/* Statut planification (si ouvert depuis le planning) */}
      {planningEntry&&(
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:16,padding:"10px 14px",background:"var(--accent-soft)",border:"1px solid transparent",borderRadius:10}}>
          <span style={{fontSize:13,color:"var(--accent)",fontWeight:600,flex:1,minWidth:180}}>
            {planningEntry.queue||!planningEntry.date
              ?"⏳ En file d'attente"
              :`📅 Planifié le ${new Date(planningEntry.date+"T00:00").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}${planningEntry.moment?" · "+planningEntry.moment:""}`}
          </span>
          <div style={{display:"flex",gap:8}}>
            {!planningEntry.queue&&planningEntry.date&&onRequeuePlanning&&(
              <button onClick={()=>onRequeuePlanning(planningEntry)} style={{padding:"6px 12px",background:"var(--surface)",border:"1px solid #E8C4AE",borderRadius:10,color:"var(--accent)",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                ↩ File d'attente
              </button>
            )}
            {onCancelPlanning&&(
              <button onClick={()=>onCancelPlanning(planningEntry)} style={{padding:"6px 12px",background:"var(--surface)",border:"1px solid #FECACA",borderRadius:10,color:"var(--danger)",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                ✕ {planningEntry.queue?"Retirer de la file":"Annuler"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Notation étoiles */}
      <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:16}}>
        {[1,2,3,4,5].map(n=>{
          const filled=(currentNote||"").length>=n;
          return(
            <button key={n} onClick={async()=>{
              if(savingNote)return;
              const newNote="*".repeat(n);
              setCurrentNote(newNote);setSavingNote(true);
              await notionUpdate(recette.id,{"Note":nSel(newNote)});
              setSavingNote(false);toast("Note mise à jour ✓");
            }}
            style={{background:"none",border:"none",cursor:"pointer",fontSize:20,padding:"0 1px",lineHeight:1,color:filled?"#F59E0B":"var(--border)",transition:"color 0.1s"}}>
              ★
            </button>
          );
        })}
        <span style={{fontSize:11,color:"var(--subtle)",marginLeft:4}}>{savingNote?"...":(currentNote||"").length+"/5"}</span>
      </div>

      {/* Portions adjuster */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20,padding:"12px 16px",background:"var(--surface-2)",borderRadius:10}}>
        <Icon name="people" size={16}/>
        <span style={{fontSize:13,color:"var(--muted)",flex:1}}>Portions</span>
        <button onClick={()=>setPortions(p=>Math.max(1,p-1))} style={{width:28,height:28,borderRadius:"50%",background:"var(--border)",border:"none",color:"var(--text)",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
        <span style={{fontSize:16,fontWeight:700,color:"var(--text)",minWidth:24,textAlign:"center"}}>{portions}</span>
        <button onClick={()=>setPortions(p=>p+1)} style={{width:28,height:28,borderRadius:"50%",background:"var(--border)",border:"none",color:"var(--text)",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
      </div>

      <div className="recipe-detail-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24}}>
        {/* Ingredients */}
        <div>
          <h5 style={{color:"var(--accent)",fontSize:11,fontWeight:700,marginBottom:12,marginTop:0}}>Ingrédients</h5>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {scaled.map((ing,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)"}}>
                <span style={{fontSize:13,color:"var(--text)"}}>{ing.name}</span>
                <span style={{fontSize:13,color:"var(--muted)",marginLeft:8,whiteSpace:"nowrap"}}>{ing.scalable?(ing.displayQty||ing.qty):""} {ing.unit}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Instructions */}
        <div>
          <h5 style={{color:"var(--accent)",fontSize:11,fontWeight:700,marginBottom:12,marginTop:0}}>Instructions</h5>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {instructions.length===0&&(
              <div style={{fontSize:13,color:"var(--subtle)",fontStyle:"italic",padding:"8px 0"}}>
                Aucune instruction enregistrée. Utilise Modifier pour en ajouter.
              </div>
            )}
            {instructions.map((step,i)=>(
              <div key={i} style={{display:"flex",gap:10}}>
                <span style={{fontSize:11,fontWeight:700,color:"var(--accent)",minWidth:20,marginTop:2}}>{i+1}.</span>
                <span style={{fontSize:13,color:"var(--text-2)",lineHeight:1.6}}>{step.replace(/^\d+\.\s*/,"")}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Zone de notes personnelles */}
      <div style={{marginTop:24,borderTop:"1px solid var(--border)",paddingTop:16}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <span style={{fontSize:11,fontWeight:700,color:"var(--accent)"}}>Notes personnelles</span>
          {savingComment&&<span style={{fontSize:11,color:"var(--subtle)"}}>Sauvegarde...</span>}
          {!savingComment&&commentaires&&<span style={{fontSize:11,color:"var(--success)"}}>✓ Sauvegardé</span>}
        </div>
        <textarea
          value={commentaires}
          onChange={e=>{
            const val=e.target.value;
            setCommentaires(val);
            // Autosave avec debounce 1.5s
            if(commentTimer) clearTimeout(commentTimer);
            const t=setTimeout(async()=>{
              setSavingComment(true);
              await notionUpdate(recette.id,{"Commentaires":nText(val)});
              setSavingComment(false);
            },1500);
            setCommentTimer(t);
          }}
          placeholder="Ajoute tes astuces, variantes, retours d'expérience…"
          rows={3}
          style={{width:"100%",padding:"10px 12px",background:"var(--bg)",border:"1px solid var(--border)",borderRadius:10,fontSize:13,color:"var(--text)",fontFamily:"inherit",resize:"vertical",lineHeight:1.6,outline:"none"}}
        />
      </div>

      {/* Actions */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:16}}>
        <button onClick={()=>setCookingMode(true)} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px",background:"var(--accent)",border:"none",borderRadius:10,color:"#fff",cursor:"pointer",fontWeight:700,fontSize:13}}>
          <Icon name="chef" size={16}/> Cuisiner
        </button>
        <button onClick={handleAddToCourses} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,color:"var(--muted)",cursor:"pointer",fontWeight:600,fontSize:13}}>
          <Icon name="cart" size={15}/> Courses
        </button>
        <button onClick={()=>onAddToPlanning(recette,portions,"queue")} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px",background:"var(--surface)",border:"1px solid var(--accent)",borderRadius:10,color:"var(--accent)",cursor:"pointer",fontWeight:600,fontSize:13}}>
          <Icon name="queue" size={15}/> File d'attente
        </button>
        <button onClick={()=>onAddToPlanning(recette,portions,"date")} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px",background:"var(--accent)",border:"none",borderRadius:10,color:"#fff",cursor:"pointer",fontWeight:600,fontSize:13}}>
          <Icon name="calendar" size={15}/> Planifier
        </button>
        <button onClick={startEdit} style={{gridColumn:"1 / -1",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,color:"var(--muted)",cursor:"pointer",fontWeight:600,fontSize:13}}>
          <Icon name="edit" size={15}/> Modifier la recette
        </button>
      </div>

      {/* Suppression (utile pour doublons) */}
      {onDelete&&(
        <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid var(--surface-2)"}}>
          {!confirmDelete?(
            <button onClick={()=>setConfirmDelete(true)} style={{width:"100%",padding:"8px",background:"transparent",border:"1px solid #FECACA",borderRadius:10,color:"var(--danger)",fontSize:12,fontWeight:600,cursor:"pointer"}}>
              Supprimer cette recette
            </button>
          ):(
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <span style={{fontSize:12,color:"var(--muted)",flex:1}}>Supprimer définitivement ?</span>
              <button onClick={()=>setConfirmDelete(false)} style={{padding:"8px 14px",background:"var(--surface-2)",border:"none",borderRadius:10,color:"var(--text-2)",fontSize:12,fontWeight:600,cursor:"pointer"}}>Annuler</button>
              <button disabled={deleting} onClick={async()=>{
                setDeleting(true);
                try{
                  await fetch(`/api/notion?path=/v1/pages/${recette.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({archived:true})});
                  toast("Recette supprimée ✓");
                  onDelete(recette.id);
                  onClose();
                }catch(e){logError("deleteRecette",e,{id:recette.id});toast("Erreur suppression");}
                setDeleting(false);
              }} style={{padding:"8px 14px",background:"#DC2626",border:"none",borderRadius:10,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",opacity:deleting?0.5:1}}>
                {deleting?"...":"Supprimer"}
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
