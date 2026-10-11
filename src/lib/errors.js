
// ── Error logging ─────────────────────────────────────────────────────────────
export const errorLog = [];
export const errorListeners = new Set();
export function logError(context, error, details=null){
  const entry = {time:new Date().toLocaleTimeString('fr-FR'), context, message: error?.message||String(error), details};
  errorLog.push(entry);
  if(errorLog.length>50) errorLog.shift();
  errorListeners.forEach(fn=>fn(errorLog.length));
  console.error(`[${context}]`, error, details||'');
}
