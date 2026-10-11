
// ── Claude API ────────────────────────────────────────────────────────────────
export async function claudeJSON(system,user,withSearch=false){
  const body={model:"claude-haiku-4-5-20251001",max_tokens:1500,system,messages:[{role:"user",content:user}]};
  if(withSearch)body.tools=[{type:"web_search_20250305",name:"web_search"}];
  try{
    const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const data=await res.json();
    if(!res.ok){console.error("claudeJSON error:",data);return null;}
    return parseJSON((data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join(""));
  }catch(err){
    console.error("claudeJSON fetch/parse failed:",err);
    return null;
  }
}
// Vision : reste sur Sonnet par défaut. Testé avec Haiku 4.5 → hallucinations
// sur l'OCR de photos (mots inventés, texte incohérent). Le gain de coût ne
// vaut pas la perte de fiabilité sur cette tâche précise.
export async function claudeVision(prompt,base64,mediaType,model="claude-sonnet-4-5"){
  const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model,max_tokens:1500,system:"Tu es un chef cuisinier expert. Retourne UNIQUEMENT un JSON valide, sans backticks.",messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:mediaType,data:base64}},{type:"text",text:prompt}]}]})});
  const data=await res.json();
  return parseJSON((data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join(""));
}
export function parseJSON(text){
  try{
    const cleaned=text.replace(/```json\n?|```\n?/g,"").trim();
    const start=cleaned.indexOf("{");
    const end=cleaned.lastIndexOf("}");
    if(start===-1||end===-1||end<start)return null;
    return JSON.parse(cleaned.slice(start,end+1));
  }catch{return null;}
}

export const FRIGO_JSON_PROMPT=`Tu regardes la photo d'un emballage de produit frais (viande, poisson ou volaille). Retourne EXACTEMENT ce JSON sans backticks, sans virgule dans les valeurs:
{"article":"nom court du produit ex: Poulet ou Saumon","proteine":"Viande|Poisson|Volaille|Autre","forme":"Filet|Cuisses|Pavé|Steak|Entier|Haché|Tranches|Autre","date_peremption":"AAAA-MM-JJ (la date limite de consommation lisible sur l'emballage)","quantite":"ex: 500g ou 4 pièces si visible sinon vide"}
Si la date n'est pas lisible, mets null pour date_peremption. Ne mets JAMAIS de virgule dans une valeur.
IMPORTANT: nous sommes en 2026. Une date limite de consommation est TOUJOURS dans le futur proche (quelques jours à quelques semaines). Si tu lis une année passée comme 2023 ou 2024, tu as mal lu le chiffre — relis attentivement, l'année est 2026 (ou 2027 en fin d'année).`;

export const RECIPE_JSON_PROMPT=`Retourne exactement ce JSON sans backticks:
{"nom":"nom du plat en français","categorie":"Déjeuner","temps":30,"portions":4,"ingredients":"liste avec quantités en g/ml, UN ingrédient par ligne","instructions":"étapes numérotées","tags":[],"note":"","sourceUrl":""}`;

// ── Extraction de recette depuis une URL ────────────────────────────────────
// 1) Récupère le contenu texte réel de la page côté serveur (fiable)
// 2) Fait extraire la recette par Claude à partir de ce texte
// 3) Si le fetch direct échoue (page protégée, JS-only...), on retombe sur web_search
export async function fetchUrlContent(url){
  try{
    const r=await fetch("/api/fetch-url?url="+encodeURIComponent(url));
    const d=await r.json();
    return {text:d?.text||null,image:d?.image||null};
  }catch{return {text:null,image:null};}
}
export function withTimeout(promise,ms,label){
  return Promise.race([
    promise,
    new Promise((_,rej)=>setTimeout(()=>rej(new Error(label||"Timeout")),ms)),
  ]);
}
export async function extractRecipe(url,fallbackPrompt){
  const SYS="Tu es un expert en recettes. Retourne UNIQUEMENT un JSON valide, sans backticks.";
  if(url&&url.startsWith("http")){
    const {text:pageText,image:pageImage}=await fetchUrlContent(url);
    if(pageText){
      const result=await claudeJSON(SYS,`Voici le contenu texte d'une page web contenant une recette de cuisine. Extrais la recette complète en français avec mesures métriques, ingrédients un par ligne. Ignore le texte hors-sujet (menus, pubs, commentaires).\n\nContenu de la page:\n${pageText}\n\n${RECIPE_JSON_PROMPT}`);
      if(result?.nom)return {...result,image:pageImage||null};
    }
    // Fallback : le fetch direct a échoué, on tente via web_search (moins fiable)
    const viaSearch=await claudeJSON(SYS,`Visite cette URL et extrais la recette complète en français avec mesures métriques, ingrédients un par ligne: ${url}\n\n${RECIPE_JSON_PROMPT}`,true);
    if(viaSearch?.nom)return {...viaSearch,image:pageImage||null};
  }
  if(fallbackPrompt)return claudeJSON(SYS,fallbackPrompt);
  return null;
}
