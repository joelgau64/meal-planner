// ══════════════════════════════════════════════════════════════════════════════
// NETTOYAGE DE LA LISTE DE COURSES EXISTANTE
// Repasse chaque article non acheté dans le dictionnaire et produit un PLAN
// d'opérations (rien n'est écrit ici) que l'onglet Courses affiche puis applique :
//   - update  : renommage / changement de rayon / quantités fusionnées
//   - create  : article issu de l'éclatement d'une ligne ("Sel et poivre")
//   - archive : doublon fusionné dans un autre article, ou ligne vide de sens
//   - check   : article du garde-manger → coché (dans le caddie, réversible)
// ══════════════════════════════════════════════════════════════════════════════
import { expandCompound, resolveIngredient, withQualif } from "./dictionnaire";
import { addToBag, formatBag, parseOneIngredient, parseQtyText } from "./ingredients";

const joinUnique=(...lists)=>[...new Set(lists.flatMap(l=>String(l||"").split(",").map(x=>x.trim())).filter(Boolean))].join(", ");

export function planCleanup(items,index){
  // 1. Chaque ligne → un ou plusieurs articles résolus
  const targets=[];
  const archives=[];
  for(const it of items){
    const frags=expandCompound(it.article);
    let first=true,produced=0;
    for(const f of frags){
      const p=parseOneIngredient(f);
      const r=resolveIngredient(p.name,index);
      if(!r)continue;
      // Quantité : celle de la ligne si renseignée, sinon celle trouvée dans le nom ("2 courgettes")
      // Quantité : celle de la ligne si renseignée (y compris les vieux textes concaténés),
      // sinon celle trouvée dans le nom ("2 courgettes").
      const bag=first&&it.quantite?parseQtyText(it.quantite):addToBag({},p.qty,p.unit);
      targets.push({src:first?it:null,parent:it,res:r,bag,recette:it.recette||"",semaine:it.semaine||""});
      first=false;produced++;
    }
    if(!produced)archives.push({id:it.id,before:it.article,reason:"rien à acheter"});
  }

  // 2. Regroupement par ingrédient résolu
  const groups=new Map();
  for(const t of targets){
    const g=groups.get(t.res.key);
    if(!g){groups.set(t.res.key,{...t,bag:{...t.bag},members:[t]});continue;}
    g.members.push(t);
    for(const [k,v] of Object.entries(t.bag))g.bag[k]=(g.bag[k]||0)+v;
    g.recette=joinUnique(g.recette,t.recette);
    if(!g.src&&t.src)g.src=t.src; // privilégier une ligne existante comme porteuse
  }

  // 3. Opérations
  const ops=[];
  for(const g of groups.values()){
    const holder=g.src; // ligne Notion existante qui porte l'article (peut être null)
    // Taille conservée seulement si toutes les lignes fusionnées la partagent
    const sameQualif=g.members.every(m=>m.res.qualif===g.res.qualif);
    const nom=withQualif(g.res.nomBase,sameQualif?g.res.qualif:""), quantite=formatBag(g.bag);
    // Article inconnu du dictionnaire : on garde le rayon déjà choisi (ajouts manuels).
    const categorie=g.res.isNew&&(holder?.categorie||g.parent.categorie)?(holder?.categorie||g.parent.categorie):g.res.categorie;
    // Les autres lignes existantes du groupe sont fusionnées → archivées
    for(const m of g.members){
      if(m.src&&m.src!==holder)archives.push({id:m.src.id,before:m.src.article,reason:`fusionné dans ${nom}`});
    }
    if(holder){
      const changed=holder.article!==nom||holder.categorie!==categorie||(holder.quantite||"")!==quantite||(holder.recette||"")!==g.recette;
      if(changed)ops.push({type:"update",id:holder.id,before:holder.article,after:nom,
        fields:{article:nom,categorie,quantite,recette:g.recette}});
      if(g.res.gardeManger)ops.push({type:"check",id:holder.id,before:nom});
    }else{
      ops.push({type:"create",before:g.parent.article,after:nom,gardeManger:g.res.gardeManger,
        fields:{article:nom,categorie,quantite,recette:g.recette,semaine:g.semaine}});
    }
  }
  for(const a of archives)ops.push({type:"archive",...a});

  const count=t=>ops.filter(o=>o.type===t).length;
  return{ops,summary:{update:count("update"),create:count("create"),archive:count("archive"),check:count("check")+ops.filter(o=>o.type==="create"&&o.gardeManger).length}};
}
