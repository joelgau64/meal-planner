import { errorLog } from "../lib/errors";

// ── Error Panel ──────────────────────────────────────────────────────────────
export function ErrorPanel({onClose}){
  return(
    <div style={{position:"fixed",inset:0,zIndex:3000,background:"rgba(28,25,23,0.7)",display:"flex",alignItems:"flex-end"}}>
      <div style={{width:"100%",maxHeight:"70vh",background:"var(--surface)",borderRadius:"16px 16px 0 0",padding:20,overflow:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <span style={{fontWeight:700,fontSize:15,color:"var(--text)"}}>🔍 Logs d'erreur ({errorLog.length})</span>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{errorLog.length=0;onClose();}} style={{padding:"4px 10px",background:"#FEF2F2",border:"1px solid transparent",borderRadius:10,color:"var(--danger)",fontSize:12,cursor:"pointer"}}>Effacer</button>
            <button onClick={onClose} style={{padding:"4px 10px",background:"var(--surface-2)",border:"none",borderRadius:10,color:"var(--text-2)",fontSize:12,cursor:"pointer"}}>Fermer</button>
          </div>
        </div>
        {errorLog.length===0&&<p style={{color:"var(--subtle)",fontSize:13,textAlign:"center",padding:"20px 0"}}>Aucune erreur 🎉</p>}
        {[...errorLog].reverse().map((e,i)=>(
          <div key={i} style={{padding:"10px 12px",background:"var(--accent-soft)",border:"1px solid #FED7AA",borderRadius:10,marginBottom:8}}>
            <div style={{display:"flex",gap:8,marginBottom:4}}>
              <span style={{fontSize:11,color:"var(--subtle)"}}>{e.time}</span>
              <span style={{fontSize:11,fontWeight:700,color:"var(--accent)"}}>{e.context}</span>
            </div>
            <div style={{fontSize:13,color:"var(--text)",fontWeight:500}}>{e.message}</div>
            {e.details&&<pre style={{fontSize:11,color:"var(--muted)",marginTop:4,whiteSpace:"pre-wrap",wordBreak:"break-all"}}>{JSON.stringify(e.details,null,2)}</pre>}
          </div>
        ))}
      </div>
    </div>
  );
}
