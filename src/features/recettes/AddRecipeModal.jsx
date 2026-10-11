import { useRef, useState } from "react";
import { setCache } from "../../lib/cache";
import { RECIPE_JSON_PROMPT, claudeJSON, claudeVision, extractRecipe } from "../../lib/claude";
import { DB_RECETTES, DEFAULT_PORTIONS, EMPTY_FORM } from "../../lib/constants";
import { logError } from "../../lib/errors";
import { nNum, nSel, nText, nTitle, nUrl, notionCreate, notionQuery } from "../../lib/notion";
import { Icon } from "../../ui/Icon";
import { Field, Modal, btnDisabled, btnPrimary, inputStyle, InlineSpinner } from "../../ui/primitives";

// ── Recipe Form ───────────────────────────────────────────────────────────────
export function RecipeForm({form,setForm,saving,onSave,analyzing,duplicateWarning}){
  const isReady=form.nom&&!analyzing&&!saving;
  return(
    <>
      {duplicateWarning&&<div style={{marginBottom:12,padding:"10px 14px",background:"#FEF2F2",border:"1px solid #FCA5A5",borderRadius:10,fontSize:13,color:"var(--danger)",fontWeight:600}}>⚠️ "{form.nom}" existe déjà dans tes recettes — pas de doublon créé si tu sauvegardes.</div>}
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
      <button onClick={onSave} disabled={!isReady} style={isReady?btnPrimary:btnDisabled}>{saving?"Enregistrement…":analyzing?"Analyse…":"Sauvegarder"}</button>
    </>
  );
}

// ── Add Recipe Modal ──────────────────────────────────────────────────────────
export const METHODS=[
  {id:"manual",label:"Saisie manuelle",icon:"edit",color:"#C2622D"},
  {id:"photo",label:"Photo",icon:"camera",color:"#F59E0B"},
  {id:"url",label:"URL",icon:"link",color:"#10B981"},
  {id:"ai",label:"Générer avec l'IA",icon:"sparkle",color:"#EC4899"},
  {id:"ingredients",label:"Par ingrédients",icon:"chef",color:"#14B8A6"},
];

