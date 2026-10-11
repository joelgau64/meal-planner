
export const DB_RECETTES = "39c7b0f8-bf02-4893-bc05-6d82b8c38617";
export const DB_PLANNING = "dc70bd98-0691-41b9-abfc-5bde68630995";
export const DB_COURSES = "35f5b3b5-095f-4998-a014-9a112807e711";
export const DB_FRIGO = "3ba7bf2a-8f76-81bd-a878-dbf3ae8be0be";
export const DAYS = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
export const MOMENTS = ["Petit-déjeuner","Déjeuner","Dîner"];
export const MOMENT_COLORS = {"Déjeuner":"#C2622D","Dîner":"#57534E"};
export const CAT_COLORS = {"Fruits & Légumes":"#16A34A","Viandes & Poissons":"#DC2626","Produits laitiers":"#2563EB","Épicerie":"#EA580C","Surgelés":"#7C3AED","Boissons":"#0891B2","Autre":"#6B7280"};
export const EMPTY_FORM = {nom:"",categorie:"Dîner",temps:"",portions:4,ingredients:"",instructions:"",tags:[],note:"***",photoUrl:"",sourceUrl:""};
export const DEFAULT_PORTIONS = Number(localStorage.getItem("household_portions"))||4;
export function setHouseholdPortions(n){localStorage.setItem("household_portions",String(n));}
