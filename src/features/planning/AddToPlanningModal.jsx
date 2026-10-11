import { useState } from "react";
import { setCache } from "../../lib/cache";
import { DB_PLANNING, MOMENTS } from "../../lib/constants";
import { localISO } from "../../lib/dates";
import { nCheck, nDate, nNum, nSel, nText, nTitle, notionCreate } from "../../lib/notion";
import { Field, Modal, btnPrimary, inputStyle } from "../../ui/primitives";

// ── Add to Planning Modal ─────────────────────────────────────────────────────
export function AddToPlanningModal({recette,portions,mode,onClose,toast}){
  const [date,setDate]=useState(localISO(new Date()));
  const [moment,setMoment]=useState("Dîner");
  const [saving,setSaving]=useState(false);

  const save=async()=>{
    setSaving(true);
    const isQueue=mode==="queue";
    // For queue: use next monday
    let targetDate=date;
    if(isQueue){
      const now=new Date();
      const day=now.getDay();
      const nextMonday=new Date(now);
      nextMonday.setDate(now.getDate()+(day===0?1:8-day));
      targetDate=localISO(nextMonday);
    }
    await notionCreate(DB_PLANNING,{
      "Repas":nTitle(recette.nom),
      "Date":nDate(targetDate),
      "Moment":nSel(moment),
      "Recette":nText(recette.nom),
      "Recette ID":nText(recette.id),
      "Portions":nNum(portions),
      "File d'attente":nCheck(isQueue),
    });
    setCache("planning",null);
    toast(isQueue?`"${recette.nom}" ajouté à la file d'attente ✓`:`"${recette.nom}" planifié ✓`);
    setSaving(false);
    onClose();
  };

  return(
    <Modal title={mode==="queue"?"File d'attente":"Planifier"} onClose={onClose}>
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:"var(--surface-2)",borderRadius:10,marginBottom:16}}>
        {recette.photo?(<img src={recette.photo} alt="" style={{width:"100%",height:120,objectFit:"cover",borderRadius:"10px 10px 0 0",display:"block",marginBottom:0}} onError={e=>{e.target.style.display="none";}}/>):(<div style={{width:"100%",height:80,borderRadius:"10px 10px 0 0",background:"var(--surface-2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32}}>{recette.categorie==="Dessert"?"🍰":recette.categorie==="Petit-déjeuner"?"🥐":recette.categorie==="Soupe"?"🍲":"🍽️"}</div>)}
        <div>
          <div style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>{recette.nom}</div>
          <div style={{fontSize:12,color:"var(--muted)"}}>{portions} portions</div>
        </div>
      </div>
      {mode==="date"&&(
        <Field label="Date">
          <input style={inputStyle} type="date" value={date} onChange={e=>setDate(e.target.value)}/>
        </Field>
      )}
      {mode==="queue"&&(
        <p style={{color:"var(--muted)",fontSize:13,margin:"0 0 16px"}}>Cette recette sera ajoutée à la file d'attente de la semaine prochaine.</p>
      )}
      <Field label="Moment">
        <select style={inputStyle} value={moment} onChange={e=>setMoment(e.target.value)}>
          {MOMENTS.map(m=><option key={m}>{m}</option>)}
        </select>
      </Field>
      <button onClick={save} disabled={saving} style={btnPrimary}>{saving?"Enregistrement…":mode==="queue"?"Ajouter à la file":"Planifier"}</button>
    </Modal>
  );
}