export function AddRecipeModal({onClose,onSaved}){
  const [method,setMethod]=useState(null);
  const [form,setForm]=useState({...EMPTY_FORM});
  const [saving,setSaving]=useState(false);
  const [analyzing,setAnalyzing]=useState(false);
  const [photoPreview,setPhotoPreview]=useState(null);
  const [url,setUrl]=useState("");
  const [prompt,setPrompt]=useState("");
  const fileInputRef=useRef(null);
  const cameraInputRef=useRef(null);
  const [photoQueue,setPhotoQueue]=useState([]); // files en attente de review
  const [queueTotal,setQueueTotal]=useState(0);
  const [queueDone,setQueueDone]=useState(0);
  const [duplicateNom,setDuplicateNom]=useState(null); // nom déjà en base, détecté à l'analyse

  // Vérifie tout de suite (dès l'analyse) si ce nom existe déjà dans Notion,
  // au lieu d'attendre le clic sur Sauvegarder.
  const checkDuplicate=async(nom)=>{
    if(!nom){setDuplicateNom(null);return;}
    try{
      const existing=await notionQuery(DB_RECETTES,{property:"Nom",title:{equals:nom}});
      setDuplicateNom(existing.results?.length>0?nom:null);
    }catch(e){
      // Silencieux : le dédoublonnage reste appliqué côté save() en filet de sécurité.
      logError("AddRecipeModal.checkDuplicate",e,{nom});
    }
  };

  const extractOneFile=async(file)=>{
    if(!file||!file.type.startsWith("image/"))return;
    setForm({...EMPTY_FORM});
    setDuplicateNom(null);
    setPhotoPreview(URL.createObjectURL(file));
    setAnalyzing(true);
    const reader=new FileReader();
    reader.onload=async(e)=>{
      const base64=e.target.result.split(",")[1];
      const result=await claudeVision(RECIPE_JSON_PROMPT,base64,file.type);
      if(result){
        setForm(f=>({...f,...result,tags:Array.isArray(result.tags)?result.tags:f.tags,photoUrl:f.photoUrl}));
        await checkDuplicate(result.nom);
      }
      setAnalyzing(false);
    };
    reader.readAsDataURL(file);
  };

  // Reçoit 1..N fichiers. Traite le premier, met les autres en file d'attente.
  const handlePhotoFiles=async(files)=>{
    const imgs=Array.from(files||[]).filter(f=>f.type.startsWith("image/"));
    if(imgs.length===0)return;
    setQueueTotal(imgs.length);
    setQueueDone(0);
    setPhotoQueue(imgs.slice(1));
    await extractOneFile(imgs[0]);
  };

  // Compat : ancien nom utilisé ailleurs (caméra, drop simple)
  const handlePhotoFile=(file)=>handlePhotoFiles(file?[file]:[]);

  // Passe à la photo suivante de la file (après save ou skip)
  const advanceQueue=async()=>{
    setQueueDone(d=>d+1);
    if(photoQueue.length>0){
      const [next,...rest]=photoQueue;
      setPhotoQueue(rest);
      setForm({...EMPTY_FORM});
      setPhotoPreview(null);
      await extractOneFile(next);
    } else {
      // Fin de la file
      setPhotoPreview(null);
      setForm({...EMPTY_FORM});
      setQueueTotal(0);setQueueDone(0);
      onSaved("Lot terminé ✓");
      onClose();
    }
  };

  const fetchFromUrl=async()=>{
    if(!url)return;
    setAnalyzing(true);
    setDuplicateNom(null);
    const result=await extractRecipe(url);
    if(result){
      setForm(f=>({...f,...result,tags:Array.isArray(result.tags)?result.tags:f.tags,sourceUrl:url,photoUrl:result.image||f.photoUrl}));
      await checkDuplicate(result.nom);
    }else{
      alert("Impossible d'extraire la recette depuis cette URL (timeout ou erreur). Réessaie, ou utilise la saisie manuelle.");
    }
    setAnalyzing(false);
  };

  const generateFromPrompt=async()=>{
    if(!prompt)return;
    setAnalyzing(true);
    setDuplicateNom(null);
    const isIng=method==="ingredients";
    const result=await claudeJSON("Tu es un chef cuisinier créatif français. Retourne UNIQUEMENT un JSON valide, sans backticks.",isIng?`L'utilisateur a ces ingrédients: "${prompt}". Propose une recette créative.\n\n${RECIPE_JSON_PROMPT}`:`Génère une recette pour: "${prompt}"\n\n${RECIPE_JSON_PROMPT}`);
    if(result){
      setForm(f=>({...f,...result,tags:Array.isArray(result.tags)?result.tags:f.tags}));
      await checkDuplicate(result.nom);
    }
    setAnalyzing(false);
  };

  const save=async()=>{
    setSaving(true);
    const r=await notionCreate(DB_RECETTES,{
      "Nom":nTitle(form.nom),"Catégorie":nSel(form.categorie),"Temps de préparation":nNum(form.temps),
      "Portions":nNum(form.portions||DEFAULT_PORTIONS),"Ingrédients":nText(form.ingredients),
      "Instructions":nText(form.instructions),"Note":nSel(form.note),
      "Likes":nNum(0),"Dislikes":nNum(0),"Fois cuisinée":nNum(0),
      ...(form.photoUrl?{"Photo":nUrl(form.photoUrl)}:{}),
      ...(form.sourceUrl?{"Source":nUrl(form.sourceUrl)}:{}),
    });
    setSaving(false);
    if(!r||r.object==="error"){
      logError("AddRecipeModal.save",new Error(r?.message||"Échec de l'enregistrement Notion"),{nom:form.nom});
      alert("Échec de l'enregistrement dans Notion : "+(r?.message||"erreur inconnue")+". Réessaie.");
      return;
    }
    if(r.object==="skip"){
      alert("\""+form.nom+"\" existe déjà dans tes recettes — pas de doublon créé.");
      if(queueTotal>1){
        // Mode lot : ne pas fermer, passer à la photo suivante
        await advanceQueue();
      } else {
        onClose();
      }
      return;
    }
    setCache("recettes",null);
    if(queueTotal>1){
      // Mode lot : passer à la photo suivante au lieu de fermer
      await advanceQueue();
      return;
    }
    onSaved("Recette ajoutée ✓");
    onClose();
  };

  if(!method){
    return(<Modal title="Nouvelle recette" onClose={onClose}><p style={{color:"var(--muted)",fontSize:13,marginBottom:20,marginTop:0}}>Comment veux-tu ajouter cette recette ?</p><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>{METHODS.map(m=>(<button key={m.id} onClick={()=>setMethod(m.id)} style={{padding:"18px 12px",background:"var(--surface-2)",border:"1px solid var(--border)",borderRadius:14,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:8}} onMouseEnter={e=>{e.currentTarget.style.borderColor=m.color;e.currentTarget.style.background=`${m.color}11`;}} onMouseLeave={e=>{e.currentTarget.style.borderColor="#ECE9E6";e.currentTarget.style.background="#F5F4F2";}}><div style={{width:40,height:40,borderRadius:"50%",background:`${m.color}22`,display:"flex",alignItems:"center",justifyContent:"center",color:m.color}}><Icon name={m.icon} size={18}/></div><span style={{fontSize:12,fontWeight:600,color:"var(--text)",textAlign:"center"}}>{m.label}</span></button>))}</div></Modal>);
  }

  const backBtn=<button onClick={()=>setMethod(null)} style={{background:"none",border:"none",color:"var(--accent)",fontSize:12,cursor:"pointer",marginBottom:16,padding:0}}>← Changer de méthode</button>;

  if(method==="photo"){
    return(<Modal title="Recette depuis une photo" onClose={onClose} wide><input ref={fileInputRef} type="file" accept="image/*" multiple style={{display:"none"}} onChange={e=>handlePhotoFiles(e.target.files)}/><input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handlePhotoFile(e.target.files[0])}/>{backBtn}{queueTotal>1&&<div style={{marginBottom:12,padding:"10px 14px",background:"var(--accent-soft)",border:"1px solid transparent",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}><span style={{fontSize:13,fontWeight:700,color:"var(--accent)"}}>📚 Lot : recette {queueDone+1} sur {queueTotal}</span><span style={{fontSize:11,color:"#9A6A4A"}}>{photoQueue.length} en attente</span></div>}<div onClick={()=>fileInputRef.current?.click()} onDrop={e=>{e.preventDefault();handlePhotoFile(e.dataTransfer.files[0]);}} onDragOver={e=>e.preventDefault()} style={{marginBottom:20,borderRadius:14,overflow:"hidden",cursor:"pointer",border:`2px dashed ${photoPreview?"#F59E0B":"var(--border)"}`,background:"var(--surface-2)"}}>{photoPreview?(<div style={{position:"relative"}}><img src={photoPreview} alt="preview" style={{width:"100%",height:180,objectFit:"cover",display:"block"}}/>{analyzing&&<div style={{position:"absolute",inset:0,background:"rgba(28,25,23,0.6)",display:"flex",alignItems:"center",justifyContent:"center",gap:10,color:"#FFFFFF"}}><InlineSpinner size={20}/><span style={{fontSize:14,fontWeight:600}}>Analyse…</span></div>}{!analyzing&&<div style={{position:"absolute",bottom:8,left:8,background:"#4ADE80",borderRadius:999,padding:"4px 12px",fontSize:11,fontWeight:700,color:"#022c22"}}>✓ Recette reconnue</div>}</div>):(<div style={{padding:32,display:"flex",flexDirection:"column",alignItems:"center",gap:8,textAlign:"center"}}><div style={{width:48,height:48,borderRadius:"50%",background:"var(--surface-2)",display:"flex",alignItems:"center",justifyContent:"center",color:"#F59E0B"}}><Icon name="camera" size={22}/></div><div style={{fontSize:13,fontWeight:600,color:"var(--muted)"}}>Photo du plat ou livre de recette</div></div>)}</div><div style={{display:"flex",gap:8,marginBottom:20}}><button onClick={e=>{e.stopPropagation();cameraInputRef.current?.click();}} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"12px",background:"var(--accent)",border:"none",borderRadius:10,color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer"}}><Icon name="camera" size={16}/> Prendre une photo</button><button onClick={e=>{e.stopPropagation();fileInputRef.current?.click();}} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"12px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,color:"var(--text-2)",fontWeight:600,fontSize:13,cursor:"pointer"}}>🖼️ Choisir des fichiers</button></div>{(photoPreview&&!analyzing)&&<RecipeForm form={form} setForm={setForm} saving={saving} onSave={save} analyzing={analyzing}/>}{queueTotal>1&&!analyzing&&photoPreview&&<button onClick={advanceQueue} style={{width:"100%",marginTop:8,padding:"10px",background:"transparent",border:"1px solid var(--border)",borderRadius:10,color:"var(--muted)",fontSize:13,fontWeight:600,cursor:"pointer"}}>⏭ Ignorer cette photo</button>}</Modal>);
  }
  if(method==="url"){
    return(<Modal title="Recette depuis une URL" onClose={onClose} wide>{backBtn}<Field label="URL de la recette"><div style={{display:"flex",gap:8}}><input style={{...inputStyle,flex:1}} value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://www.marmiton.org/..."/><button onClick={fetchFromUrl} disabled={!url||analyzing} style={{padding:"10px 16px",background:url&&!analyzing?"#10B981":"var(--border)",border:"none",borderRadius:10,color:url&&!analyzing?"#fff":"var(--text-2)",fontWeight:600,fontSize:13,cursor:url&&!analyzing?"pointer":"default",whiteSpace:"nowrap"}}>{analyzing?<InlineSpinner/>:"Extraire"}</button></div></Field>{form.nom&&<RecipeForm form={form} setForm={setForm} saving={saving} onSave={save} analyzing={analyzing} duplicateWarning={duplicateNom&&duplicateNom===form.nom}/>}</Modal>);
  }
  if(method==="ai"||method==="ingredients"){
    const color=method==="ai"?"#EC4899":"#14B8A6";
    return(<Modal title={method==="ai"?"Générer avec l'IA":"Recherche par ingrédients"} onClose={onClose} wide>{backBtn}<Field label={method==="ai"?"Décris la recette":"Quels ingrédients as-tu ?"}><div style={{display:"flex",flexDirection:"column",gap:8}}><textarea style={{...inputStyle,minHeight:80,resize:"vertical"}} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={method==="ai"?"Ex: pasta crémeuse au saumon fumé…":"Ex: j'ai des courgettes, du parmesan…"}/><button onClick={generateFromPrompt} disabled={!prompt||analyzing} style={{padding:"11px 16px",background:prompt&&!analyzing?color:"var(--border)",border:"none",borderRadius:10,color:prompt&&!analyzing?"#fff":"var(--text-2)",fontWeight:600,fontSize:13,cursor:prompt&&!analyzing?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>{analyzing?<><InlineSpinner/>Génération...</>:<><Icon name="sparkle" size={14}/>Générer</>}</button></div></Field>{form.nom&&<RecipeForm form={form} setForm={setForm} saving={saving} onSave={save} analyzing={analyzing} duplicateWarning={duplicateNom&&duplicateNom===form.nom}/>}</Modal>);
  }
  return(<Modal title="Saisie manuelle" onClose={onClose} wide>{backBtn}<RecipeForm form={form} setForm={setForm} saving={saving} onSave={save} analyzing={false}/></Modal>);
}
