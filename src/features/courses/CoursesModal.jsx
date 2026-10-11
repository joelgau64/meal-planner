import { useState } from "react";
import { getCached, setCache } from "../../lib/cache";
import { DB_COURSES } from "../../lib/constants";
import { combineQuantities, guessCategory, normalizeKey, parseOneIngredient, splitIngredientLines } from "../../lib/ingredients";
import { nSel, nText, nTitle, notionCreate } from "../../lib/notion";
import { Icon } from "../../ui/Icon";
import { Modal, btnDisabled, btnPrimary } from "../../ui/primitives";

// ── Planning Tab ──────────────────────────────────────────────────────────────
export function CoursesModal({onClose,coursesSelection,setCoursesSelection,recettes,groupMode,setGroupMode,toast}){
  const [generatingCourses,setGeneratingCourses]=useState(false);
  const btnSmall={padding:"3px 10px",fontSize:11,fontWeight:600,border:"1px solid #ECE9E6",borderRadius:10,background:"#FFFFFF",color:"#57534E",cursor:"pointer"};

  const semaine=new Date().toLocaleDateString("fr-FR",{day:"numeric",month:"short"});

  // Construire liste aplatie d'ingrédients
  const buildIngredients=(selection)=>{
    const list=[];
    for(const meal of selection){
      const recetteNom=meal.recette||meal.repas;
      const recetteData=recettes.find(r=>r.id===meal.recette_id||r.nom===recetteNom);
      if(!recetteData?.ingredients)continue;
      // Parser partagé : découpe (lignes ou bloc virgulé) + extraction canonique.
      for(const parsed of splitIngredientLines(recetteData.ingredients).map(parseOneIngredient)){
        if(!parsed.name)continue;
        list.push({
          nom:parsed.name,
          qty:parsed.qty,          // number|null
          unit:parsed.unit,        // unité canonique
          raw:parsed.original,     // texte d'origine (pour summands lisibles)
          recette:recetteNom,
          categorie:guessCategory(parsed.name),
          semaine:`Sem. du ${semaine}`,
        });
      }
    }
    // Agrégation : clé normalisée conservatrice, quantités combinées par famille d'unités.
    const merged={};
    for(const item of list){
      const key=normalizeKey(item.nom);
      if(!merged[key]){
        merged[key]={...item,recettes:[item.recette]};
      } else {
        const m=merged[key];
        if(!m.recettes.includes(item.recette))m.recettes.push(item.recette);
        m.qtyDisplay=combineQuantities(
          {qty:m.qty??null,unit:m.unit||"",raw:m.qtyDisplay||m.raw||(m.qty!=null?`${m.qty} ${m.unit}`.trim():"")},
          {qty:item.qty??null,unit:item.unit||"",raw:item.raw||(item.qty!=null?`${item.qty} ${item.unit}`.trim():"")}
        );
        // après une fusion, on ne garde plus une qty numérique unique fiable
        m.qty=null;m.unit="";
      }
    }
    return Object.values(merged).map(m=>({
      ...m,
      // quantité d'affichage : soit le résultat combiné, soit la forme simple d'origine
      qty:m.qtyDisplay||(m.qty!=null?`${m.qty} ${m.unit}`.trim():(m.raw&&m.raw!==m.nom?m.raw.replace(m.nom,"").trim():"")),
      recette:m.recettes.join(", "),
    }));
  };

  // Déduplication recettes par nom
  const [ingsList,setIngsList]=useState(()=>buildIngredients(coursesSelection.filter(m=>m.selected)).map(i=>({...i,selected:true})));

  // Reconstruire quand la sélection recettes change
  const totalSel=ingsList.filter(i=>i.selected).length;

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
    const newSelRecettes=newSel.filter(m=>m.selected);
    setIngsList(buildIngredients(newSelRecettes).map(ing=>({...ing,selected:true})));
  };

  const toggleIng=(idx)=>setIngsList(l=>l.map((x,i)=>i===idx?{...x,selected:!x.selected}:x));
  const toggleGroup=(idxs,val)=>setIngsList(l=>l.map((x,i)=>idxs.has(i)?{...x,selected:val}:x));
  const toggleAllIngs=(val)=>setIngsList(l=>l.map(x=>({...x,selected:val})));
  const toggleAllRecettes=(val)=>{
    const newSel=coursesSelection.map(x=>({...x,selected:val}));
    setCoursesSelection(newSel);
    setIngsList(buildIngredients(newSel.filter(m=>m.selected)).map(i=>({...i,selected:true})));
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
        if(created&&created.object!=="skip"){
          newItems.push({
            id:created.id,nom:ing.nom,categorie:ing.categorie,
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
            return(
            <div key={j} onClick={()=>toggleIng(ing._idx)}
              style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px",
                borderBottom:j<items.length-1?"1px solid var(--surface-2)":"none",cursor:"pointer",
                background:isSel?"#FFFFFF":"#FAFAFA",opacity:isSel?1:0.5}}>
              <div style={{width:16,height:16,borderRadius:3,border:`1.5px solid ${isSel?"var(--accent)":"#D6D3D1"}`,
                background:isSel?"var(--accent)":"#FFFFFF",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {isSel&&<Icon name="check" size={10}/>}
              </div>
              <span style={{flex:1,fontSize:13,color:"var(--text)",textDecoration:isSel?"none":"line-through"}}>{ing.nom}</span>
              {ing.qty&&<span style={{fontSize:12,color:"var(--subtle)",marginRight:4}}>{ing.qty}</span>}
              {groupMode==="categorie"&&<span style={{fontSize:11,color:"#D6D3D1",fontStyle:"italic"}}>{ing.recette}</span>}
            </div>
            );
          })}
        </div>
      ))}

      <button disabled={generatingCourses||totalSel===0} onClick={doImport}
        style={totalSel>0&&!generatingCourses?{...btnPrimary,marginTop:8,width:"100%"}:{...btnDisabled,marginTop:8,width:"100%"}}>
        {generatingCourses?"Ajout en cours...":"Ajouter "+totalSel+" article"+(totalSel>1?"s":"")+" à la liste de courses"}
      </button>
    </Modal>
  );
}
