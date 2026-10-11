
// Date locale AAAA-MM-JJ. toISOString() renvoie la date UTC : entre 0h et 2h (heure de Paris)
// elle donnait la veille → mauvais "aujourd'hui", mauvaise semaine, repas sur le mauvais jour.
export function localISO(d=new Date()){const x=new Date(d);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`;}
