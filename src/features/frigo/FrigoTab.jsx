import { loadWithCache } from "../../lib/data";
import { fmtJour, joursAvant, lienPlanning, repasLiables } from "../../lib/frigo";
import { RepasPicker } from "./RepasPicker";
import { mettreEnFile } from "../../lib/liens";
import { useCallback, useEffect, useRef, useState } from "react";
import { peekCached, setCache } from "../../lib/cache";
import { FRIGO_JSON_PROMPT, claudeVision } from "../../lib/claude";
import { DB_FRIGO } from "../../lib/constants";
import { localISO } from "../../lib/dates";
import { logError } from "../../lib/errors";
import { nCheck, nDate, nSel, nText, nTitle, notionCreate, notionUpdate } from "../../lib/notion";
import { Icon } from "../../ui/Icon";
import { inputStyle } from "../../ui/primitives";
import { ZoomableImage } from "../../ui/ZoomableImage";

// ── App ───────────────────────────────────────────────────────────────────────


export function FrigoTab({toast,onCookWith}){
  const [items,setItems]=useState(()=>peekCached("frigo")||[]);
  const [loading,setLoading]=useState(false);
  const [showCapture,setShowCapture]=useState(false);
  const [analyzing,setAnalyzing]=useState(false);
  const [draft,setDraft]=useState(null); // recette extraite en attente de confirmation
  const [preview,setPreview]=useState(null);
  const [editItem,setEditItem]=useState(null); // item en cours d'édition
  const [planning,setPlanning]=useState(()=>peekCached("planning")||[]);
  const [recettes,setRecettes]=useState(()=>peekCached("recettes")||[]);
  const camRef=useRef(null);
  const fileRef=useRef(null);

  // Dernière version connue tout de suite, rafraîchie en arrière-plan si besoin.
  const load=useCallback(async(force)=>{
    const {needSpinner,promise}=loadWithCache("frigo",{force,onCached:setItems,onFresh:setItems,onError:e=>logError("frigoLoad",e)});
    if(needSpinner)setLoading(true);
    await promise;
    setLoading(false);
  },[]);
  useEffect(()=>{load();},[load]);
  // Planning chargé pour le lien optionnel article ↔ repas (alerte si planifié après péremption).
  useEffect(()=>{loadWithCache("planning",{onCached:setPlanning,onFresh:setPlanning,onError:e=>logError("frigoPlanningLoad",e)});},[]);
  const options=repasLiables(planning,localISO(new Date()));
  useEffect(()=>{loadWithCache("recettes",{onCached:setRecettes,onFresh:setRecettes,onError:e=>logError("frigoRecettesLoad",e)});},[]);
  const lienSelect=(article,value,onChange)=><RepasPicker article={article} value={value} onChange={onChange} repas={options} recettes={recettes}/>;

  // Transforme le choix en ID de repas ; une recette pas encore planifiée est ajoutée à la file d'attente.
  const resoudreLien=async(lien)=>{
    if(!lien)return"";
    if(lien.planningId)return lien.planningId;
    const entry=await mettreEnFile(lien.recette);
    setPlanning(peekCached("planning"));
    toast(`"${lien.recette.nom}" ajouté à la file d'attente`);
    return entry.id;
  };

  const handleFile=async(file)=>{
    if(!file||!file.type.startsWith("image/"))return;
    setShowCapture(true);
    setPreview(URL.createObjectURL(file));
    setAnalyzing(true);
    const reader=new FileReader();
    reader.onload=async(e)=>{
      const base64=e.target.result.split(",")[1];
      const r=await claudeVision(FRIGO_JSON_PROMPT,base64,file.type);
      if(r?.article){
        setDraft({
          article:r.article||"",
          proteine:["Viande","Poisson","Volaille","Autre"].includes(r.proteine)?r.proteine:"Autre",
          forme:["Filet","Cuisses","Pavé","Steak","Entier","Haché","Tranches","Autre"].includes(r.forme)?r.forme:"Autre",
          peremption:r.date_peremption||"",
          quantite:r.quantite||"",
          lien:null,
        });
      } else {
        setDraft({article:"",proteine:"Autre",forme:"Autre",peremption:"",quantite:"",lien:null});
        toast("Lecture incomplète — complète à la main");
      }
      setAnalyzing(false);
    };
    reader.readAsDataURL(file);
  };

  const saveDraft=async()=>{
    if(!draft?.article)return;
    const today=localISO(new Date());
    try{
      const planningId=await resoudreLien(draft.lien);
      const r=await notionCreate(DB_FRIGO,{
        "Article":nTitle(draft.article),
        "Protéine":nSel(draft.proteine),
        "Forme":nSel(draft.forme),
        ...(draft.peremption?{"Date de péremption":nDate(draft.peremption)}:{}),
        "Quantité":nText(draft.quantite||""),
        "Planning ID":nText(planningId),
        "Ajouté le":nDate(today),
        "Consommé":nCheck(false),
      });
      if(r?.object==="error"){toast("Erreur enregistrement");return;}
      toast(draft.article+" ajouté au frigo ✓");
      setShowCapture(false);setDraft(null);setPreview(null);
      load(true);
    }catch(e){logError("frigoSave",e);toast("Erreur");}
  };

  const markConsumed=async(item)=>{
    const updated=items.filter(x=>x.id!==item.id);
    setItems(updated);setCache("frigo",updated);
    try{await notionUpdate(item.id,{"Consommé":nCheck(true)});}
    catch(e){logError("frigoConsume",e,{item:item.article});}
  };

  const saveEdit=async()=>{
    if(!editItem?.article)return;
    try{
      const planningId=await resoudreLien(editItem.lien);
      await notionUpdate(editItem.id,{
        "Article":nTitle(editItem.article),
        "Protéine":nSel(editItem.proteine),
        "Forme":nSel(editItem.forme),
        ...(editItem.peremption?{"Date de péremption":nDate(editItem.peremption)}:{"Date de péremption":nDate(null)}),
        "Quantité":nText(editItem.quantite||""),
        "Planning ID":nText(planningId),
      });
      toast("Modifié ✓");
      setEditItem(null);
      load(true);
    }catch(e){logError("frigoEdit",e,{item:editItem.article});toast("Erreur");}
  };

  const deleteItem=async(item)=>{
    const updated=items.filter(x=>x.id!==item.id);
    setItems(updated);setCache("frigo",updated);
    setEditItem(null);
    try{await fetch(`/api/notion?path=/v1/pages/${item.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({archived:true})});}
    catch(e){logError("frigoDelete",e,{item:item.article});}
  };

  const badge=(j)=>{
    if(j==null)return{txt:"pas de date",bg:"#F5F4F2",fg:"#78716C"};
    if(j<0)return{txt:"périmé",bg:"#FEF2F2",fg:"#DC2626"};
    if(j===0)return{txt:"aujourd'hui",bg:"#FEF2F2",fg:"#DC2626"};
    if(j===1)return{txt:"demain",bg:"#FBEDE4",fg:"#C2622D"};
    if(j<=3)return{txt:`${j} jours`,bg:"#FBEDE4",fg:"#C2622D"};
    return{txt:`${j} jours`,bg:"#ECFDF5",fg:"#059669"};
  };

  return(
    <div style={{maxWidth:640,margin:"0 auto"}}>
      <input ref={camRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
      <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>

      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <button onClick={()=>camRef.current?.click()} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,height:48,background:"var(--accent)",border:"none",borderRadius:14,color:"#fff",fontWeight:600,fontSize:15,cursor:"pointer",fontFamily:"inherit"}}><Icon name="camera" size={18}/>Photographier un produit</button>
        <button onClick={()=>fileRef.current?.click()} style={{width:48,height:48,justifyContent:"center",background:"var(--surface)",border:"none",boxShadow:"0 0 0 1px rgba(28,25,23,0.08)",borderRadius:14,color:"var(--text-2)",cursor:"pointer",display:"flex",alignItems:"center"}} aria-label="Choisir une photo dans la galerie"><Icon name="image" size={18}/></button>
      </div>

      {items.length===0&&!loading&&(
        <div style={{textAlign:"center",padding:"40px 20px",color:"var(--subtle)"}}>
          <div style={{width:56,height:56,borderRadius:999,background:"var(--surface-2)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px",color:"var(--subtle)"}}><Icon name="fridge" size={24}/></div>
          <p style={{fontSize:14}}>Aucun produit enregistré.<br/>Photographie tes viandes, poissons et volailles pour suivre les dates de péremption.</p>
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {items.map(item=>{
          const j=joursAvant(item.peremption);const b=badge(j);
          const lien=lienPlanning(item,planning);
          return(
            <div key={item.id} className="card" style={{padding:"14px 14px 10px"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:16,fontWeight:600,color:"var(--text)",letterSpacing:"-0.01em"}}>{item.article}{item.forme&&item.forme!=="Autre"?<span style={{fontWeight:400,color:"var(--muted)"}}> · {item.forme}</span>:""}</div>
                  <div style={{fontSize:12,color:"var(--subtle)",marginTop:2}}>{item.proteine}{item.quantite?` · ${item.quantite}`:""}</div>
                </div>
                <span style={{padding:"4px 10px",background:b.bg,color:b.fg,borderRadius:999,fontSize:12,fontWeight:700,whiteSpace:"nowrap"}}>{b.txt}</span>
              </div>
              {lien&&(
                <div style={{marginTop:8,fontSize:12,fontWeight:600,padding:"6px 10px",borderRadius:10,
                  background:lien.statut==="apres"?"#FEF2F2":"var(--surface-2)",color:lien.statut==="apres"?"#DC2626":"var(--text-2)"}}>
                  {lien.statut==="apres"?"⚠️ ":"🍳 "}{lien.entry.recette||lien.entry.repas}
                  {lien.statut==="file"?" · en file d'attente":` · prévu ${fmtJour(lien.entry.date)}`}
                  {lien.statut==="apres"&&<span style={{fontWeight:400}}> — après la péremption ({fmtJour(item.peremption)})</span>}
                </div>
              )}
              <div style={{display:"flex",gap:6,marginTop:10,alignItems:"center"}}>
                <button onClick={()=>setEditItem({...item,lien:item.planningId?{planningId:item.planningId}:null})} aria-label={`Modifier ${item.article}`} className="icon-btn"><Icon name="edit" size={16}/></button>
                <button onClick={()=>onCookWith&&onCookWith(item)} className="soft-btn" style={{flex:1,color:"var(--accent)",background:"var(--accent-soft)"}}><Icon name="chef" size={15}/>Cuisiner avec</button>
                <button onClick={()=>markConsumed(item)} className="soft-btn" style={{flex:1}}><Icon name="check" size={15}/>Consommé</button>
              </div>
            </div>
          );
        })}
      </div>

      {showCapture&&(
        <div style={{position:"fixed",inset:0,zIndex:2500,background:"rgba(28,25,23,0.6)",display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
          <div className="modal-inner" style={{background:"var(--surface)",borderRadius:"24px 24px 0 0",maxWidth:520,width:"100%",maxHeight:"92dvh",overflow:"hidden",display:"flex",flexDirection:"column",padding:"20px 20px 0"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexShrink:0}}>
              <h3 style={{margin:0,fontSize:17,fontWeight:700,letterSpacing:"-0.02em"}}>Nouveau produit</h3>
              <button onClick={()=>{setShowCapture(false);setDraft(null);setPreview(null);}} aria-label="Fermer" className="icon-btn"><Icon name="close" size={18}/></button>
            </div>
            {preview&&<div style={{flexShrink:0,marginBottom:12}}><ZoomableImage src={preview} alt="Photo du produit"/></div>}
            <div style={{flex:1,minHeight:0,overflowY:"auto",paddingBottom:"calc(20px + env(safe-area-inset-bottom))"}}>
            {analyzing?(
              <div style={{textAlign:"center",padding:"20px",color:"var(--muted)",fontSize:14}}>Lecture de l'étiquette…</div>
            ):draft?(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div><label style={{fontSize:13,fontWeight:600,color:"var(--text-2)"}}>Article</label><input value={draft.article} onChange={e=>setDraft(d=>({...d,article:e.target.value}))} style={{...inputStyle,marginTop:4}}/></div>
                <div style={{display:"flex",gap:8}}>
                  <div style={{flex:1}}><label style={{fontSize:13,fontWeight:600,color:"var(--text-2)"}}>Protéine</label><select value={draft.proteine} onChange={e=>setDraft(d=>({...d,proteine:e.target.value}))} style={{...inputStyle,marginTop:4}}>{["Viande","Poisson","Volaille","Autre"].map(o=><option key={o}>{o}</option>)}</select></div>
                  <div style={{flex:1}}><label style={{fontSize:13,fontWeight:600,color:"var(--text-2)"}}>Forme</label><select value={draft.forme} onChange={e=>setDraft(d=>({...d,forme:e.target.value}))} style={{...inputStyle,marginTop:4}}>{["Filet","Cuisses","Pavé","Steak","Entier","Haché","Tranches","Autre"].map(o=><option key={o}>{o}</option>)}</select></div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <div style={{flex:1}}><label style={{fontSize:13,fontWeight:600,color:"var(--text-2)"}}>Péremption</label><input type="date" value={draft.peremption} onChange={e=>setDraft(d=>({...d,peremption:e.target.value}))} style={{...inputStyle,marginTop:4}}/></div>
                  <div style={{flex:1}}><label style={{fontSize:13,fontWeight:600,color:"var(--text-2)"}}>Quantité</label><input value={draft.quantite} onChange={e=>setDraft(d=>({...d,quantite:e.target.value}))} placeholder="500g" style={{...inputStyle,marginTop:4}}/></div>
                </div>
                {lienSelect(draft.article,draft.lien,v=>setDraft(d=>({...d,lien:v})))}
                {!draft.peremption&&<p style={{fontSize:12,color:"var(--accent)",margin:0}}>⚠️ Date non lue — saisis-la pour activer le suivi de péremption.</p>}
                <button onClick={saveDraft} disabled={!draft.article} style={{width:"100%",padding:"12px",background:draft.article?"var(--accent)":"var(--border)",border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:14,cursor:draft.article?"pointer":"default",marginTop:4}}>Ajouter au frigo</button>
              </div>
            ):null}
            </div>
          </div>
        </div>
      )}
      {editItem&&(
        <div style={{position:"fixed",inset:0,zIndex:2600,background:"rgba(28,25,23,0.6)",display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
          <div className="modal-inner" style={{background:"var(--surface)",borderRadius:"24px 24px 0 0",maxWidth:520,width:"100%",maxHeight:"90vh",overflow:"auto",padding:20}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <h3 style={{margin:0,fontSize:17,fontWeight:700,letterSpacing:"-0.02em"}}>Modifier</h3>
              <button onClick={()=>setEditItem(null)} aria-label="Fermer" className="icon-btn"><Icon name="close" size={18}/></button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <div><label style={{fontSize:13,fontWeight:600,color:"var(--text-2)"}}>Article</label><input value={editItem.article} onChange={e=>setEditItem(d=>({...d,article:e.target.value}))} style={{...inputStyle,marginTop:4}}/></div>
              <div style={{display:"flex",gap:8}}>
                <div style={{flex:1}}><label style={{fontSize:13,fontWeight:600,color:"var(--text-2)"}}>Protéine</label><select value={editItem.proteine} onChange={e=>setEditItem(d=>({...d,proteine:e.target.value}))} style={{...inputStyle,marginTop:4}}>{["Viande","Poisson","Volaille","Autre"].map(o=><option key={o}>{o}</option>)}</select></div>
                <div style={{flex:1}}><label style={{fontSize:13,fontWeight:600,color:"var(--text-2)"}}>Forme</label><select value={editItem.forme} onChange={e=>setEditItem(d=>({...d,forme:e.target.value}))} style={{...inputStyle,marginTop:4}}>{["Filet","Cuisses","Pavé","Steak","Entier","Haché","Tranches","Autre"].map(o=><option key={o}>{o}</option>)}</select></div>
              </div>
              <div style={{display:"flex",gap:8}}>
                <div style={{flex:1}}><label style={{fontSize:13,fontWeight:600,color:"var(--text-2)"}}>Péremption</label><input type="date" value={editItem.peremption||""} onChange={e=>setEditItem(d=>({...d,peremption:e.target.value}))} style={{...inputStyle,marginTop:4}}/></div>
                <div style={{flex:1}}><label style={{fontSize:13,fontWeight:600,color:"var(--text-2)"}}>Quantité</label><input value={editItem.quantite||""} onChange={e=>setEditItem(d=>({...d,quantite:e.target.value}))} placeholder="500g" style={{...inputStyle,marginTop:4}}/></div>
              </div>
              {lienSelect(editItem.article,editItem.lien,v=>setEditItem(d=>({...d,lien:v})))}
              <button onClick={saveEdit} disabled={!editItem.article} style={{width:"100%",padding:"12px",background:editItem.article?"var(--accent)":"var(--border)",border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:14,cursor:editItem.article?"pointer":"default",marginTop:4}}>Enregistrer</button>
              <button onClick={()=>deleteItem(editItem)} style={{width:"100%",padding:"10px",background:"transparent",border:"1px solid #FECACA",borderRadius:10,color:"var(--danger)",fontSize:13,fontWeight:600,cursor:"pointer"}}>Supprimer du frigo</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
