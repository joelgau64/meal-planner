import { useEffect, useMemo, useState } from "react";
import { getCached, peekCached, setCache } from "../../lib/cache";
import { CAT_COLORS, DB_COURSES, DB_INGREDIENTS } from "../../lib/constants";
import { loadWithCache } from "../../lib/data";
import { buildIndex, expandCompound, lightKey, resolveIngredient, splitAliases } from "../../lib/dictionnaire";
import { combineQuantities, parseOneIngredient, splitIngredientLines } from "../../lib/ingredients";
import { nCheck, nSel, nText, nTitle, notionCreate, notionUpdate } from "../../lib/notion";
import { Icon } from "../../ui/Icon";
import { Modal, btnDisabled, btnPrimary } from "../../ui/primitives";

const CATEGORIES=Object.keys(CAT_COLORS);

// ── Génération de la liste de courses ────────────────────────────────────────
// Chaque ligne d'ingrédient est éclatée ("sel et poivre"), parsée, nettoyée puis
// résolue dans le dictionnaire Notion « Ingrédients ». Les articles inconnus sont
// marqués « nouveau » et s'apprennent en un tap (créer / rattacher à un existant).
export function CoursesModal({onClose,coursesSelection,setCoursesSelection,recettes,groupMode,setGroupMode,toast}){
  const [generatingCourses,setGeneratingCourses]=useState(false);
  const [dict,setDict]=useState(()=>peekCached("ingredients")||[]);
  const [dictError,setDictError]=useState(false);
  const [editKey,setEditKey]=useState(null);
  const [form,setForm]=useState({nom:"",categorie:"Épicerie",gardeManger:false,rattacher:""});
  const [saving,setSaving]=useState(false);
  const btnSmall={padding:"3px 10px",fontSize:11,fontWeight:600,border:"1px solid #ECE9E6",borderRadius:10,background:"#FFFFFF",color:"#57534E",cursor:"pointer"};

  useEffect(()=>{
    loadWithCache("ingredients",{onCached:setDict,onFresh:d=>{setDict(d);setDictError(false);},onError:()=>setDictError(true)});
  },[]);
  const index=useMemo(()=>buildIndex(dict),[dict]);

  const semaine=new Date().toLocaleDateString("fr-FR",{day:"numeric",month:"short"});

  // Construire liste aplatie d'ingrédients, résolus via le dictionnaire
  const buildIngredients=(selection,idx)=>{
    const list=[];
    for(const meal of selection){
      const recetteNom=meal.recette||meal.repas;
      const recetteData=recettes.find(r=>r.id===meal.recette_id||r.nom===recetteNom);
      if(!recetteData?.ingredients)continue;
      const lines=splitIngredientLines(recetteData.ingredients).flatMap(expandCompound);
      for(const parsed of lines.map(parseOneIngredient)){
        if(!parsed.name)continue;
        const r=resolveIngredient(parsed.name,idx);
        if(!r)continue; // rien d'achetable ("émincé", "pour servir"…)
        list.push({
          ...r,
          qty:parsed.qty,          // number|null
          unit:parsed.unit,        // unité canonique
          raw:parsed.qty!=null?`${parsed.qty} ${parsed.unit}`.trim():"", // quantité lisible (pour les sommes)
          source:parsed.name,      // nom brut, devient un alias si on apprend l'article
          recette:recetteNom,
          semaine:`Sem. du ${semaine}`,
        });
      }
    }
    // Agrégation par ingrédient résolu (id du dictionnaire, sinon clé nettoyée).
    const merged={};
    for(const item of list){
      const m=merged[item.key];
      if(!m){merged[item.key]={...item,recettes:[item.recette],sources:[item.source]};continue;}
      if(!m.recettes.includes(item.recette))m.recettes.push(item.recette);
      if(!m.sources.includes(item.source))m.sources.push(item.source);
      m.qtyDisplay=combineQuantities(
        {qty:m.qty??null,unit:m.unit||"",raw:m.qtyDisplay||m.raw},
        {qty:item.qty??null,unit:item.unit||"",raw:item.raw}
      );
      m.qty=null;m.unit="";
    }
    return Object.values(merged).map(m=>({
      ...m,
      qty:m.qtyDisplay||(m.qty!=null?`${m.qty} ${m.unit}`.trim():""),
      recette:m.recettes.join(", "),
    }));
  };
  // Sélection par défaut : tout coché sauf le garde-manger. On conserve les choix
  // déjà faits par l'utilisateur quand la liste est reconstruite.
  const withSelection=(items,prev)=>{
    const sel=Object.fromEntries((prev||[]).map(i=>[i.key,i.selected]));
    return items.map(i=>({...i,selected:i.key in sel?sel[i.key]:!i.gardeManger}));
  };
  const [ingsList,setIngsList]=useState(()=>withSelection(buildIngredients(coursesSelection.filter(m=>m.selected),index)));
  const rebuild=(selection,idx,keepPrev=true)=>setIngsList(prev=>withSelection(buildIngredients(selection.filter(m=>m.selected),idx),keepPrev?prev:null));

  // Le dictionnaire arrive (ou change) → on re-résout tout.
  useEffect(()=>{rebuild(coursesSelection,index);},[index]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalSel=ingsList.filter(i=>i.selected).length;
  const nbNew=ingsList.filter(i=>i.isNew).length;

  // Grouper
  const grouped={};
  ingsList.forEach((ing,idx)=>{
    const key=groupMode==="recette"?ing.recette:ing.categorie;
    if(!grouped[key])grouped[key]=[];
    grouped[key].push({...ing,_idx:idx});
  });
  const groups=Object.entries(grouped);

  const toggleRecette=(i)=>{
    const newSel=coursesSelection.map((x,j)=>j===i?{...x,selected:!x.selected}:x);
    setCoursesSelection(newSel);
    rebuild(newSel,index);
  };
  const toggleIng=(idx)=>setIngsList(l=>l.map((x,i)=>i===idx?{...x,selected:!x.selected}:x));
  const toggleGroup=(idxs,val)=>setIngsList(l=>l.map((x,i)=>idxs.has(i)?{...x,selected:val}:x));
  const toggleAllIngs=(val)=>setIngsList(l=>l.map(x=>({...x,selected:val})));
  const toggleAllRecettes=(val)=>{
    const newSel=coursesSelection.map(x=>({...x,selected:val}));
    setCoursesSelection(newSel);
    rebuild(newSel,index);
  };

  // ── Apprentissage du dictionnaire ──────────────────────────────────────────
  const openLearn=(ing)=>{
    setEditKey(ing.key);
    setForm({nom:ing.nom,categorie:ing.categorie,gardeManger:false,rattacher:""});
  };
  const updateDict=(next)=>{setCache("ingredients",next);setDict(next);setEditKey(null);};
  // Alias à mémoriser : les noms bruts rencontrés, sauf ceux déjà couverts par le nom.
  const aliasesFor=(ing,nom)=>[...new Set(ing.sources)].filter(a=>lightKey(a)!==lightKey(nom));

  const learnCreate=async(ing)=>{
    const nom=form.nom.trim();
    if(!nom)return;
    // Le nom existe déjà dans le dictionnaire → c'est un rattachement, pas une création.
    const existing=index.light.get(lightKey(nom));
    if(existing)return learnAttach(ing,existing);
    setSaving(true);
    try{
      const alias=aliasesFor(ing,nom).join(" | ");
      const created=await notionCreate(DB_INGREDIENTS,{
        "Nom":nTitle(nom),"Alias":nText(alias),"Catégorie":nSel(form.categorie),"Garde-manger":nCheck(form.gardeManger),
      });
      if(!created?.id)throw new Error(created?.message||"création refusée");
      updateDict([...dict,{id:created.id,nom,alias,categorie:form.categorie,gardeManger:form.gardeManger}]);
      toast(`📖 « ${nom} » ajouté au dictionnaire`);
    }catch(e){toast("❌ Dictionnaire : "+e.message);}
    setSaving(false);
  };
  const learnAttach=async(ing,target)=>{
    const entry=target||dict.find(e=>e.nom.toLowerCase()===form.rattacher.trim().toLowerCase());
    if(!entry){toast("⚠️ Choisis un ingrédient existant dans la liste");return;}
    setSaving(true);
    try{
      const known=new Set(splitAliases(entry.alias).map(lightKey));
      const add=aliasesFor(ing,entry.nom).filter(a=>!known.has(lightKey(a)));
      const alias=[...splitAliases(entry.alias),...add].join(" | ");
      if(add.length){
        const res=await notionUpdate(entry.id,{"Alias":nText(alias)});
        if(res?.object==="error")throw new Error(res.message);
      }
      updateDict(dict.map(e=>e.id===entry.id?{...e,alias}:e));
      toast(`🔗 « ${ing.nom} » → ${entry.nom}`);
    }catch(e){toast("❌ Dictionnaire : "+e.message);}
    setSaving(false);
  };

  const doImport=async()=>{
    setGeneratingCourses(true);
    const toImport=ingsList.filter(i=>i.selected);
    // Fermer immédiatement la modale
    onClose();
    let ok=0;
    const newItems=[];
    for(const ing of toImport){
      try{
        const created=await notionCreate(DB_COURSES,{
          "Article":nTitle(ing.nom),"Catégorie":nSel(ing.categorie),
          "Quantité":nText(ing.qty),
          "Semaine":nText(ing.semaine),"Recette":nText(ing.recette),
        });
        if(created&&created.object!=="skip"&&created.object!=="error"){
          newItems.push({
            id:created.id,article:ing.nom,categorie:ing.categorie,
            quantite:ing.qty,achete:false,semaine:ing.semaine,recette:ing.recette
          });
          ok++;
        }
      }catch(e){console.error(e);}
    }
    setGeneratingCourses(false);
    // Mettre à jour le cache courses directement sans recharger
    const existing=getCached("courses")||[];
    setCache("courses",[...existing,...newItems]);
    toast(ok+" article"+(ok>1?"s":"")+" ajouté"+(ok>1?"s":"")+" à la liste de courses ✓");
  };

  return(
    <Modal title="🛒 Générer la liste de courses" onClose={onClose} wide>
      <p style={{fontSize:13,color:"var(--muted)",marginBottom:16}}>File d'attente + repas planifiés sur 2 semaines. Décoche ce que tu as déjà.</p>

      {/* Toggle mode + actions globales */}
      <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:12,color:"var(--muted)"}}>Regrouper par :</span>
        <button onClick={()=>setGroupMode("recette")} style={{...btnSmall,background:groupMode==="recette"?"var(--accent)":"#FFFFFF",color:groupMode==="recette"?"#fff":"var(--text-2)",borderColor:groupMode==="recette"?"var(--accent)":"var(--border)"}}>🍽️ Recette</button>
        <button onClick={()=>setGroupMode("categorie")} style={{...btnSmall,background:groupMode==="categorie"?"var(--accent)":"#FFFFFF",color:groupMode==="categorie"?"#fff":"var(--text-2)",borderColor:groupMode==="categorie"?"var(--accent)":"var(--border)"}}>🏪 Catégorie</button>
        <div style={{marginLeft:"auto",display:"flex",gap:6}}>
          <button style={btnSmall} onClick={()=>toggleAllIngs(true)}>Tout cocher</button>
          <button style={btnSmall} onClick={()=>toggleAllIngs(false)}>Tout décocher</button>
        </div>
      </div>

      {/* Chips recettes */}
      <div style={{background:"var(--bg)",border:"1px solid var(--border)",borderRadius:10,padding:12,marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <span style={{fontSize:12,fontWeight:700,color:"var(--text-2)"}}>Recettes incluses</span>
          <div style={{display:"flex",gap:6}}>
            <button style={btnSmall} onClick={()=>toggleAllRecettes(true)}>Tout cocher</button>
            <button style={btnSmall} onClick={()=>toggleAllRecettes(false)}>Tout décocher</button>
          </div>
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {coursesSelection.map((m,i)=>(
            <div key={i} onClick={()=>toggleRecette(i)}
              style={{display:"flex",alignItems:"center",gap:5,padding:"5px 10px",borderRadius:999,
                border:`1px solid ${m.selected?"var(--accent)":"var(--border)"}`,
                background:m.selected?"rgba(194,98,45,0.08)":"#FFFFFF",
                cursor:"pointer",fontSize:12,fontWeight:500,color:m.selected?"var(--accent)":"var(--muted)"}}>
              {m.selected&&<Icon name="check" size={10}/>}{m.recette||m.repas}
            </div>
          ))}
        </div>
      </div>

      {dictError&&<p style={{fontSize:12,color:"#B45309",marginBottom:12}}>⚠️ Dictionnaire d'ingrédients indisponible : noms nettoyés mais non normalisés.</p>}
      {!dictError&&nbNew>0&&<p style={{fontSize:12,color:"var(--muted)",marginBottom:12}}>{nbNew} article{nbNew>1?"s":""} inconnu{nbNew>1?"s":""} du dictionnaire : touche « nouveau » pour l'apprendre une fois pour toutes. 🏠 = garde-manger, décoché par défaut.</p>}
      <datalist id="dict-noms">{dict.map(e=><option key={e.id} value={e.nom}/>)}</datalist>

      {/* Ingrédients groupés */}
      {ingsList.length===0&&<p style={{fontSize:13,color:"var(--muted)",textAlign:"center",padding:"16px 0"}}>Aucun ingrédient trouvé — les recettes ont-elles des ingrédients renseignés ?</p>}
      {groups.map(([groupKey,items])=>(
        <div key={groupKey} style={{marginBottom:10,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 14px",background:"var(--bg)",borderBottom:"1px solid var(--border)"}}>
            <span style={{fontSize:12,fontWeight:700,color:"var(--text)"}}>{groupKey}</span>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontSize:11,color:"var(--subtle)"}}>{items.filter(i=>ingsList[i._idx]?.selected).length}/{items.length}</span>
              <button style={btnSmall} onClick={()=>toggleGroup(new Set(items.map(i=>i._idx)),true)}>Tout cocher</button>
              <button style={btnSmall} onClick={()=>toggleGroup(new Set(items.map(i=>i._idx)),false)}>Tout décocher</button>
            </div>
          </div>
          {items.map((ing,j)=>{
            const isSel=ingsList[ing._idx]?.selected!==false;
            const editing=editKey===ing.key;
            return(
            <div key={ing.key} style={{borderBottom:j<items.length-1?"1px solid var(--surface-2)":"none"}}>
            <div onClick={()=>toggleIng(ing._idx)}
              style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px",cursor:"pointer",
                background:isSel?"#FFFFFF":"#FAFAFA",opacity:isSel?1:0.5}}>
              <div style={{width:16,height:16,borderRadius:3,border:`1.5px solid ${isSel?"var(--accent)":"#D6D3D1"}`,
                background:isSel?"var(--accent)":"#FFFFFF",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {isSel&&<Icon name="check" size={10}/>}
              </div>
              <span style={{flex:1,fontSize:13,color:"var(--text)",textDecoration:isSel?"none":"line-through"}}>
                {ing.nom}
                {ing.gardeManger&&<span title="Garde-manger" style={{marginLeft:6,fontSize:11}}>🏠</span>}
              </span>
              {ing.isNew&&!dictError&&<button onClick={e=>{e.stopPropagation();editing?setEditKey(null):openLearn(ing);}}
                style={{...btnSmall,padding:"2px 8px",fontSize:10,borderColor:"var(--accent)",color:"var(--accent)",opacity:1}}>nouveau</button>}
              {ing.qty&&<span style={{fontSize:12,color:"var(--subtle)",marginRight:4}}>{ing.qty}</span>}
              {groupMode==="categorie"&&<span style={{fontSize:11,color:"#D6D3D1",fontStyle:"italic"}}>{ing.recette}</span>}
            </div>
            {editing&&(
              <div style={{padding:"10px 14px 12px 40px",background:"var(--bg)",display:"flex",flexDirection:"column",gap:8}}>
                <span style={{fontSize:11,color:"var(--muted)"}}>Vu dans les recettes : {[...new Set(ing.sources)].join(" · ")}</span>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                  <input value={form.nom} onChange={e=>setForm(f=>({...f,nom:e.target.value}))} placeholder="Nom de l'article"
                    style={{flex:"1 1 140px",fontSize:13,padding:"6px 8px",border:"1px solid var(--border)",borderRadius:8}}/>
                  <select value={form.categorie} onChange={e=>setForm(f=>({...f,categorie:e.target.value}))}
                    style={{fontSize:12,padding:"6px 8px",border:"1px solid var(--border)",borderRadius:8,background:"#FFFFFF"}}>
                    {CATEGORIES.map(c=><option key={c}>{c}</option>)}
                  </select>
                  <label style={{fontSize:12,display:"flex",alignItems:"center",gap:4,color:"var(--text-2)"}}>
                    <input type="checkbox" checked={form.gardeManger} onChange={e=>setForm(f=>({...f,gardeManger:e.target.checked}))}/>🏠 Garde-manger
                  </label>
                  <button disabled={saving} onClick={()=>learnCreate(ing)} style={{...btnSmall,background:"var(--accent)",color:"#fff",borderColor:"var(--accent)"}}>Ajouter</button>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <span style={{fontSize:12,color:"var(--muted)"}}>ou c'est :</span>
                  <input list="dict-noms" value={form.rattacher} onChange={e=>setForm(f=>({...f,rattacher:e.target.value}))} placeholder="Ingrédient existant"
                    style={{flex:1,fontSize:13,padding:"6px 8px",border:"1px solid var(--border)",borderRadius:8}}/>
                  <button disabled={saving||!form.rattacher.trim()} onClick={()=>learnAttach(ing)} style={btnSmall}>Rattacher</button>
                </div>
              </div>
            )}
            </div>
            );
          })}
        </div>
      ))}

      <button disabled={generatingCourses||totalSel===0} onClick={doImport}
        style={totalSel>0&&!generatingCourses?{...btnPrimary,marginTop:8,width:"100%"}:{...btnDisabled,marginTop:8,width:"100%"}}>
        {generatingCourses?"Ajout en cours…":"Ajouter "+totalSel+" article"+(totalSel>1?"s":"")+" à la liste de courses"}
      </button>
    </Modal>
  );
}
